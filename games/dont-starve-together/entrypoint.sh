#!/bin/bash

set -ex

# modify server config file
node /home/steam/tool.js config --env-var-prefix=DST_

# start the server
"$GAME_BIN_PATH/bin/dontstarve_dedicated_server_nullrenderer" -persistent_storage_root "$GAME_DATA_PATH" "$@"