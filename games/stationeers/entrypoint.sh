#!/bin/bash

set -ex

# start the server
wine "$GAME_BIN_PATH/rocketstation_DedicatedServer.x86_64" "$@"