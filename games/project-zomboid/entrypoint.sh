#!/bin/bash

set -ex

# printenv
# ls -lah /home/steam/Zomboid

node /home/steam/tool.js config --env-var-prefix=PZ_


"$GAME_BIN_PATH/start-server.sh" -cachedir "$GAME_DATA_PTH" -servername "$SERVER_NAME" "$@"