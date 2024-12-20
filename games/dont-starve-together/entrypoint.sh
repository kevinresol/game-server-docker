#!/bin/bash

set -ex

# modify server config file
# node /home/steam/tool.js config --env-var-prefix=DST_

# start the server
node ~/tool.js run "$@"