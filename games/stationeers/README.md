# Stationeers Dedicated Server

## Run Server

```sh
docker run -d \
  -v $(pwd)/stationeers:/data \
  -p 27016:27016/udp -p 27015:27015/udp \
  [-e GAME_LOG_FILE=/home/steam/stationeers.log] \
  kevinresol/stationeers-dedicated-server:latest \
  [-file start MarsBase Mars2 Normal] \
  [-settings StartLocalHost true ServerPassword change-this-password GamePort 27016] \
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

Arguments after the image name are forwarded to the Stationeers server executable. The example shows common optional server arguments; omit any that you do not need. `-file start` takes positional arguments: a required save name, a world id that is required only when that station does not exist yet, and an optional difficulty that defaults to `Normal`. The first-run example is `MarsBase Mars2 Normal`. On a new volume, omitting the world id fails. `-settings` takes key and value pairs. `StartLocalHost true` in the example is an ordinary settings pair. This image runs the dedicated-server build, where hosting already happens because `IsBatchMode` is always true. `GamePort 27016` matches the published game port. Also publish UDP `27015`, which the dedicated server guide lists as the Steam update port.

The wrapper adds `-noclear` unless the arguments already include `-noclear`.

See the [Stationeers dedicated server guide](https://stationeers-wiki.com/Dedicated_Server_Guide) for world ids, settings, and startup arguments.

With Docker Compose, put the same optional server arguments in the service's `command` list.

## Configuration

`GAME_LOG_FILE` is the console log path the helper uses when `--log-file` is omitted. Optional `--log-file /home/steam/stationeers.log` duplicates console stdout into that file. It does not receive Unity's `Player.log`. `entrypoint.sh` places container arguments after `--`. With `docker run`, set `-e GAME_LOG_FILE=/home/steam/stationeers.log`.

A container argument `-logfile` or `-logFile` is rejected (`Do not specify -logfile manually in the rest arguments, use the --log-file flag or GAME_LOG_FILE env var instead.`). The game does not start.

The helper writes one stderr line: `Player.log was not found under ~/.config/unity3d; Unity's file log will not be mirrored`. A normal run may only show that warning. Users who read Unity lines from the old `--log-file` will not find them there.

With Docker Compose, put `GAME_LOG_FILE` in the service's `environment` map.

## Volumes

Mount a persistent volume at `/data` so server saves survive container replacement. The image links the game `saves` directory to `/data`. A new Docker volume is owned by `root`. A new volume is chowned from root to `steam:steam` (`chown -R steam:steam /data`). In Docker Compose, use the service's `volumes` field to map a host directory such as `./stationeers` to `/data`.
