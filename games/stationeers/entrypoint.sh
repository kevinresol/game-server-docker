#!/bin/bash

set -ex

# tail -f log.txt &

# start the server
"$GAME_BIN_PATH/rocketstation_DedicatedServer.x86_64" "$@"