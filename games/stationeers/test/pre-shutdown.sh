#!/bin/sh
# Runs on SIGTERM/SIGINT before the wrapper sends console "quit".
# SERVER_STDIN_FD is 3; write game console lines there (not to fd 0).
set -eu
printf 'say Server is shutting down...\n' >&"${SERVER_STDIN_FD:?}"
sleep 5
