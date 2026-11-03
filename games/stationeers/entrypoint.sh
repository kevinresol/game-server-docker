#!/bin/bash

set -e

TOOL_ARGS=()
GAME_ARGS=()
RCON_COUNT=0

rcon_reject_multiple() {
	echo "error: multiple --rcon flags are not allowed" >&2
	exit 1
}

while (( $# > 0 )); do
	case "$1" in
	--rcon=*)
		if [[ "$1" == "--rcon=" ]]; then
			echo "error: invalid --rcon form" >&2
			exit 1
		fi
		RCON_COUNT=$((RCON_COUNT + 1))
		if (( RCON_COUNT > 1 )); then
			rcon_reject_multiple
		fi
		TOOL_ARGS+=("$1")
		shift
		;;
	--rcon)
		if (( $# < 2 )) || [[ "$2" != -* ]]; then
			echo "error: invalid --rcon form" >&2
			exit 1
		fi
		RCON_COUNT=$((RCON_COUNT + 1))
		if (( RCON_COUNT > 1 )); then
			rcon_reject_multiple
		fi
		TOOL_ARGS+=("--rcon")
		shift
		;;
	*)
		GAME_ARGS+=("$1")
		shift
		;;
	esac
done

# start the server
node ~/tool.js run "${TOOL_ARGS[@]}" -- "${GAME_ARGS[@]}" 0<&0 &
NODE_PID=$!

# Docker sends the stop signal only to PID 1. Forward that same signal to node.
trap 'kill -s TERM $NODE_PID; wait $NODE_PID' TERM
trap 'kill -s INT $NODE_PID; wait $NODE_PID' INT

# Wait for signals
wait $NODE_PID
