# Project Zomboid Dedicated Server

## Run Server

```sh
docker run -d \
  -v $(pwd)/zomboid:/data \
  -p 16261:16261/udp \
  -p 16262:16262/udp \
  [-p 27015:27015/tcp] \
  [-e SERVER_NAME=knox-county] \
  [-e PZ_PVP=false] \
  [-e PZ_RCONPassword=change-this-rcon] \
  kevinresol/project-zomboid-dedicated-server:latest \
  [-adminpassword change-this-password] \
  [-port 16261] \
  [-udpport 16262] \
  [...]
```

## Script Arguments

Arguments after the image name are forwarded to `start-server.sh`. The entrypoint always inserts `-cachedir` set to `GAME_DATA_PATH` (default `/data`) and `-servername` set to `SERVER_NAME` (default `myserver`) before those arguments.

The example uses the space-separated form from the [Project Zomboid startup parameters](https://pzwiki.net/wiki/Startup_parameters). `-port` overrides `DefaultPort`, and `-udpport` overrides `UDPPort`. On the first run the server prompts for an admin password unless `-adminpassword` is supplied, and an unattended container cannot answer that prompt. After the admin account exists, `-adminpassword` can be omitted.

With Docker Compose, put the same optional server arguments in the service's `command` list.

## Configuration

Before `start-server.sh` runs, the helper writes environment variables prefixed with `PZ_` into the `Server` directory under `GAME_DATA_PATH`, using `SERVER_NAME` as the ini file name. With the defaults, that file is `/data/Server/myserver.ini`. The prefix is removed, and each `__` in the remaining name becomes `.`, so `PZ_PVP=false` sets `PVP` and `PZ_RCONPassword=change-this-rcon` sets `RCONPassword`. When that ini file is missing, the helper reads the image's `default.ini` and writes a file only if a value changes.

`SERVER_NAME` selects the ini file and the save name. The Dockerfile default is `myserver`. `GAME_DATA_PATH` defaults to `/data`; a mount at another path has to use the same `GAME_DATA_PATH` value, because that value is also passed as `-cachedir`.

The bundled `default.ini` sets `DefaultPort` to 16261, `UDPPort` to 16262, and `RCONPort` to 27015. The [Project Zomboid dedicated server guide](https://pzwiki.net/wiki/Dedicated_server) requires 16261/udp, plus 16262/udp as the direct-connection port. The optional `27015/tcp` publish in the example is for RCON; include it when `PZ_RCONPassword` is set. Ini keys are listed in the [Project Zomboid server settings](https://pzwiki.net/wiki/Server_settings).

With Docker Compose, set `SERVER_NAME`, `GAME_DATA_PATH`, and `PZ_*` variables in the service's `environment` list.

## Volumes

Mount a persistent volume at `/data` so the cache directory survives container replacement. The entrypoint passes that directory as `-cachedir`. The dedicated server guide stores ini files under `Server/` and world data under `Saves/Multiplayer/` inside the cache directory, so the default names are `/data/Server/myserver.ini` and `/data/Saves/Multiplayer/myserver`. In Docker Compose, use the service's `volumes` field to map a host directory such as `./zomboid` to `/data`.
