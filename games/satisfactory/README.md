# Satisfactory Dedicated Server

## Run Server

```sh
docker run -d \
  -v $(pwd)/satisfactory:/data \
  -p 7777:7777/udp \
  -p 7777:7777/tcp \
  -p 8888:8888/tcp \
  kevinresol/satisfactory-dedicated-server:latest \
  [-Port=7777] \
  [-ReliablePort=8888] \
  [...]
```

## Script Arguments

Arguments after the image name are forwarded to `FactoryServer.sh`. The example shows the port overrides from the [Satisfactory dedicated servers guide](https://satisfactory.wiki.gg/wiki/Dedicated_servers). `-Port` defaults to 7777 for UDP and TCP game traffic and the HTTPS API. `-ReliablePort` defaults to 8888/tcp for reliable messaging. The guide requires the standard port's public and internal numbers to match, so the example publishes 7777 on both sides of `-p`. `-ExternalReliablePort` can remap the reliable port when the published number differs.

With Docker Compose, put the same optional server arguments in the service's `command` list.

## Configuration

Initial setup is done in the in-game Server Manager: add the server, set its name and administrator password, then create a game or import a save. A player join password can be set in that same screen. The entrypoint runs `FactoryServer.sh` with the forwarded arguments and does not apply environment variables to server settings.

## Volumes

Mount a persistent volume at `/data` so server files survive container replacement. The image points both the install directory's `FactoryGame/Saved` and `/home/steam/.config/Epic/FactoryGame/Saved` at `/data`. Save games are stored at `/data/SaveGames/server`, the settings file for the default port is `/data/SaveGames/ServerSettings.7777.sav`, and install-directory logs are stored at `/data/Logs`. In Docker Compose, use the service's `volumes` field to map a host directory such as `./satisfactory` to `/data`.
