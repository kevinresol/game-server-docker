#!/bin/bash

set -ex

# tail -f log.txt &

# start the server
node ~/tool.js run -- "$@" &
NODE_PID=$!

# Trap SIGTERM signal
trap 'kill -s TERM $NODE_PID; wait $NODE_PID' TERM

# Wait for signals
wait $NODE_PID