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

## Script Arguments

Arguments after the image name are forwarded to the Stationeers server executable. The example shows common optional server arguments; omit any that you do not need. `-file start` takes positional arguments: a required save name, a world id that is required only when that station does not exist yet, and an optional difficulty that defaults to `Normal`. The first-run example is `MarsBase Mars2 Normal`. On a new volume, omitting the world id fails. `-settings` takes key and value pairs. `StartLocalHost true` in the example is an ordinary settings pair. This image runs the dedicated-server build, where hosting already happens because `IsBatchMode` is always true. `GamePort 27016` matches the published game port. Also publish UDP `27015`, which the dedicated server guide lists as the Steam update port.

See the [Stationeers dedicated server guide](https://stationeers-wiki.com/Dedicated_Server_Guide) for world ids, settings, and startup arguments.

With Docker Compose, put the same optional server arguments in the service's `command` list.

## Configuration

`GAME_LOG_FILE` selects the log path used by the helper. The image sets it to `/home/steam/stationeers.log`. The helper's `--log-file` option falls back to that variable and appends `-logfile` with the path. The entrypoint places container arguments after `--`, so use `GAME_LOG_FILE` to choose a different path. The helper rejects a container argument of `-logfile` or `-logFile`.

With Docker Compose, put `GAME_LOG_FILE` in the service's `environment` map.

## Volumes

Mount a persistent volume at `/data` so server saves survive container replacement. The image links the game `saves` directory to `/data`. In Docker Compose, use the service's `volumes` field to map a host directory such as `./stationeers` to `/data`.
