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
 */

#define _GNU_SOURCE

#include <dlfcn.h>
#include <errno.h>
#include <stddef.h>
#include <stdint.h>
#include <sys/select.h>

#ifdef select
#undef select
#endif
#ifdef pselect
#undef pselect
#endif

/* S1's measured substitute: pselect6 tv_nsec=10000000. */
enum { STDIN_SPIN_MS = 10 };

typedef int (*select_fn)(int, fd_set *, fd_set *, fd_set *, struct timeval *);
typedef int (*pselect_fn)(int, fd_set *, fd_set *, fd_set *,
			  const struct timespec *, const sigset_t *);

static void *next_select;
static void *next_pselect;

__attribute__((constructor)) static void
resolve_next(void)
{
	__atomic_store_n(&next_select, dlsym(RTLD_NEXT, "select"), __ATOMIC_RELEASE);
	__atomic_store_n(&next_pselect, dlsym(RTLD_NEXT, "pselect"), __ATOMIC_RELEASE);
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
