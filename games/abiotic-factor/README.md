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

If you are using docker-compose or alike, specify the extra args via the `command` field.
