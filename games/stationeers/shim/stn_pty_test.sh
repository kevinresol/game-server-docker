#!/bin/bash
# Prove stn-pty against a trivial child. Run under: docker run -i (no -t).
set -euo pipefail

root=$(cd "$(dirname "$0")" && pwd)
cc=${CC:-gcc}

echo "cc: $cc -Wall -Wextra -Werror -o /tmp/stn-pty stn_pty.c -lutil"
"$cc" -Wall -Wextra -Werror -o /tmp/stn-pty "$root/stn_pty.c" -lutil
echo "COMPILE_OK $($cc -dumpversion)"

cat > /tmp/marker.c << 'EOF'
void stn_marker(void) {}
EOF
"$cc" -shared -fPIC -Wall -Wextra -Werror -o /tmp/marker.so /tmp/marker.c

cat > /tmp/probe.c << 'EOF'
#define _GNU_SOURCE
#include <dirent.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
int main(void) {
    DIR *d;
    struct dirent *ent;
    int bad = 0;
    printf("isatty0=%d\n", isatty(0));
    printf("isatty1=%d\n", isatty(1));
    printf("isatty2=%d\n", isatty(2));
    d = opendir("/proc/self/fd");
    if (d == NULL) {
        return 1;
    }
    while ((ent = readdir(d)) != NULL) {
        char path[512];
        char buf[512];
        ssize_t n;
        if (ent->d_name[0] == '.') {
            continue;
        }
        snprintf(path, sizeof path, "/proc/self/fd/%s", ent->d_name);
        n = readlink(path, buf, sizeof buf - 1);
        if (n < 0) {
            continue;
        }
        buf[n] = '\0';
        printf("fd %s %s\n", ent->d_name, buf);
        if (strcmp(ent->d_name, "0") == 0 || strcmp(ent->d_name, "1") == 0
            || strcmp(ent->d_name, "2") == 0) {
            if (strncmp(buf, "/dev/pts/", 9) != 0) {
                bad = 1;
            }
        } else if (strncmp(buf, "pipe:", 5) == 0 || strncmp(buf, "socket:", 7) == 0
            || strcmp(buf, "/dev/null") == 0) {
            bad = 1;
        }
    }
    closedir(d);
    return bad ? 1 : 0;
}
EOF
"$cc" -Wall -Wextra -o /tmp/probe /tmp/probe.c

cat > /tmp/child.sh << 'EOF'
#!/bin/bash
set -euo pipefail
mode=${1:-info}
show_env() {
  local name=$1
  if [ -z "${!name+x}" ]; then
    echo "${name}=<unset>"
  else
    echo "${name}=${!name}"
  fi
}
case "$mode" in
  info)
    if [ -t 0 ]; then echo isatty0=1; else echo isatty0=0; fi
    if [ -t 1 ]; then echo isatty1=1; else echo isatty1=0; fi
    if [ -t 2 ]; then echo isatty2=1; else echo isatty2=0; fi
    show_env TERM
    show_env LANG
    show_env LC_ALL
    printf 'SIZE='
    stty size
    echo STTY_BEGIN
    stty -a
    echo STTY_END
    echo FDS_BEGIN
    for f in /proc/$$/fd/*; do
      echo "fd ${f##*/} $(readlink "$f")"
    done
    echo FDS_END
    ;;
  lines)
    while IFS= read -r line; do
      printf 'got:%s\n' "$line"
      case "$line" in
        exit:*) exit "${line#exit:}" ;;
      esac
    done
    echo CHILD-READ-EOF
    exit 1
    ;;
  bytes)
    stty -icanon -echo -icrnl min 1 time 0
    echo bytes-armed
    dd ibs=1 count=2 status=none | od -An -tx1
    ;;
  selfkill)
    kill -KILL $$
    ;;
  signals)
    trap 'echo got-sigterm; exit 7' TERM
    trap 'echo got-sigint; exit 6' INT
    trap 'echo got-sighup; exit 8' HUP
    echo "pid:$$"
    echo ready
    while true; do sleep 1; done
    ;;
  eoftest)
    trap 'echo got-sighup; exit 8' HUP
    echo "pid:$$"
    echo ready
    if IFS= read -r line; then
      echo "got:$line"
    else
      echo CHILD-READ-EOF
      exit 1
    fi
    ;;
  nulltest)
    trap 'echo got-sighup; exit 8' HUP
    echo "pid:$$"
    if [ -t 0 ]; then echo isatty0=1; else echo isatty0=0; fi
    if [ -t 1 ]; then echo isatty1=1; else echo isatty1=0; fi
    echo ready
    sleep 6
    echo still-alive
    ;;
  preload)
    echo "pid:$$"
    show_env LD_PRELOAD
    show_env STN_PTY_SAVED_PRELOAD
    show_env STN_PTY_REEXECED
    echo ready
    sleep 30
    ;;
  bulk)
    dd if=/dev/zero bs=1024 count=64 status=none | tr '\0' 'B'
    ;;
  *)
    echo "unknown mode $mode" >&2
    exit 2
    ;;
esac
EOF
chmod +x /tmp/child.sh

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

strip() {
  tr -d '\r' < "$1"
}

wait_for() {
  local file=$1 needle=$2 tries=${3:-50} i
  for ((i = 0; i < tries; i++)); do
    if strip "$file" | grep -q -- "$needle"; then
      return 0
    fi
    sleep 0.1
  done
  echo "timed out waiting for '$needle' in $file" >&2
  strip "$file" >&2 || true
  return 1
}

cpu_ticks() {
  awk '{
    line = $0
    sub(/^.*\) /, "", line)
    split(line, a, " ")
    print a[12] + a[13]
  }' "/proc/$1/stat"
}

proc_state() {
  awk '{
    line = $0
    sub(/^.*\) /, "", line)
    split(line, a, " ")
    print a[1]
  }' "/proc/$1/stat"
}

pids=""
track() { pids="$pids $1"; }
cleanup() {
  local p
  exec 8>&- 2>/dev/null || true
  exec 9>&- 2>/dev/null || true
  for p in $pids; do
    kill "$p" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT

echo "==== container stdio (docker run -i, no -t) ===="
if [ -t 0 ]; then container_in=1; else container_in=0; fi
if [ -t 1 ]; then container_out=1; else container_out=0; fi
echo "container_stdin_isatty=$container_in"
echo "container_stdout_isatty=$container_out"
echo "container_fd0=$(readlink /proc/self/fd/0)"
echo "container_fd1=$(readlink /proc/self/fd/1)"
[ "$container_in" = 0 ] || fail "container stdin is a tty; re-run with docker run -i and without -t"
[ "$container_out" = 0 ] || fail "container stdout is a tty; re-run without -t"

echo "==== child tty, window, TERM, locale, line discipline ===="
env -u TERM LANG=C.UTF-8 LC_ALL=C.UTF-8 /tmp/stn-pty /tmp/child.sh info > /tmp/info.out
strip /tmp/info.out | tee /tmp/info.txt
grep -qx 'isatty0=1' /tmp/info.txt || fail "fd 0 is not a tty"
grep -qx 'isatty1=1' /tmp/info.txt || fail "fd 1 is not a tty"
grep -qx 'isatty2=1' /tmp/info.txt || fail "fd 2 is not a tty"
grep -qx 'TERM=xterm' /tmp/info.txt || fail "unset TERM did not become xterm"
grep -qx 'LANG=C.UTF-8' /tmp/info.txt || fail "LANG was rewritten"
grep -qx 'LC_ALL=C.UTF-8' /tmp/info.txt || fail "LC_ALL was rewritten"
grep -qx 'SIZE=30 80' /tmp/info.txt || fail "window is not 30x80"
grep -q 'rows 30;' /tmp/info.txt || fail "stty rows"
grep -q 'columns 80;' /tmp/info.txt || fail "stty columns"
for flag in opost icanon icrnl isig; do
  grep -Eq "(^|[[:space:]])${flag}([[:space:]]|$)" /tmp/info.txt || fail "missing $flag"
done
grep -Eq '(^|[[:space:]])-onlcr([[:space:]]|$)' /tmp/info.txt || fail "ONLCR is still on"
for flag in -opost -icanon -icrnl; do
  if grep -Eq "(^|[[:space:]])${flag}([[:space:]]|$)" /tmp/info.txt; then
    fail "raw-mode flag present: $flag"
  fi
done
echo "---- exec probe (no shell) ----"
set +e
/tmp/stn-pty /tmp/probe </dev/null > /tmp/probe.out
prc=$?
set -e
strip /tmp/probe.out | tee /tmp/probe.txt
echo "probe_rc=$prc"
echo "note: a bash child may show an extra pipe fd; that is bash's self-pipe. The probe is the exec image."
[ "$prc" = 0 ] || fail "probe saw a leaked fd or a non-tty stdio"
grep -qx 'isatty0=1' /tmp/probe.txt || fail "probe fd 0"
grep -qx 'isatty1=1' /tmp/probe.txt || fail "probe fd 1"
grep -qx 'isatty2=1' /tmp/probe.txt || fail "probe fd 2"
echo "PASS tty/window/term/locale/defaults"

echo "==== TERM=dumb and TERM=vt220 ===="
env TERM=dumb /tmp/stn-pty /tmp/child.sh info </dev/null > /tmp/term-dumb.out
strip /tmp/term-dumb.out | grep -qx 'TERM=xterm' || fail "dumb TERM was not replaced"
echo "dumb_TERM=xterm"
env TERM=vt220 /tmp/stn-pty /tmp/child.sh info </dev/null > /tmp/term-vt.out
strip /tmp/term-vt.out | grep -qx 'TERM=vt220' || fail "vt220 was overwritten"
echo "vt220_TERM=vt220"
echo "PASS term rules"

echo "==== ONLCR and Enter byte 0x0a ===="
/tmp/stn-pty /bin/echo hello </dev/null > /tmp/echo.out
od -An -tx1 /tmp/echo.out | tee /tmp/echo.hex
grep -q '68 65 6c 6c 6f 0a' /tmp/echo.hex || fail "echo output was not LF"
if grep -q '0d' /tmp/echo.hex; then
  fail "echo output still contains CR"
fi
echo "PASS onlcr off, echo is lf"

rm -f /tmp/bytes.in
mkfifo /tmp/bytes.in
exec 8<>/tmp/bytes.in
/tmp/stn-pty /tmp/child.sh bytes < /tmp/bytes.in > /tmp/bytes.out &
bpid=$!
track "$bpid"
wait_for /tmp/bytes.out bytes-armed
printf 'a\n' >&8
set +e
wait "$bpid"
brc=$?
set -e
echo "bytes_rc=$brc"
strip /tmp/bytes.out | tee /tmp/bytes.txt
grep -q '61 0a' /tmp/bytes.txt || fail "helper did not deliver 0x0a"
if grep -q '61 0d' /tmp/bytes.txt; then
  fail "helper delivered CR instead of LF"
fi
[ "$brc" = 0 ] || fail "bytes child status $brc"
echo "PASS enter byte 0a"

echo "==== input lines and exit status 42 ===="
set +e
printf 'hello\nexit:42\n' | /tmp/stn-pty /tmp/child.sh lines > /tmp/lines.out
lrc=$?
set -e
echo "lines_rc=$lrc"
strip /tmp/lines.out | tee /tmp/lines.txt
grep -qx 'got:hello' /tmp/lines.txt || fail "line did not reach child"
grep -qx 'got:exit:42' /tmp/lines.txt || fail "exit line did not reach child"
if grep -q CHILD-READ-EOF /tmp/lines.txt; then
  fail "child saw stdin EOF"
fi
[ "$lrc" = 42 ] || fail "expected exit 42, got $lrc"
echo "PASS lines and status 42"

echo "==== normal status 3 and no zombie ===="
set +e
zpid=$(/tmp/stn-pty /bin/sh -c 'echo $$; exit 3' </dev/null | tr -d '\r')
zrc=$?
set -e
echo "exit3_rc=$zrc child_pid=$zpid"
[ "$zrc" = 3 ] || fail "expected exit 3, got $zrc"
if [ -d "/proc/$zpid" ]; then
  echo "child_still_present state=$(proc_state "$zpid" 2>/dev/null || echo missing)"
  fail "child pid $zpid still in /proc"
fi
echo "PASS exit 3 reaped"

echo "==== signal death 137 ===="
set +e
/tmp/stn-pty /tmp/child.sh selfkill </dev/null > /tmp/sk.out
skrc=$?
set -e
echo "selfkill_rc=$skrc"
[ "$skrc" = 137 ] || fail "expected 137, got $skrc"
echo "PASS signal status 137"

signal_forward() {
  local sig=$1 needle=$2 expect=$3 absent=$4 outfile=/tmp/sig-$1.out h cpid rc
  /tmp/stn-pty /tmp/child.sh signals </dev/null > "$outfile" &
  h=$!
  track "$h"
  wait_for "$outfile" ready
  cpid=$(strip "$outfile" | sed -n 's/^pid://p' | head -1)
  kill -0 "$cpid"
  sigblk=$(awk '/^SigBlk:/{print $2}' "/proc/$cpid/status")
  echo "child_sigblk=$sigblk"
  # SIGINT is bit 1, SIGTERM is bit 14. A blocked bit would queue the signal forever.
  if [ $((0x$sigblk & 0x4002)) -ne 0 ]; then
    fail "SIGINT or SIGTERM is blocked in the child ($sigblk)"
  fi
  kill -s "$sig" "$h"
  set +e
  wait "$h"
  rc=$?
  set -e
  echo "forward_${sig}_rc=$rc"
  strip "$outfile" | tee "${outfile}.txt"
  grep -qx "$needle" "${outfile}.txt" || fail "$sig was not delivered to the child"
  if [ -n "$absent" ] && grep -qx "$absent" "${outfile}.txt"; then
    fail "$sig was delivered as $absent"
  fi
  if grep -q got-sighup "${outfile}.txt"; then
    fail "$sig path delivered SIGHUP"
  fi
  [ "$rc" = "$expect" ] || fail "$sig status $rc wanted $expect"
  if kill -0 "$cpid" 2>/dev/null; then
    fail "child $cpid still alive after $sig"
  fi
  echo "PASS forward $sig"
}

echo "==== SIGTERM becomes SIGINT, SIGINT stays SIGINT ===="
signal_forward TERM got-sigint 6 got-sigterm
signal_forward INT got-sigint 6 got-sigterm
echo "PASS signals forwarded"

echo "==== stdin EOF leaves the child running ===="
rm -f /tmp/eof.in
mkfifo /tmp/eof.in
exec 9<>/tmp/eof.in
/tmp/stn-pty /tmp/child.sh eoftest < /tmp/eof.in > /tmp/eof.out &
epid=$!
track "$epid"
wait_for /tmp/eof.out ready
sleep 0.3
cpid=$(strip /tmp/eof.out | sed -n 's/^pid://p' | head -1)
kill -0 "$cpid"
exec 9>&-
sleep 0.3
kill -0 "$cpid" || fail "child died when helper stdin reached EOF"
if strip /tmp/eof.out | grep -q got-sighup; then
  fail "SIGHUP on explicit EOF"
fi
if strip /tmp/eof.out | grep -q CHILD-READ-EOF; then
  fail "child read returned EOF"
fi
e1=$(cpu_ticks "$epid")
sleep 3
e2=$(cpu_ticks "$epid")
edelta=$((e2 - e1))
echo "explicit_eof_cpu_ticks_3s=$edelta state=$(proc_state "$epid") child_alive=1"
[ "$edelta" -lt 20 ] || fail "helper spun on explicit EOF ($edelta ticks)"
kill -0 "$cpid" || fail "child died during explicit-EOF sample"
kill -TERM "$epid" 2>/dev/null || true
set +e
wait "$epid"
set -e
echo "PASS explicit EOF"

echo "==== /dev/null stdin leaves the child running ===="
/tmp/stn-pty /tmp/child.sh nulltest </dev/null > /tmp/null.out &
npid=$!
track "$npid"
wait_for /tmp/null.out ready
strip /tmp/null.out | tee /tmp/null.txt
grep -qx 'isatty0=1' /tmp/null.txt || fail "nulltest fd 0 is not a tty"
grep -qx 'isatty1=1' /tmp/null.txt || fail "nulltest fd 1 is not a tty"
nchild=$(sed -n 's/^pid://p' /tmp/null.txt | head -1)
kill -0 "$nchild"
n1=$(cpu_ticks "$npid")
sleep 3
n2=$(cpu_ticks "$npid")
ndelta=$((n2 - n1))
echo "devnull_eof_cpu_ticks_3s=$ndelta state=$(proc_state "$npid") child_alive=1"
[ "$ndelta" -lt 20 ] || fail "helper spun on /dev/null ($ndelta ticks)"
kill -0 "$nchild" || fail "child died on /dev/null stdin"
wait_for /tmp/null.out still-alive 80
if strip /tmp/null.out | grep -q got-sighup; then
  fail "SIGHUP on /dev/null stdin"
fi
set +e
wait "$npid"
nrc=$?
set -e
echo "devnull_rc=$nrc"
[ "$nrc" = 0 ] || fail "nulltest helper status $nrc"
echo "PASS /dev/null EOF"

echo "==== bulk copy ===="
set +e
timeout 15 /tmp/stn-pty /tmp/child.sh bulk </dev/null > /tmp/bulk.out
brc=$?
set -e
bsize=$(wc -c < /tmp/bulk.out | tr -d ' ')
echo "bulk_rc=$brc bulk_bytes=$bsize"
[ "$brc" = 0 ] || fail "bulk status $brc"
[ "$bsize" = 65536 ] || fail "bulk size $bsize"
echo "PASS bulk 65536"

echo "==== exec failure and usage ===="
set +e
/tmp/stn-pty /no/such/stn-pty-prog </dev/null > /tmp/nf.out 2> /tmp/nf.err
nfrc=$?
set -e
echo "notfound_rc=$nfrc"
echo "notfound_stderr=$(cat /tmp/nf.err)"
echo "notfound_stdout_bytes=$(wc -c < /tmp/nf.out | tr -d ' ')"
[ "$nfrc" = 127 ] || fail "notfound status $nfrc"
grep -q 'stn-pty: exec /no/such/stn-pty-prog:' /tmp/nf.err || fail "exec diagnostic not on stderr"
set +e
/tmp/stn-pty > /tmp/usage.out 2> /tmp/usage.err
urc=$?
set -e
echo "usage_rc=$urc"
echo "usage_stderr=$(cat /tmp/usage.err)"
[ "$urc" = 2 ] || fail "usage status $urc"
grep -q 'usage: stn-pty <program> \[args...\]' /tmp/usage.err || fail "usage text"
echo "PASS exec and usage"

preload_case() {
  local label=$1 ld=$2 expect=$3 outfile=/tmp/pre-$1.out h cpid
  env LD_PRELOAD="$ld" /tmp/stn-pty /tmp/child.sh preload </dev/null > "$outfile" &
  h=$!
  track "$h"
  wait_for "$outfile" ready
  cpid=$(strip "$outfile" | sed -n 's/^pid://p' | head -1)
  echo "---- preload $label helper=$h child=$cpid ----"
  strip "$outfile" | tee "${outfile}.txt"
  echo "helper_maps:"
  if grep marker.so "/proc/$h/maps"; then
    fail "helper is preloaded ($label)"
  fi
  echo "(no marker.so)"
  echo "child_maps:"
  grep marker.so "/proc/$cpid/maps" || fail "child was not preloaded ($label)"
  echo "helper_initial_environ:"
  tr '\0' '\n' < "/proc/$h/environ" | grep -E '^(LD_PRELOAD|STN_PTY_)' || echo "(no LD_PRELOAD or STN_PTY_*)"
  if tr '\0' '\n' < "/proc/$h/environ" | grep -q '^LD_PRELOAD='; then
    fail "helper initial environment has LD_PRELOAD ($label)"
  fi
  grep -qx "LD_PRELOAD=$expect" "${outfile}.txt" || fail "child LD_PRELOAD ($label)"
  grep -qx 'STN_PTY_SAVED_PRELOAD=<unset>' "${outfile}.txt" || fail "saved preload leaked ($label)"
  grep -qx 'STN_PTY_REEXECED=<unset>' "${outfile}.txt" || fail "reexec marker leaked ($label)"
  kill -KILL "$h" 2>/dev/null || true
  set +e
  wait "$h"
  set -e
  echo "PASS preload $label"
}

echo "==== LD_PRELOAD reaches the child, not the helper ===="
preload_case lib /tmp/marker.so /tmp/marker.so
preload_case strip "/tmp/stn-pty:/tmp/marker.so" /tmp/marker.so

echo "ALL_PASS"
