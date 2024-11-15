# Run Server

```
docker run -d \
  -v $(pwd)/Zomboid:/home/steam/Zomboid \
  -p 16261:16261/udp -p 16262:16262/udp [-p 27015:27015/tcp] \
  [-e SERVER_NAME=<value>]
  [-e PZ_PVP=<value>]
  [-e PZ_RCONPassword=<value>]
  kevinresol/project-zomboid-dedicated-server[:<tagname>]
  [-ip=<value>] \
  [-port=<value>] \
  [-udpport=<value>] \
  [-adminusername=<value>] \
  [-adminpassword=<value>] \
```

Environment variables prefixed with `PZ_` will be written to the config file before server start.

Additional args (such as `-ip` in the example) will be forwarded to `start-server.sh`. See more in the [office doc](https://pzwiki.net/wiki/Startup_parameters).

> Note: while -adminpassword is optional, it is required for the first run otherwise the script will prompt for a password, which will not work on an unattended session.

# Environment Variables

| Name           | Description                                                                                                 | Remarks                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| SERVER_NAME    | Server name, controls which config files to be loaded by the server                                         | Also passed as `-servername` to start-server.sh |
| GAME_DATA_PATH | Server config files location. Specify this if you mount the data volume at another location in `docker run` | Also passed as `-cachedir` to start-server.sh   |
| PZ\_\*         | Config values to be written to the ini file before server start. Example: `PZ_RCONPassword=123`             |

Default values of the environment variables can be found in the [Dockerfile](Dockerfile)
