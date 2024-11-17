#!/bin/bash

set -ex

# start the server
wine "$GAME_BIN_PATH/AbioticFactor/Binaries/Win64/AbioticFactorServer-Win64-Shipping.exe" "$@"