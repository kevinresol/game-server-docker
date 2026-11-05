#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/prebuilt"
mkdir -p "$out"

docker run --rm --user root --platform linux/amd64 \
	-v "$root/shim:/src:ro" \
	-v "$out:/out" \
	kevinresol/base-dedicated-server:latest bash -lc '
set -e
python3 - <<'"'"'PY'"'"'
from pathlib import Path
path = Path("/etc/apt/sources.list.d/debian.sources")
snap = None
for line in path.read_text().splitlines():
    s = line.strip()
    if s.startswith("# http://snapshot.debian.org/archive/debian/") and "security" not in s:
        snap = s[2:].strip()
        break
if not snap:
    raise SystemExit("debian.sources is missing a Debian archive snapshot comment")
path.write_text(
    f"Types: deb\nURIs: {snap}\nSuites: trixie\nComponents: main\n"
    "Signed-By: /usr/share/keyrings/debian-archive-keyring.pgp\n"
)
PY
rm -f /etc/apt/sources.list.d/nodesource.sources
for attempt in 1 2 3 4 5; do
	apt-get -o Acquire::Check-Valid-Until=false -o Acquire::Retries=3 update \
	&& apt-get install -qqy --no-install-recommends gcc libc6-dev \
	&& break
	[ "$attempt" -eq 5 ] && exit 1
	echo "apt install failed (attempt $attempt), retrying..." >&2
	sleep $((attempt * 15))
done
gcc -shared -fPIC -O2 -Wall -Wextra -Werror -o /out/libkernel32-shim.so /src/kernel32_shim.c
gcc -Wall -Wextra -Werror -o /out/stn-pty /src/stn_pty.c -lutil
chown 1000:1000 /out/*
'

echo "Wrote $out/libkernel32-shim.so and $out/stn-pty"
