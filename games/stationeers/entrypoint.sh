#!/bin/bash

set -e

# tail -f log.txt &

# start the server
node ~/tool.js run -- "$@" 0<&0 &
NODE_PID=$!

# Docker sends the stop signal only to PID 1. Forward that same signal to node.
trap 'kill -s TERM $NODE_PID; wait $NODE_PID' TERM
trap 'kill -s INT $NODE_PID; wait $NODE_PID' INT

# Wait for signals
wait $NODE_PID
