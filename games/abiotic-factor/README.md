# Abiotic Factor Dedicated Server

## Run Server

```sh
docker run -d \
  -v $(pwd)/abiotic:/data \
  -p 7777:7777/udp -p 27015:27015/udp \
  kevinresol/abiotic-factor-dedicated-server:latest \
  [-SteamServerName=AbioticExample] \
  [-PORT=7777] \
  [-QueryPort=27015] \
  [-ServerPassword=change-this-password] \
  [-tcp] \
  [...]
```

## Script Arguments

Arguments after the image name are forwarded to the Abiotic Factor server executable. The example shows common optional server arguments; omit any that you do not need. See the [Abiotic Factor dedicated server guide](https://github.com/DFJacob/AbioticFactorDedicatedServer/wiki/Guide-%E2%80%90-Quickstart) for supported game arguments.

With Docker Compose, put the same optional server arguments in the service's `command` list.

## Volumes

Mount a persistent volume at `/data` so server saves survive container replacement. In Docker Compose, use the service's `volumes` field to map a host directory such as `./abiotic` to `/data`.
