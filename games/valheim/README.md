# Valheim Dedicated Server

## Run Server

```
docker run -d \
  -v $(pwd)/valheim:/data \
  -p 2456:2456/udp -p 2457:2457/udp \
  kevinresol/valheim-dedicated-server[:<tagname>]
  [-port 2456] \
  [-name <value>] \
  [-world <value>] \
  [-password <value>] \
  [...]
```

### Script Arguments

Additional args after the image name (such as `-port` in the example) will be forwarded to the server executable.
See more in the following pages:

- https://valheim.fandom.com/wiki/Dedicated_servers
- https://www.valheimgame.com/ja/support/a-guide-to-dedicated-servers

If using docker-compose, define any additional arguments in the command section of your service definition.

### Volumes

Mounting a volume with your server save files is essential. This is done using the `-v` flag in `docker run` or the `volumes` field in docker-compose. The volume is mapped to the container's `/data` directory and also passed to the server executable's `-savedir` flag.
