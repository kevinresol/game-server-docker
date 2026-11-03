# Stationeers Dedicated Server

## Run Server

```sh
docker run -d \
  -v $(pwd)/stationeers:/data \
  -p 27016:27016/udp -p 27015:27015/udp \
  [-p 27500:27500/tcp] \
  [-e GAME_LOG_FILE=/home/steam/stationeers.log] \
  [-e GAME_PRE_SHUTDOWN=/data/pre-shutdown.sh] \
  kevinresol/stationeers-dedicated-server:latest \
  [--rcon=27500] \
  [-file start MarsBase Mars2 Normal] \
  [-settings StartLocalHost true ServerVisible true LocalIpAddress 0.0.0.0 GamePort 27016 ServerName "Stationeers Server" ServerPassword change-this-password ServerAuthSecret change-this-rcon-secret ServerMaxPlayers 8 UPNPEnabled false SaveInterval 150 UseSteamP2P false] \
  [...]
```

Commands go to the container's stdin. `docker run -i` accepted one write of `save stnshim1` followed by a newline, and the save appeared at `/data/stnshim1/stnshim1.save`. `docker run -it` accepted one write of `help` and printed the command list. A container started with `-i` keeps that stdin open, so a later `docker attach` writes to the same console.

```sh
docker run -i \
  -v $(pwd)/stationeers:/data \
  -p 27016:27016/udp -p 27015:27015/udp \
  kevinresol/stationeers-dedicated-server:latest \
  -file start MarsBase Mars2 Normal \
  [...]
```

`docker stop -t 15` let the server exit. One run finished in 3.5s with code 143, and another finished in 10.4s with code 0. The wrapper logged `Server process exited with code:  0`. Allow at least 15 seconds. A bare `docker stop` was killed with 137 when the daemon's default grace was about 3 seconds.

With the console active, no clients, and the server idle, a 60s sample measured the game at 31.7% of one core. The accepted ceiling for that sample is 42.5% of one core, 15 points above the old direct-spawn idle sample of 27.5% of one core.

## Script Arguments

Arguments after the image name are forwarded to the Stationeers server executable. The example shows common optional server arguments; omit any that you do not need. `-file start` takes positional arguments: a required save name, a world id that is required only when that station does not exist yet, and an optional difficulty that defaults to `Normal`. The first-run example is `MarsBase Mars2 Normal`. On a new volume, omitting the world id fails. `-settings` takes key and value pairs. `StartLocalHost true`, `ServerVisible true`, and `LocalIpAddress 0.0.0.0` belong in the same `-settings` argument as the other pairs (do not repeat `-settings` for each group). `StartLocalHost true` in the example is an ordinary settings pair. This image runs the dedicated-server build, where hosting already happens because `IsBatchMode` is always true. `GamePort 27016` matches the published game port. Also publish UDP `27015`, which the dedicated server guide lists as the Steam update port; the game setting `UpdatePort` is unused in current builds—publishing `27015/udp` is still recommended for browser/query behavior.

In Docker you must set **`UPNPEnabled false`** and **`UseSteamP2P false`** in the same `-settings` line. UPnP inside a container cannot configure the host router, and Steam P2P routing is wrong for a published dedicated port. Leaving either at the game default (`true`) often breaks LAN or direct joins even when ports are published.

The wrapper adds `-noclear` unless the arguments already include `-noclear`.

See the [Stationeers dedicated server guide](https://stationeers-wiki.com/Dedicated_Server_Guide) for world ids, settings, and startup arguments.

With Docker Compose, put the same optional server arguments in the service's `command` list.

## Configuration

`GAME_LOG_FILE` is the console log path the helper uses when `--log-file` is omitted. Optional `--log-file /home/steam/stationeers.log` duplicates console stdout into that file. It does not receive Unity's `Player.log`. `entrypoint.sh` places container arguments after `--`. With `docker run`, set `-e GAME_LOG_FILE=/home/steam/stationeers.log`.

A container argument `-logfile` or `-logFile` is rejected (`Do not specify -logfile manually in the rest arguments, use the --log-file flag or GAME_LOG_FILE env var instead.`). The game does not start.

The helper writes one stderr line: `Player.log was not found under ~/.config/unity3d; Unity's file log will not be mirrored`. A normal run may only show that warning. Users who read Unity lines from the old `--log-file` will not find them there.

With Docker Compose, put `GAME_LOG_FILE` in the service's `environment` map.

## Source RCON

Pass `--rcon` or `--rcon=27500` as a container argument (the entrypoint forwards it to the helper, not to the game executable). A bare `--rcon` listens on TCP port 27500; `--rcon=27015` listens on 27015 instead. Publish the chosen TCP port yourself, for example `-p 27500:27500/tcp`. The protocol is Valve Source RCON over TCP.

The RCON password is not a separate setting. Authenticate with the exact text of the `ServerAuthSecret` element in `setting.xml` at the dedicated-server install directory (the directory that contains the server binary). That file is not on the `/data` volume unless you point the game elsewhere. Launch settings such as `-settings ServerAuthSecret change-this-secret` are what the game writes into that file. A `-settingspath` argument followed by a path makes the helper read `ServerAuthSecret` from that file instead of the install-root `setting.xml`.

Each authenticated command is one line on the server console. The RCON response body is the console text up to the idle `> ` prompt at column 0, with terminal control bytes removed. Output that appears after the console has returned to that idle prompt again, such as a late `Created new save` line, is not part of that response.

RCON shares the same console stdin writer as container stdin. The optional `--pre-shutdown` hook (`GAME_PRE_SHUTDOWN`) is independent: when set, the helper can run a shell command on SIGTERM or SIGINT before it writes the same console `quit` line used without the hook. RCON and the hook do not require each other. Enabling RCON does not add HTTP access or a `/console/run` endpoint.

With RCON only and no pre-shutdown hook, `docker stop` grace is unchanged from the guidance above: allow at least 15 seconds (for example `docker stop -t 15`). If you enable `--pre-shutdown`, set Docker `--stop-timeout` or Compose `stop_grace_period` using the **Pre-shutdown hook** section below so the hook and console `quit` can finish.

## Pre-shutdown hook

The helper can run a shell command on **SIGTERM** or **SIGINT** before it writes the same console `quit` line used when no hook is configured. Docker stop sends SIGTERM to the entrypoint, which forwards it to the Node runner; interactive `docker run -it` sends SIGINT on Ctrl+C. The first signal starts shutdown; a second signal during the same stop does not run the hook again. There is no built-in autosave or RCON-on-shutdown command—the hook is how you run custom logic (for example a save line) during an orderly stop. Source RCON (`--rcon`) is optional and documented above; it shares the console stdin writer but does not replace the hook.

Set **`GAME_PRE_SHUTDOWN`** to the command string (for example `-e GAME_PRE_SHUTDOWN=/data/pre-shutdown.sh` on `docker run`, or the same key in Compose `environment`). The helper also accepts **`--pre-shutdown`** on the `run` command with the same meaning as `--log-file` / `GAME_LOG_FILE`: CLI wins when both are set; empty or unset disables the hook. Container arguments after the image name are forwarded to the game executable, so prefer the environment variable for Docker the same way as `GAME_LOG_FILE`.

The command runs as **`/bin/sh -c`** with your string, so one-line commands and script paths both work. The hook child receives **`SIGNAL_NAME`** (`SIGTERM` or `SIGINT`) and **`SIGNAL_NUMBER`** (`15` or `2`) for the signal that started shutdown. Hook stdout and stderr stay on the container console. If the hook exits non-zero, fails to start, or is killed after a timeout, the helper logs to stderr and **still** writes `quit` to the server console afterward. The hook may run for at most **60 seconds**; after that the helper terminates the hook and continues shutdown.

Whenever a pre-shutdown command is configured, the helper opens an extra pipe to the hook as file descriptor **3** and sets **`SERVER_STDIN_FD=3`**. During the hook phase only, bytes written to fd 3 are forwarded to the server console stdin (the same path as container stdin and RCON). There is no separate flag to enable this bridge—it is automatic whenever the hook is set. After the hook finishes or times out, forwarding stops and the helper writes `quit` (waiting first for any in-flight RCON command when `--rcon` is enabled).

Example script on the `/data` volume:

```sh
#!/bin/sh
printf 'save stop-hook\n' >&"${SERVER_STDIN_FD}"
```

Make the script executable (`chmod +x pre-shutdown.sh`) and point `GAME_PRE_SHUTDOWN` at `/data/pre-shutdown.sh`. A one-line hook without a file works too, for example `GAME_PRE_SHUTDOWN='printf "save stop-hook\n" >&3'`.

Default Docker stop grace is often about 10 seconds, which is shorter than the 60 second hook bound plus time for the server to handle `quit`. When using a pre-shutdown hook, allow enough margin, for example:

```sh
docker stop -t 90 stationeers
```

In Docker Compose, set `stop_grace_period: 90s` on the service.

## Volumes

Mount a persistent volume at `/data` so server saves survive container replacement. The image links the game `saves` directory to `/data`. A new Docker volume is owned by `root`. A new volume is chowned from root to `steam:steam` (`chown -R steam:steam /data`). In Docker Compose, use the service's `volumes` field to map a host directory such as `./stationeers` to `/data`.
