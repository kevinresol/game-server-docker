#!/bin/bash

set -ex

# start the server
wine "$GAME_BIN_PATH/FactoryServer.sh" "$@"