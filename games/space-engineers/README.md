# Space Engineers Dedicated Server

## Run Server

```sh
docker run -d \
  -v $(pwd)/space-engineers:/data \
  -p 27016:27016/udp \
  kevinresol/space-engineers-dedicated-server:latest
```

## Script Arguments

Arbitrary Docker arguments are not forwarded. The entrypoint always starts `SpaceEngineersDedicated.exe` through Wine with `-noconsole`, `-path Z:\data`, and `-ignorelastsession`. A Docker Compose `command` list is ignored the same way.

`-noconsole` runs the dedicated server without its console window. `-path Z:\data` loads the instance configuration and stores the server files in that directory. Wine's default `Z:` drive is `/`, and this image creates its prefix with `wineboot` without remapping drives, so `Z:\data` is `/data`. `-ignorelastsession` uses the values in that configuration instead of the last automatic world save.

The [Space Engineers dedicated servers guide](https://www.spaceengineersgame.com/dedicated-servers/) documents these flags. Its `-console` flag, which skips the instance-selection and configuration dialogs, is not part of the image command.

## Configuration

The dedicated server configuration file is `SpaceEngineers-Dedicated.cfg`. With `-path Z:\data`, the server loads that configuration and stores its files in `/data`. Server name, world name, and listen port are stored in that file. The entrypoint does not apply environment variables to those settings.

The default listen port is 27016/udp. Publish the listen port set in that file. The [dedicated server configuration reference](https://spaceengineers.wiki.gg/wiki/Modding/Reference/MyConfigDedicated) also lists `SteamPort` defaulting to 8766 and `RemoteApiPort` defaulting to 8080. This image does not change those settings.

## Volumes

Mount a persistent volume at `/data` so the instance configuration and server files survive container replacement. In Docker Compose, use the service's `volumes` field to map a host directory such as `./space-engineers` to `/data`.
