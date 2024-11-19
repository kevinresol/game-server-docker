#!/bin/bash

set -ex

# start the server
env WINEARCH=win64 WINEDEBUG=-all WINEPREFIX=/wineprefix wine ${GAME_BIN_PATH}/DedicatedServer64/SpaceEngineersDedicated.exe -noconsole -path Z:\\data -ignorelastsession

