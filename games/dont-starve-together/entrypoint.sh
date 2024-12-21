#!/bin/bash

set -ex

# modify server config file
# node /home/steam/tool.js config --env-var-prefix=DST_

# start the server
node ~/tool.js run "$@" &
NODE_PID=$!

# Trap SIGTERM signal
trap 'kill -s TERM $NODE_PID' TERM

# Wait for signals
wait $NODE_PID