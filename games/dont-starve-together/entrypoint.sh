#!/bin/bash

set -ex

# modify server config file
node /home/steam/tool.js config --template-path=/home/steam/config --file=cluster.ini --env-var-prefix=DST_CLUSTER_

# start the server
node ~/tool.js run --template-path=/home/steam/config "$@" &
NODE_PID=$!

# Trap SIGTERM signal
trap 'kill -s TERM $NODE_PID' TERM

# Wait for signals
wait $NODE_PID

# Print exit code
echo "Script exited with code $?"