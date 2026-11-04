# Compile on the dedicated-server base image so the shim links the same
# glibc the game runs. This stage is discarded; the runtime image has no compiler.
FROM kevinresol/base-dedicated-server:latest AS shim-build

USER root
# debian.sources comments name the snapshot this image was built from.
# Compile against that snapshot so apt does not upgrade glibc past the runtime.
RUN python3 - <<'PY'
from pathlib import Path
import sys

path = Path("/etc/apt/sources.list.d/debian.sources")
lines = path.read_text().splitlines()
snap = None
replaced = 0
out = []
for line in lines:
    stripped = line.strip()
    if stripped.startswith("# http://snapshot.debian.org/"):
        snap = stripped[2:].strip()
        out.append(line)
        continue
    if stripped.startswith("URIs: http://deb.debian.org/") and snap:
        out.append("URIs: " + snap)
        replaced += 1
        snap = None
        continue
    out.append(line)
if replaced != 2:
    sys.stderr.write(
        f"ERROR: expected to retarget 2 Debian apt URIs at the image snapshot, "
        f"retargeted {replaced}. Refusing to compile against a different glibc.\n"
    )
    sys.exit(1)
path.write_text("\n".join(out) + "\n")
PY
RUN rm -f /etc/apt/sources.list.d/nodesource.sources \
	&& apt-get -o Acquire::Check-Valid-Until=false update \
	&& apt-get install -qqy --no-install-recommends gcc libc6-dev \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY shim/kernel32_shim.c shim/stn_pty.c /src/
RUN mkdir /out \
	&& gcc -shared -fPIC -O2 -Wall -Wextra -Werror -o /out/libkernel32-shim.so kernel32_shim.c \
	&& gcc -Wall -Wextra -Werror -o /out/stn-pty stn_pty.c -lutil

# Install stage matches the previous image through the Steam download so that
# layer can be reused. GAME_LOG_FILE is intentionally not set on the runtime stage.
FROM kevinresol/base-dedicated-server:latest AS game

ARG BRANCH=public

# internal vars
ENV GAME_BIN_PATH="/home/steam/Steam/steamapps/common/StationeersDedicatedServer"
ENV GAME_DATA_PATH="/data"
ENV GAME_LOG_FILE="/home/steam/stationeers.log"

# client-download.steampowered.com CNAMEs to update.client.steamcontent.akadns.net,
# which currently has no IPv4 A record. SteamCMD requests A records only.
USER root
RUN set -eu; \
	echo "steamcmd DNS diag: ipv6_disable=$(cat /proc/sys/net/ipv6/conf/all/disable_ipv6)"; \
	echo "steamcmd DNS diag: client-download A=$(getent ahostsv4 client-download.steampowered.com | awk 'NF && $1 ~ /^[0-9.]+$/ {print $1; exit}' || true)"; \
	IP="$(getent ahostsv4 media.steampowered.com | awk 'NF && $1 ~ /^[0-9.]+$/ {print $1; exit}')"; \
	test -n "$IP"; \
	printf '%s\tclient-download.steampowered.com\n' "$IP" >> /etc/hosts; \
	echo "steamcmd DNS diag: mapped client-download -> ${IP}"
USER steam

# install game
RUN ./steamcmd.sh \
	+force_install_dir ${GAME_BIN_PATH} \
	+login anonymous \
	+app_update 600760 -beta ${BRANCH} validate \
	+logoff +quit

RUN ln -sf "$GAME_DATA_PATH" "${GAME_BIN_PATH}/saves"

FROM kevinresol/base-dedicated-server:latest

# internal vars
ENV GAME_BIN_PATH="/home/steam/Steam/steamapps/common/StationeersDedicatedServer"
ENV GAME_DATA_PATH="/data"

USER root
# ncurses-base already ships xterm on this image. Install it only when the entry is absent.
RUN if [ ! -f /usr/share/terminfo/x/xterm ] \
	&& [ ! -f /usr/lib/terminfo/x/xterm ] \
	&& [ ! -f /lib/terminfo/x/xterm ]; then \
		apt-get update \
		&& apt-get install -qqy --no-install-recommends ncurses-base \
		&& rm -rf /var/lib/apt/lists/*; \
	fi \
	&& { [ -f /usr/share/terminfo/x/xterm ] \
		|| [ -f /usr/lib/terminfo/x/xterm ] \
		|| [ -f /lib/terminfo/x/xterm ]; }

USER steam
RUN mkdir -p /home/steam/shim

COPY --from=game --chown=steam:steam /home/steam/Steam /home/steam/Steam
COPY --from=shim-build --chown=steam:steam /out/libkernel32-shim.so /out/stn-pty /home/steam/shim/

# Insert the S1 dllentry lines inside the existing kernel32 map, after the
# four __Internal entries. A missing or reshaped block fails the build.
RUN python3 - <<'PY'
import os
import re
import sys

path = os.environ["GAME_BIN_PATH"] + "/rocketstation_DedicatedServer_Data/MonoBleedingEdge/etc/mono/config"
try:
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
except FileNotFoundError:
    sys.stderr.write(
        f"ERROR: Mono config not found at {path}. "
        "The kernel32 dllmap block cannot be updated. Refusing to build.\n"
    )
    sys.exit(1)

pattern = re.compile(
    "(^[ \t]*<dllmap dll=\"i:kernel32.dll\">\n"
    "(?:.*\n)*?)"
    "(^[ \t]*</dllmap>[ \t]*$)",
    re.MULTILINE,
)
matches = list(pattern.finditer(text))
if not matches:
    if '<dllmap dll="i:kernel32.dll">' not in text:
        sys.stderr.write(
            f'ERROR: {path} is missing <dllmap dll="i:kernel32.dll">. '
            "Refusing to build.\n"
        )
    else:
        sys.stderr.write(
            f'ERROR: <dllmap dll="i:kernel32.dll"> in {path} is not a closed block. '
            "Refusing to build.\n"
        )
    sys.exit(1)
if len(matches) != 1:
    sys.stderr.write(
        f'ERROR: {path} contains {len(matches)} <dllmap dll="i:kernel32.dll"> blocks. '
        "Refusing to build.\n"
    )
    sys.exit(1)

block = matches[0].group(0)
cursor = 0
for needle in (
    'dll="__Internal" name="CopyMemory"',
    'dll="__Internal" name="FillMemory"',
    'dll="__Internal" name="MoveMemory"',
    'dll="__Internal" name="ZeroMemory"',
):
    found = block.find(needle, cursor)
    if found < 0:
        sys.stderr.write(
            f"ERROR: kernel32 dllmap block in {path} is missing {needle} "
            "after the block start. Refusing to insert shim dllentry lines.\n"
        )
        sys.exit(1)
    cursor = found + len(needle)

entries = (
    '\t\t<dllentry dll="/home/steam/shim/libkernel32-shim.so" '
    'name="SetConsoleOutputCP" target="SetConsoleOutputCP"/>\n'
    '\t\t<dllentry dll="/home/steam/shim/libkernel32-shim.so" '
    'name="SetConsoleCP" target="SetConsoleCP"/>\n'
)
match = matches[0]
updated = text[: match.start()] + match.group(1) + entries + match.group(2) + text[match.end() :]
with open(path, "w", encoding="utf-8") as fh:
    fh.write(updated)
PY

COPY --chown=steam:steam dist/tool.js /home/steam/tool.js
COPY --chown=steam:steam entrypoint.sh /home/steam/entrypoint.sh

WORKDIR /home/steam

ENTRYPOINT [ "/home/steam/entrypoint.sh" ]
