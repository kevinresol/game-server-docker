#!/bin/bash
# Build libkernel32-shim.so and prove fd 0 is delivered one byte at a time.
set -euo pipefail

root=$(cd "$(dirname "$0")" && pwd)
cc=${CC:-gcc}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "cc: $cc -shared -fPIC -O2 -Wall -Wextra -Werror -o stdin_cache.so kernel32_shim.c"
"$cc" -shared -fPIC -O2 -Wall -Wextra -Werror -o "$tmp/stdin_cache.so" "$root/kernel32_shim.c"
echo "COMPILE_OK $($cc -dumpversion)"

cat > "$tmp/driver.c" << 'EOF'
#define _GNU_SOURCE

#include <errno.h>
#include <pthread.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/select.h>
#include <time.h>
#include <unistd.h>

static long long
elapsed_us(const struct timespec *start, const struct timespec *end)
{
	return (long long)(end->tv_sec - start->tv_sec) * 1000000LL
		+ (long long)(end->tv_nsec - start->tv_nsec) / 1000LL;
}

static unsigned char thread_byte;
static ssize_t thread_n = -1;
static volatile sig_atomic_t thread_entered;

static int
fail(const char *what)
{
	fprintf(stderr, "FAIL %s\n", what);
	return 1;
}

static void
on_alarm(int sig)
{
	(void)sig;
	fprintf(stderr, "FAIL blocked select timed out\n");
	_exit(2);
}

static void *
blocked_read(void *unused)
{
	unsigned char buf[100];

	(void)unused;
	thread_entered = 1;
	thread_n = read(0, buf, sizeof buf);
	if (thread_n == 1)
		thread_byte = buf[0];
	return NULL;
}

static long long
stdin_select(int *rc, int *ready)
{
	fd_set readfds;
	struct timeval timeout;
	struct timespec start, end;

	FD_ZERO(&readfds);
	FD_SET(0, &readfds);
	timeout.tv_sec = 0;
	timeout.tv_usec = 0;
	clock_gettime(CLOCK_MONOTONIC, &start);
	*rc = select(1, &readfds, NULL, NULL, &timeout);
	clock_gettime(CLOCK_MONOTONIC, &end);
	*ready = FD_ISSET(0, &readfds) ? 1 : 0;
	return elapsed_us(&start, &end);
}

int
main(void)
{
	int inbound[2];
	int other[2];
	int extra[2];
	unsigned char expect[5] = { 'h', 'e', 'l', 'p', 0x0a };
	unsigned char got[5];
	unsigned char buf[1024];
	unsigned char foreign[8];
	fd_set readfds;
	struct timeval timeout;
	struct timespec start, end;
	long long us;
	int rc;
	int ready;
	int i;
	int pending;
	ssize_t n;
	pthread_t reader;

	if (pipe(inbound) != 0)
		return fail("stdin pipe");
	if (dup2(inbound[0], 0) < 0)
		return fail("dup stdin");
	if (close(inbound[0]) != 0)
		return fail("close stdin read end");

	us = stdin_select(&rc, &ready);
	printf("empty_select_us=%lld rc=%d ready=%d\n", us, rc, ready);
	if (rc != 0 || ready != 0)
		return fail("empty select result");
	if (us < 7000 || us > 40000)
		return fail("empty select timing");

	if (write(inbound[1], expect, 5) != 5)
		return fail("write help");

	n = read(0, buf, sizeof buf);
	if (n != 1 || buf[0] != expect[0])
		return fail("first byte");
	got[0] = buf[0];

	us = stdin_select(&rc, &ready);
	printf("cached_select_us=%lld rc=%d ready=%d\n", us, rc, ready);
	if (rc != 1 || ready != 1)
		return fail("cached select result");
	if (us >= 5000)
		return fail("cached select timing");

	pending = -1;
	if (ioctl(0, FIONREAD, &pending) < 0)
		return fail("cached fionread");
	printf("cached_fionread=%d\n", pending);
	if (pending != 4)
		return fail("cached fionread count");

	if (pipe(other) != 0)
		return fail("other pipe");
	if (other[0] == 0)
		return fail("other fd is stdin");
	if (write(other[1], expect, 5) != 5)
		return fail("write other");
	pending = -1;
	if (ioctl(other[0], FIONREAD, &pending) < 0)
		return fail("other fionread");
	printf("other_fionread=%d\n", pending);
	if (pending != 5)
		return fail("other fionread metered");

	for (i = 1; i < 5; i++) {
		n = read(0, buf, sizeof buf);
		if (n != 1 || buf[0] != expect[i])
			return fail("later byte");
		got[i] = buf[0];
	}
	printf("bytes=%02x %02x %02x %02x %02x\n",
	       got[0], got[1], got[2], got[3], got[4]);
	if (got[4] != 0x0a)
		return fail("missing newline");

	us = stdin_select(&rc, &ready);
	printf("drained_select_us=%lld rc=%d ready=%d\n", us, rc, ready);
	if (rc != 0 || ready != 0)
		return fail("drained select result");
	if (us < 7000 || us > 40000)
		return fail("drained select timing");

	clock_gettime(CLOCK_MONOTONIC, &start);
	n = read(other[0], foreign, 5);
	clock_gettime(CLOCK_MONOTONIC, &end);
	us = elapsed_us(&start, &end);
	printf("other_read=%zd us=%lld\n", n, us);
	if (n != 5 || memcmp(foreign, expect, 5) != 0)
		return fail("other read metered");
	if (us >= 5000)
		return fail("other read slow");

	if (pipe(extra) != 0)
		return fail("extra pipe");
	FD_ZERO(&readfds);
	FD_SET(extra[0], &readfds);
	timeout.tv_sec = 0;
	timeout.tv_usec = 0;
	clock_gettime(CLOCK_MONOTONIC, &start);
	rc = select(extra[0] + 1, &readfds, NULL, NULL, &timeout);
	clock_gettime(CLOCK_MONOTONIC, &end);
	us = elapsed_us(&start, &end);
	ready = FD_ISSET(extra[0], &readfds) ? 1 : 0;
	printf("other_select_us=%lld rc=%d ready=%d\n", us, rc, ready);
	if (rc != 0 || ready != 0)
		return fail("other select result");
	if (us >= 5000)
		return fail("other select metered");

	/*
	 * A blocked fd-0 read must not hold the cache mutex. This select
	 * has an empty cache and no pending byte, so it still takes ~10 ms.
	 */
	signal(SIGALRM, on_alarm);
	alarm(3);
	thread_entered = 0;
	if (pthread_create(&reader, NULL, blocked_read, NULL) != 0)
		return fail("reader thread");
	while (!thread_entered)
		usleep(1000);
	usleep(20000);
	us = stdin_select(&rc, &ready);
	printf("blocked_select_us=%lld rc=%d ready=%d\n", us, rc, ready);
	if (rc != 0 || ready != 0)
		return fail("blocked select result");
	if (us < 7000 || us > 40000)
		return fail("blocked select timing");
	if (write(inbound[1], "Z", 1) != 1)
		return fail("unblock reader");
	if (pthread_join(reader, NULL) != 0)
		return fail("join reader");
	alarm(0);
	if (thread_n != 1 || thread_byte != 'Z')
		return fail("blocked read byte");

	printf("ALL_PASS\n");
	return 0;
}
EOF

"$cc" -O2 -Wall -Wextra -Werror -pthread -o "$tmp/driver" "$tmp/driver.c"
LD_PRELOAD="$tmp/stdin_cache.so" "$tmp/driver"
