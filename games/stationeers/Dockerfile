# Native shims are built on kevinresol/base-dedicated-server (same glibc as the game)
# and checked in under prebuilt/. Regenerate with shim/build-prebuilt.sh when the
# base image snapshot or shim sources change.
FROM kevinresol/base-dedicated-server:latest AS game

ARG BRANCH=public

# internal vars
ENV GAME_BIN_PATH="/home/steam/Steam/steamapps/common/StationeersDedicatedServer"
ENV GAME_DATA_PATH="/data"
ENV GAME_LOG_FILE="/home/steam/stationeers.log"

# install game
RUN set -eu; \
	for attempt in 1 2 3 4 5; do \
		./steamcmd.sh \
			+force_install_dir "${GAME_BIN_PATH}" \
			+login anonymous \
			+app_update 600760 -beta "${BRANCH}" validate \
			+logoff +quit || true; \
		if [ -f /home/steam/Steam/steamapps/appmanifest_600760.acf ]; then break; fi; \
		if [ -d "${GAME_BIN_PATH}" ] && ls -A "${GAME_BIN_PATH}" >/dev/null 2>&1; then break; fi; \
		echo "steamcmd app_update failed (attempt ${attempt}), retrying..." >&2; \
		[ "${attempt}" -eq 5 ] && exit 1; \
		sleep $((attempt * 30)); \
	done

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
COPY --chown=steam:steam prebuilt/libkernel32-shim.so prebuilt/stn-pty /home/steam/shim/

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
