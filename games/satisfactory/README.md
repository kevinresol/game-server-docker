# Satisfactory Factor Dedicated Server

## Run Server

```
docker run -d \
  -v $(pwd)/satisfactory:/data \
  -p 7777:7777/udp -p 27015:27015/udp \
  kevinresol/satisfactory-factor-dedicated-server[:<tagname>]
  [-multihome=0.0.0.0] \
  [-ServerQueryPort=<value>] \
  [-BeaconPort=<value>] \
  [-Port=<value>] \
  [...]
```

### Script Arguments

Additional args after the image name (such as `-multihome` in the example) will be forwarded to the server executable. See more in the [office doc](https://satisfactory.fandom.com/wiki/Dedicated_servers).

If using docker-compose, define any additional arguments in the command section of your service definition.

### Volumes

Mounting a volume with your server save files is essential. This is done using the `-v` flag in `docker run` or the `volumes` field in docker-compose. The volume is mapped to the container's `/data` directory.

### Configuration

Satisfactory comes with a pretty decent Server Manager in-game. You need to use it to create a new game and configure the server.
