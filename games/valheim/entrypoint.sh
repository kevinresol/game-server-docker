#!/bin/bash

set -ex

# start the server
"$GAME_BIN_PATH/valheim_server.x86_64" -savedir "$GAME_DATA_PATH" "$@"