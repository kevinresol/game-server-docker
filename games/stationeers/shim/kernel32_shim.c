/*
 * libkernel32-shim.so for the Stationeers dedicated server.
 *
 * RocketSystemConsole (decompile RocketSystemConsole.cs) is the server's
 * headless console. Its constructor P/Invokes kernel32.dll
 * SetConsoleOutputCP and SetConsoleCP. Those entry points are absent on
 * Linux, so Mono throws EntryPointNotFoundException and the console never
 * runs. This library supplies both calls. Each takes the code page
 * (uint32_t, the P/Invoke uint) and returns 1, the Win32 BOOL success
 * value Mono reads from the P/Invoke bool. S1 found no further Win32
 * symbols after the constructor; none are exported here.
 *
 * That constructor also starts ConsoleInputThread, which busy-waits: while
 * Console.KeyAvailable is false it continues without sleeping
 * (RocketSystemConsole.cs, ConsoleInputThread). Under TermInfoDriver,
 * KeyAvailable is InternalKeyAvailable(0). S1's strace showed this is not
 * poll. It is glibc select, which issues
 * pselect6(1, [0], NULL, NULL, {tv_sec=0, tv_nsec=0}) thousands of times
 * per second. An unversioned select interposer changed that timeout and
 * dropped the idle console off a full core. This file interposes select,
 * and pselect so a direct pselect of the same shape cannot skip the
 * select hook. Only nfds == 1, read fd 0, NULL write and except sets, and
 * a zero timeout is lengthened to about 10 ms, using a stack timeout so
 * the caller's struct is left unchanged. Every other call is forwarded to
 * libc through dlsym(RTLD_NEXT). The libc pointers are resolved in a
 * constructor and invoked by pointer, so the interposer does not call
 * itself and does not allocate.
 *
 * Mono's ReadKey keeps one byte from a large stdin read and leaves the
 * rest in the stream buffer, so the next select sees an empty fd 0
 * (stn-diag/20261023T030556Z). read of fd 0 is therefore metered here.
 * The real read fills a static cache, bounded so a huge result cannot
 * drop bytes: at most STDIN_CACHE_CAP bytes are taken from the kernel,
 * the caller receives the first, and the rest wait in the cache. Further
 * kernel bytes stay in the kernel until a later read. The cache mutex is
 * not held across that kernel read. A blocking read used to stall every
 * select that checks the cache, so the console never observed the byte.
 * A second fd-0 reader waits until the in-flight fill publishes, instead
 * of issuing its own kernel read. select and pselect never read ahead.
 * While the cache holds a byte and fd 0 is in the read set, fd 0 is
 * readable and stays set in the caller's read set. The stdin-only shape
 * returns immediately and does not enter the kernel; a larger read set
 * still reaches libc for the other descriptors (zero timeout, because
 * fd 0 is already ready), then fd 0 is marked. An empty cache keeps the
 * 10 ms stretch. No sleep is inserted between cached bytes.
 *
 * InternalKeyAvailable does not trust select's return value. After
 * select it calls ioctl(FIONREAD) and returns that count
 * (mono/metadata/console-unix.c; stn-diag/20261023T030556Z shows
 * FIONREAD returning 5 before read of "help\n"). Cached bytes are not
 * in the kernel buffer, so this file also interposes ioctl and adds the
 * cached count for FIONREAD and TIOCINQ on fd 0. Other requests and
 * other file descriptors are forwarded and do not take the cache lock
 * across the syscall.
 */

#define _GNU_SOURCE

#include <dlfcn.h>
#include <errno.h>
#include <limits.h>
#include <pthread.h>
#include <stdarg.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/select.h>
#include <sys/types.h>
#include <unistd.h>

#ifdef select
#undef select
#endif
#ifdef pselect
#undef pselect
#endif
#ifdef read
#undef read
#endif
#ifdef ioctl
#undef ioctl
#endif

/* S1's measured substitute: pselect6 tv_nsec=10000000. */
enum { STDIN_SPIN_MS = 10 };

/*
 * Mono's stdin read is 1024 bytes. The cap is larger than a command line
 * and is the most one real read may remove from the kernel. Anything past
 * it stays readable for the next fill, so a big write is not truncated.
 */
enum { STDIN_CACHE_CAP = 4096 };

typedef int (*select_fn)(int, fd_set *, fd_set *, fd_set *, struct timeval *);
typedef int (*pselect_fn)(int, fd_set *, fd_set *, fd_set *,
			  const struct timespec *, const sigset_t *);
typedef ssize_t (*read_fn)(int, void *, size_t);
typedef int (*ioctl_fn)(int, unsigned long, ...);

static void *next_select;
static void *next_pselect;
static void *next_read;
static void *next_ioctl;

static unsigned char stdin_cache[STDIN_CACHE_CAP];
static size_t stdin_cache_pos;
static size_t stdin_cache_len;
static int stdin_fill_busy;
static pthread_mutex_t stdin_cache_mu = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t stdin_cache_cv = PTHREAD_COND_INITIALIZER;

__attribute__((constructor)) static void
resolve_next(void)
{
	__atomic_store_n(&next_select, dlsym(RTLD_NEXT, "select"), __ATOMIC_RELEASE);
	__atomic_store_n(&next_pselect, dlsym(RTLD_NEXT, "pselect"), __ATOMIC_RELEASE);
	__atomic_store_n(&next_read, dlsym(RTLD_NEXT, "read"), __ATOMIC_RELEASE);
	__atomic_store_n(&next_ioctl, dlsym(RTLD_NEXT, "ioctl"), __ATOMIC_RELEASE);
}

/*
 * The idle KeyAvailable shape from S1: one descriptor, fd 0 in the read
 * set, and no write or except set. The zero-timeout check stays at each
 * call site because select uses timeval and pselect uses timespec.
 */
static int
is_stdin_only_read(int nfds, fd_set *readfds, fd_set *writefds, fd_set *exceptfds)
{
	return nfds == 1
		&& readfds != NULL
		&& FD_ISSET(0, readfds)
		&& writefds == NULL
		&& exceptfds == NULL;
}

static int
fd0_in_read_set(int nfds, fd_set *readfds)
{
	return nfds > 0 && readfds != NULL && FD_ISSET(0, readfds);
}

static select_fn
load_select(void)
{
	return (select_fn)__atomic_load_n(&next_select, __ATOMIC_ACQUIRE);
}

static pselect_fn
load_pselect(void)
{
	return (pselect_fn)__atomic_load_n(&next_pselect, __ATOMIC_ACQUIRE);
}

static read_fn
load_read(void)
{
	return (read_fn)__atomic_load_n(&next_read, __ATOMIC_ACQUIRE);
}

static ioctl_fn
load_ioctl(void)
{
	return (ioctl_fn)__atomic_load_n(&next_ioctl, __ATOMIC_ACQUIRE);
}

/* Caller holds stdin_cache_mu. */
static size_t
cache_count(void)
{
	if (stdin_cache_pos >= stdin_cache_len)
		return 0;
	return stdin_cache_len - stdin_cache_pos;
}

static int
cache_pending(void)
{
	int pending;

	pthread_mutex_lock(&stdin_cache_mu);
	pending = stdin_cache_pos < stdin_cache_len;
	pthread_mutex_unlock(&stdin_cache_mu);
	return pending;
}

/* Pop one cached byte. The caller holds stdin_cache_mu. */
static int
cache_pop(unsigned char *byte)
{
	if (stdin_cache_pos >= stdin_cache_len) {
		*byte = 0;
		return 0;
	}
	*byte = stdin_cache[stdin_cache_pos++];
	if (stdin_cache_pos == stdin_cache_len) {
		stdin_cache_pos = 0;
		stdin_cache_len = 0;
	}
	return 1;
}

/*
 * fd 0 is already readable, so the other descriptors are only polled.
 * A caller timeout would hide the cached byte until that timer fired.
 */
static int
select_mark_cached_stdin(select_fn next, int nfds, fd_set *readfds,
			 fd_set *writefds, fd_set *exceptfds)
{
	fd_set others;
	struct timeval instant;
	int rc;

	others = *readfds;
	FD_CLR(0, &others);
	instant.tv_sec = 0;
	instant.tv_usec = 0;
	rc = next(nfds, &others, writefds, exceptfds, &instant);
	if (rc < 0)
		return rc;
	FD_SET(0, &others);
	*readfds = others;
	return rc + 1;
}

static int
pselect_mark_cached_stdin(pselect_fn next, int nfds, fd_set *readfds,
			  fd_set *writefds, fd_set *exceptfds,
			  const sigset_t *sigmask)
{
	fd_set others;
	struct timespec instant;
	int rc;

	others = *readfds;
	FD_CLR(0, &others);
	instant.tv_sec = 0;
	instant.tv_nsec = 0;
	rc = next(nfds, &others, writefds, exceptfds, &instant, sigmask);
	if (rc < 0)
		return rc;
	FD_SET(0, &others);
	*readfds = others;
	return rc + 1;
}

int
SetConsoleOutputCP(uint32_t code_page)
{
	(void)code_page;
	return 1;
}

int
SetConsoleCP(uint32_t code_page)
{
	(void)code_page;
	return 1;
}

ssize_t
read(int fd, void *buf, size_t count)
{
	read_fn next = load_read();
	unsigned char tmp[STDIN_CACHE_CAP];
	unsigned char byte;
	ssize_t n;
	size_t extra;
	int saved;

	if (next == NULL) {
		errno = ENOSYS;
		return -1;
	}
	if (fd != 0 || count == 0)
		return next(fd, buf, count);
	if (buf == NULL) {
		errno = EFAULT;
		return -1;
	}

	pthread_mutex_lock(&stdin_cache_mu);
	for (;;) {
		if (cache_pop(&byte)) {
			pthread_mutex_unlock(&stdin_cache_mu);
			((unsigned char *)buf)[0] = byte;
			return 1;
		}
		if (!stdin_fill_busy)
			break;
		pthread_cond_wait(&stdin_cache_cv, &stdin_cache_mu);
	}
	stdin_fill_busy = 1;
	pthread_mutex_unlock(&stdin_cache_mu);

	/* The kernel read blocks. Selects must still be able to take the mutex. */
	n = next(0, tmp, sizeof tmp);
	saved = errno;

	pthread_mutex_lock(&stdin_cache_mu);
	if (n > 1) {
		extra = (size_t)n - 1;
		if (stdin_cache_pos > 0 && stdin_cache_pos < stdin_cache_len) {
			memmove(stdin_cache, stdin_cache + stdin_cache_pos,
				stdin_cache_len - stdin_cache_pos);
			stdin_cache_len -= stdin_cache_pos;
			stdin_cache_pos = 0;
		}
		if (stdin_cache_len + extra > STDIN_CACHE_CAP)
			extra = STDIN_CACHE_CAP - stdin_cache_len;
		if (extra > 0) {
			memcpy(stdin_cache + stdin_cache_len, tmp + 1, extra);
			stdin_cache_len += extra;
		}
	}
	stdin_fill_busy = 0;
	pthread_cond_broadcast(&stdin_cache_cv);
	pthread_mutex_unlock(&stdin_cache_mu);

	if (n <= 0) {
		errno = saved;
		return n;
	}
	((unsigned char *)buf)[0] = tmp[0];
	return 1;
}

int
ioctl(int fd, unsigned long request, ...)
{
	ioctl_fn next = load_ioctl();
	va_list ap;
	void *arg;
	int rc;
	int saved;
	size_t extra;
	int kernel_count;

	va_start(ap, request);
	arg = va_arg(ap, void *);
	va_end(ap);

	if (next == NULL) {
		errno = ENOSYS;
		return -1;
	}
	if (fd != 0 || (request != (unsigned long)FIONREAD
			&& request != (unsigned long)TIOCINQ))
		return next(fd, request, arg);

	rc = next(fd, request, arg);
	saved = errno;
	pthread_mutex_lock(&stdin_cache_mu);
	extra = cache_count();
	pthread_mutex_unlock(&stdin_cache_mu);
	if (extra == 0 || arg == NULL) {
		errno = saved;
		return rc;
	}
	if (rc < 0) {
		*(int *)arg = (int)extra;
		return 0;
	}
	kernel_count = *(int *)arg;
	if (kernel_count < 0)
		kernel_count = 0;
	if (extra > (size_t)INT_MAX - (size_t)kernel_count)
		*(int *)arg = INT_MAX;
	else
		*(int *)arg = kernel_count + (int)extra;
	return 0;
}

int
select(int nfds, fd_set *readfds, fd_set *writefds, fd_set *exceptfds,
       struct timeval *timeout)
{
	select_fn next = load_select();
	struct timeval slowed;

	if (next == NULL) {
		errno = ENOSYS;
		return -1;
	}
	if (fd0_in_read_set(nfds, readfds) && cache_pending()) {
		if (is_stdin_only_read(nfds, readfds, writefds, exceptfds)) {
			FD_SET(0, readfds);
			return 1;
		}
		return select_mark_cached_stdin(next, nfds, readfds, writefds,
						exceptfds);
	}
	if (is_stdin_only_read(nfds, readfds, writefds, exceptfds)
	    && timeout != NULL
	    && timeout->tv_sec == 0
	    && timeout->tv_usec == 0) {
		slowed.tv_sec = 0;
		slowed.tv_usec = (suseconds_t)STDIN_SPIN_MS * 1000;
		return next(nfds, readfds, writefds, exceptfds, &slowed);
	}
	return next(nfds, readfds, writefds, exceptfds, timeout);
}

int
pselect(int nfds, fd_set *readfds, fd_set *writefds, fd_set *exceptfds,
	const struct timespec *timeout, const sigset_t *sigmask)
{
	pselect_fn next = load_pselect();
	struct timespec slowed;

	if (next == NULL) {
		errno = ENOSYS;
		return -1;
	}
	if (fd0_in_read_set(nfds, readfds) && cache_pending()) {
		if (is_stdin_only_read(nfds, readfds, writefds, exceptfds)) {
			FD_SET(0, readfds);
			return 1;
		}
		return pselect_mark_cached_stdin(next, nfds, readfds, writefds,
						 exceptfds, sigmask);
	}
	if (is_stdin_only_read(nfds, readfds, writefds, exceptfds)
	    && timeout != NULL
	    && timeout->tv_sec == 0
	    && timeout->tv_nsec == 0) {
		slowed.tv_sec = 0;
		slowed.tv_nsec = (long)STDIN_SPIN_MS * 1000000L;
		return next(nfds, readfds, writefds, exceptfds, &slowed, sigmask);
	}
	return next(nfds, readfds, writefds, exceptfds, timeout, sigmask);
}
