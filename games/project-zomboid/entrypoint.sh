#!/bin/bash

set -ex

# modify server config file
node /home/steam/tool.js config --env-var-prefix=PZ_

# start the server
"$GAME_BIN_PATH/start-server.sh" -cachedir="$GAME_DATA_PATH" -servername "$SERVER_NAME" "$@"