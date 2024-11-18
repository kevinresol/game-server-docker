# Abiotic Factor Dedicated Server

## Run Server

```
docker run -d \
  -v $(pwd)/abiotic:/data \
  -p 7777:7777/udp -p 27015:27015/udp \
  kevinresol/abiotic-factor-dedicated-server[:<tagname>]
  [-SteamServerName=<value>] \
  [-PORT=<value>] \
  [-QueryPort=<value>] \
  [-ServerPassword=<value>] \
  [-tcp] \
  [...]
```

### Script Arguments

Additional args after the image name (such as `-SteamServerName` in the example) will be forwarded to the server executable. See more in the [office doc](https://github.com/DFJacob/AbioticFactorDedicatedServer/wiki/Guide-%E2%80%90-Quickstart).

If using docker-compose, define any additional arguments in the command section of your service definition.

### Volumes

Mounting a volume with your server save files is essential. This is done using the `-v` flag in `docker run` or the `volumes` field in docker-compose. The volume is mapped to the container's `/data` directory.
