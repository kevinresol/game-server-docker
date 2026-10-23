/*
 * stn-pty — PTY bridge for the Stationeers dedicated-server console.
 *
 * Invocation: stn-pty <program> [args...]
 *
 * The container keeps pipe stdin/stdout (docker run -i, no -t). The program
 * is executed on a PTY slave as fd 0/1/2 so Mono's TermInfoDriver will treat
 * the console as a terminal. Output from the slave is one merged stream on
 * this process's stdout. Diagnostics from this process go to its own stderr.
 *
 * S1 (2026-10-23) froze the slave setup that Mono accepts:
 *   - kernel line-discipline defaults; do not call cfmakeraw or switch to raw
 *   - ONLCR is cleared before exec, so a newline the child writes stays LF
 *     on the master. Every other output flag stays at the kernel default.
 *     Master output and input toward the slave are copied unchanged.
 *   - window 80 columns by 30 rows
 *   - TERM=xterm only when TERM is unset or dumb
 *   - locale left unchanged
 *   - the Enter byte this process must deliver is \n (0x0a). Input bytes are
 *     copied verbatim. The kernel icrnl default is left on, so a \n written
 *     to the master is what the slave's read returns.
 *
 * LD_PRELOAD is the Node wrapper's choice, passed in this process's
 * environment so the game is interposed. This program does not invent a
 * library path. The helper itself must not be preloaded: if LD_PRELOAD is
 * set at startup, the value is saved, cleared, and this process re-execs so
 * the running helper image is not interposed. The child inherits that saved
 * value. After fork and before exec, an entry that names this executable is
 * removed so the helper binary is not preloaded into the child; every other
 * entry is kept.
 *
 * Stdin EOF removes fd 0 from the poll set and does not close the PTY master
 * (that would SIGHUP the child). This covers docker run -i closed later and
 * a container whose stdin is /dev/null. SIGINT is forwarded to the child.
 * SIGTERM is delivered to the child as SIGINT. The exit status is the
 * child's, or 128+n if signal n killed it.
 */

#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <pty.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/wait.h>
#include <termios.h>
#include <unistd.h>

#define STN_ROWS 30
#define STN_COLS 80
#define STN_BUF 4096

#define STN_SAVED_PRELOAD "STN_PTY_SAVED_PRELOAD"
#define STN_REEXECED "STN_PTY_REEXECED"

enum {
    IO_OK = 0,
    IO_BLOCK = 1,
    IO_EOF = 2,
    IO_ERR = -1
};

struct pipebuf {
    char data[STN_BUF];
    size_t off;
    size_t len;
};

static int g_diag = STDERR_FILENO;
static char g_self[4096];
static sigset_t g_parent_mask;

static volatile sig_atomic_t g_child_pid;
static volatile sig_atomic_t g_forward;
static volatile sig_atomic_t g_sigchld;
static int g_status;
static int g_status_ready;

static int pending(const struct pipebuf *b) {
    return b->len > b->off;
}

static void clear_buf(struct pipebuf *b) {
    b->off = 0;
    b->len = 0;
}

/* The game's shutdown path is SIGINT. A stop signal that arrives here as
 * SIGTERM is rewritten before it is sent. */
static int signal_for_child(int sig) {
    if (sig == SIGTERM) {
        return SIGINT;
    }
    return sig;
}

static void signal_child(pid_t pid, int sig) {
    (void)kill(pid, signal_for_child(sig));
}

static void on_forward(int sig) {
    sig_atomic_t pid = g_child_pid;
    if (pid > 0) {
        signal_child((pid_t)pid, sig);
    } else {
        g_forward = sig;
    }
}

static void on_sigchld(int sig) {
    (void)sig;
    g_sigchld = 1;
}

static int install_handler(int sig, void (*fn)(int), int flags) {
    struct sigaction sa;

    memset(&sa, 0, sizeof sa);
    sa.sa_handler = fn;
    sigemptyset(&sa.sa_mask);
    sa.sa_flags = flags;
    return sigaction(sig, &sa, NULL);
}

static int set_nonblock(int fd) {
    int flags = fcntl(fd, F_GETFL);
    if (flags < 0) {
        return -1;
    }
    return fcntl(fd, F_SETFL, flags | O_NONBLOCK);
}

static void load_self_path(void) {
    ssize_t n = readlink("/proc/self/exe", g_self, sizeof g_self - 1);
    if (n < 0) {
        g_self[0] = '\0';
        return;
    }
    g_self[n] = '\0';
}

static int entry_is_self(const char *start, size_t len) {
    size_t self_len = strlen(g_self);
    if (self_len == 0 || len != self_len) {
        return 0;
    }
    return memcmp(start, g_self, len) == 0;
}

/* Drop entries that name this executable. Other entries stay, in order. */
static char *filter_self_preload(const char *preload) {
    size_t n = strlen(preload);
    char *buf = malloc(n + 1);
    const char *p = preload;
    size_t w = 0;

    if (buf == NULL) {
        return NULL;
    }
    while (*p != '\0') {
        size_t len;
        while (*p == ':' || *p == ' ' || *p == '\t') {
            p++;
        }
        if (*p == '\0') {
            break;
        }
        len = 0;
        while (p[len] != '\0' && p[len] != ':' && p[len] != ' ' && p[len] != '\t') {
            len++;
        }
        if (!entry_is_self(p, len)) {
            if (w > 0) {
                buf[w++] = ':';
            }
            memcpy(buf + w, p, len);
            w += len;
        }
        p += len;
    }
    buf[w] = '\0';
    return buf;
}

/*
 * The dynamic linker has already applied LD_PRELOAD to this image. Re-exec
 * with the variable cleared so the helper that copies bytes is not interposed.
 * The wrapper's value is kept in STN_SAVED_PRELOAD for the child.
 */
static void drop_preload_from_helper(char **argv) {
    const char *preload = getenv("LD_PRELOAD");

    if (preload == NULL || preload[0] == '\0') {
        return;
    }
    if (getenv(STN_REEXECED) != NULL) {
        return;
    }
    if (setenv(STN_SAVED_PRELOAD, preload, 1) != 0) {
        dprintf(STDERR_FILENO, "stn-pty: preserving LD_PRELOAD failed: %s\n", strerror(errno));
        return;
    }
    if (setenv(STN_REEXECED, "1", 1) != 0) {
        dprintf(STDERR_FILENO, "stn-pty: marking re-exec failed: %s\n", strerror(errno));
        return;
    }
    unsetenv("LD_PRELOAD");
    execv("/proc/self/exe", argv);
    dprintf(STDERR_FILENO, "stn-pty: re-exec without LD_PRELOAD failed: %s\n", strerror(errno));
}

/* Child side: restore the wrapper's preload, minus this executable. */
static void publish_child_preload(void) {
    const char *saved = getenv(STN_SAVED_PRELOAD);
    const char *cur = getenv("LD_PRELOAD");
    const char *src = (saved != NULL) ? saved : cur;
    char *filtered = NULL;

    if (src != NULL && src[0] != '\0') {
        filtered = filter_self_preload(src);
        if (filtered == NULL) {
            dprintf(g_diag, "stn-pty: preload filter failed\n");
            _exit(127);
        }
        if (filtered[0] == '\0') {
            unsetenv("LD_PRELOAD");
        } else if (cur == NULL || strcmp(cur, filtered) != 0) {
            if (setenv("LD_PRELOAD", filtered, 1) != 0) {
                dprintf(g_diag, "stn-pty: LD_PRELOAD: %s\n", strerror(errno));
                free(filtered);
                _exit(127);
            }
        }
        free(filtered);
    }
    unsetenv(STN_SAVED_PRELOAD);
    unsetenv(STN_REEXECED);
}

static void reset_default(int sig) {
    struct sigaction sa;

    memset(&sa, 0, sizeof sa);
    sa.sa_handler = SIG_DFL;
    sigemptyset(&sa.sa_mask);
    (void)sigaction(sig, &sa, NULL);
}

static void child_exec(char **argv) {
    struct termios tio;
    struct winsize ws;
    const char *term;

    /* Caught handlers must not run in the child. exec resets SIG_DFL, but a
     * signal in this window would otherwise hit on_forward and signal the
     * process group. Restore the mask this process was started with so the
     * game is not left with SIGINT/SIGTERM blocked. */
    reset_default(SIGINT);
    reset_default(SIGTERM);
    reset_default(SIGCHLD);
    if (sigprocmask(SIG_SETMASK, &g_parent_mask, NULL) != 0) {
        _exit(127);
    }

    /* OPOST stays on. Only the newline-to-CR-LF translation is turned off,
     * before the child writes anything. */
    if (tcgetattr(STDIN_FILENO, &tio) != 0) {
        dprintf(g_diag, "stn-pty: tcgetattr: %s\n", strerror(errno));
        _exit(127);
    }
    tio.c_oflag &= ~(tcflag_t)ONLCR;
    if (tcsetattr(STDIN_FILENO, TCSANOW, &tio) != 0) {
        dprintf(g_diag, "stn-pty: tcsetattr: %s\n", strerror(errno));
        _exit(127);
    }

    memset(&ws, 0, sizeof ws);
    ws.ws_row = STN_ROWS;
    ws.ws_col = STN_COLS;
    if (ioctl(STDIN_FILENO, TIOCSWINSZ, &ws) < 0) {
        dprintf(g_diag, "stn-pty: winsize: %s\n", strerror(errno));
        _exit(127);
    }

    term = getenv("TERM");
    if (term == NULL || term[0] == '\0' || strcmp(term, "dumb") == 0) {
        if (setenv("TERM", "xterm", 1) != 0) {
            dprintf(g_diag, "stn-pty: TERM: %s\n", strerror(errno));
            _exit(127);
        }
    }

    publish_child_preload();
    execvp(argv[0], argv);
    dprintf(g_diag, "stn-pty: exec %s: %s\n", argv[0], strerror(errno));
    _exit(127);
}

static int fill_buf(struct pipebuf *b, int fd) {
    ssize_t n;

    if (pending(b)) {
        return IO_OK;
    }
    n = read(fd, b->data, sizeof b->data);
    if (n < 0) {
        if (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK) {
            return IO_BLOCK;
        }
        if (errno == EIO) {
            /* Linux reports EIO on the master once the slave has closed. */
            return IO_EOF;
        }
        return IO_ERR;
    }
    if (n == 0) {
        return IO_EOF;
    }
    b->off = 0;
    b->len = (size_t)n;
    return IO_OK;
}

/* Blocking write of the whole buffer. Short writes are retried. */
static int write_all(int fd, const char *buf, size_t len) {
    size_t off = 0;

    while (off < len) {
        ssize_t n = write(fd, buf + off, len - off);
        if (n < 0) {
            if (errno == EINTR) {
                continue;
            }
            return -1;
        }
        if (n == 0) {
            errno = EPIPE;
            return -1;
        }
        off += (size_t)n;
    }
    return 0;
}

/* Nonblocking write to the PTY master. Returns 0 if drained or EAGAIN. */
static int flush_master(struct pipebuf *b, int fd) {
    while (b->off < b->len) {
        ssize_t n = write(fd, b->data + b->off, b->len - b->off);
        if (n < 0) {
            if (errno == EINTR) {
                continue;
            }
            if (errno == EAGAIN || errno == EWOULDBLOCK) {
                return 0;
            }
            return -1;
        }
        if (n == 0) {
            errno = EPIPE;
            return -1;
        }
        b->off += (size_t)n;
    }
    clear_buf(b);
    return 0;
}

static void note_sigchld(void) {
    int status = 0;
    pid_t r;

    if (!g_sigchld || g_status_ready || g_child_pid <= 0) {
        return;
    }
    g_sigchld = 0;
    do {
        r = waitpid((pid_t)g_child_pid, &status, WNOHANG);
    } while (r < 0 && errno == EINTR);
    if (r == (pid_t)g_child_pid) {
        g_status = status;
        g_status_ready = 1;
    }
}

static int pump(int master) {
    struct pipebuf down;
    int stdin_on = 1;
    int master_on = 1;
    int stdout_on = 1;

    clear_buf(&down);

    while (master_on || pending(&down)) {
        struct pollfd pf[2];
        int n = 0;
        int ix_m = -1;
        int ix_in = -1;
        int pr;

        note_sigchld();

        if (master_on) {
            pf[n].fd = master;
            pf[n].events = POLLIN;
            if (pending(&down)) {
                pf[n].events = (short)(pf[n].events | POLLOUT);
            }
            pf[n].revents = 0;
            ix_m = n++;
        }
        if (stdin_on && !pending(&down)) {
            pf[n].fd = STDIN_FILENO;
            pf[n].events = POLLIN;
            pf[n].revents = 0;
            ix_in = n++;
        }
        if (n == 0) {
            break;
        }

        pr = poll(pf, (nfds_t)n, -1);
        if (pr < 0) {
            if (errno == EINTR) {
                continue;
            }
            dprintf(STDERR_FILENO, "stn-pty: poll: %s\n", strerror(errno));
            return -1;
        }

        if (ix_m >= 0 && (pf[ix_m].revents & (POLLIN | POLLHUP | POLLERR | POLLNVAL))) {
            struct pipebuf up;
            int rc;

            clear_buf(&up);
            rc = fill_buf(&up, master);
            if (rc == IO_OK) {
                if (stdout_on) {
                    if (write_all(STDOUT_FILENO, up.data, up.len) < 0) {
                        stdout_on = 0;
                    }
                }
            } else if (rc == IO_EOF || rc == IO_ERR) {
                master_on = 0;
            } else if (rc == IO_BLOCK
                && (pf[ix_m].revents & (POLLHUP | POLLERR | POLLNVAL))
                && errno != EINTR) {
                master_on = 0;
            }
        }

        if (ix_m >= 0 && (pf[ix_m].revents & POLLOUT) && pending(&down)) {
            if (flush_master(&down, master) < 0) {
                /* Slave is gone. Drop queued input; do not close master. */
                clear_buf(&down);
            }
        }

        if (ix_in >= 0 && (pf[ix_in].revents & (POLLIN | POLLHUP | POLLERR | POLLNVAL))) {
            int rc = fill_buf(&down, STDIN_FILENO);
            if (rc == IO_EOF || rc == IO_ERR) {
                /* EOF: leave the master open so the child does not get SIGHUP. */
                stdin_on = 0;
            } else if (rc == IO_BLOCK
                && (pf[ix_in].revents & (POLLHUP | POLLERR | POLLNVAL))
                && errno != EINTR) {
                stdin_on = 0;
            }
        }
    }
    return 0;
}

/* Read whatever the slave already queued, then stop. Master stays open. */
static void drain_master(int master) {
    for (;;) {
        struct pipebuf up;
        int rc;

        clear_buf(&up);
        rc = fill_buf(&up, master);
        if (rc != IO_OK) {
            break;
        }
        if (write_all(STDOUT_FILENO, up.data, up.len) < 0) {
            break;
        }
    }
}

static int finish_status(void) {
    int status = 0;
    pid_t r;

    if (!g_status_ready) {
        do {
            r = waitpid((pid_t)g_child_pid, &status, 0);
        } while (r < 0 && errno == EINTR);
        if (r < 0) {
            dprintf(STDERR_FILENO, "stn-pty: waitpid: %s\n", strerror(errno));
            return 1;
        }
        g_status = status;
        g_status_ready = 1;
    }
    if (WIFEXITED(g_status)) {
        return WEXITSTATUS(g_status);
    }
    if (WIFSIGNALED(g_status)) {
        return 128 + WTERMSIG(g_status);
    }
    return 1;
}

int main(int argc, char **argv) {
    struct winsize ws;
    sigset_t block;
    sigset_t previous;
    struct sigaction ignore;
    pid_t pid;
    int master = -1;

    if (argc < 2 || argv[1][0] == '\0') {
        dprintf(STDERR_FILENO, "usage: stn-pty <program> [args...]\n");
        return 2;
    }

    load_self_path();
    drop_preload_from_helper(argv);

    g_diag = fcntl(STDERR_FILENO, F_DUPFD_CLOEXEC, 3);
    if (g_diag < 0) {
        g_diag = STDERR_FILENO;
    }

    sigemptyset(&block);
    sigaddset(&block, SIGINT);
    sigaddset(&block, SIGTERM);
    sigaddset(&block, SIGCHLD);
    if (sigprocmask(SIG_BLOCK, &block, &previous) != 0) {
        dprintf(STDERR_FILENO, "stn-pty: sigprocmask: %s\n", strerror(errno));
        return 1;
    }
    g_parent_mask = previous;
    if (install_handler(SIGINT, on_forward, 0) != 0
        || install_handler(SIGTERM, on_forward, 0) != 0
        || install_handler(SIGCHLD, on_sigchld, SA_NOCLDSTOP) != 0) {
        dprintf(STDERR_FILENO, "stn-pty: sigaction: %s\n", strerror(errno));
        return 1;
    }

    memset(&ws, 0, sizeof ws);
    ws.ws_row = STN_ROWS;
    ws.ws_col = STN_COLS;
    /* NULL termios: kernel defaults. The child clears ONLCR before exec. */
    pid = forkpty(&master, NULL, NULL, &ws);
    if (pid < 0) {
        dprintf(STDERR_FILENO, "stn-pty: forkpty: %s\n", strerror(errno));
        return 1;
    }
    if (pid == 0) {
        child_exec(argv + 1);
    }

    /* Live environment only. /proc/self/environ keeps the re-exec handoff
     * recorded at exec; the child clears those names before its own exec. */
    unsetenv(STN_SAVED_PRELOAD);
    unsetenv(STN_REEXECED);
    if (g_diag != STDERR_FILENO) {
        close(g_diag);
        g_diag = STDERR_FILENO;
    }

    g_child_pid = (sig_atomic_t)pid;
    if (g_forward > 0) {
        signal_child(pid, (int)g_forward);
        g_forward = 0;
    }

    memset(&ignore, 0, sizeof ignore);
    ignore.sa_handler = SIG_IGN;
    sigemptyset(&ignore.sa_mask);
    (void)sigaction(SIGPIPE, &ignore, NULL);

    if (sigprocmask(SIG_SETMASK, &previous, NULL) != 0) {
        dprintf(STDERR_FILENO, "stn-pty: unblock: %s\n", strerror(errno));
        (void)kill(pid, SIGKILL);
        return finish_status();
    }

    if (set_nonblock(master) < 0) {
        dprintf(STDERR_FILENO, "stn-pty: master nonblock: %s\n", strerror(errno));
        (void)kill(pid, SIGKILL);
        return finish_status();
    }
    (void)fcntl(master, F_SETFD, FD_CLOEXEC);

    (void)pump(master);
    drain_master(master);
    return finish_status();
}
