#!/bin/bash

set -ex

/home/steam/tool config --env-var-prefix=PZ_

"$GAME_BIN_PATH/start-server.sh" -cachedir "$GAME_DATA_PTH" -servername "$SERVER_NAME" "$@"