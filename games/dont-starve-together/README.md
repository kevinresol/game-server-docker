# Don't Starve Together

## Run Server

```
docker run -d \
  -v $(pwd)/dont-starve-together:/data \
  -p 10999:10999/udp
  [-e DST_CLUSTER_NETWORK__cluster_password=<value>]
  kevinresol/dont-starve-together-dedicated-server[:<tagname>]
  [-port 10999] \
  [...]
```

### Server Config

Environment variables prefixed with `DST_CLUSTER_` will be written to the cluster's `cluster.ini` file before server start.

### Script Arguments

Additional args after the image name (such as `-port` in the example) will be forwarded to the server executable.
See more in the following pages:

- https://dontstarve.fandom.com/wiki/Guides/Don%E2%80%99t_Starve_Together_Dedicated_Servers

If using docker-compose, define any additional arguments in the command section of your service definition.

> Note: if you set the `-conf_dir` argument you must also set the `GAME_CONF_DIR` environment variable to the same value for the config script to work properly.

### Volumes

Mounting a volume with your server save files is essential. This is done using the `-v` flag in `docker run` or the `volumes` field in docker-compose. The volume is mapped to the container's `/data` directory and also passed to the server executable's `-persistent_storage_root` flag.
