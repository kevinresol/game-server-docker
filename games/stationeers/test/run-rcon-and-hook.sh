#!/usr/bin/env bash
# Build the local image (RCON + pre-shutdown), run a server, print test hints.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
STN="$ROOT/games/stationeers"
DATA_DIR="${STN_TEST_DATA:-$STN/test/data}"
IMAGE="${STN_TEST_IMAGE:-stationeers-rcon-hook:local}"
NAME="${STN_TEST_CONTAINER:-stationeers-rcon-hook-test}"
RCON_PORT="${STN_RCON_PORT:-27500}"
RCON_SECRET="${STN_RCON_SECRET:-change-this-rcon-secret}"
GAME_PORT="${STN_GAME_PORT:-27016}"
STEAM_PORT="${STN_STEAM_PORT:-27015}"
SERVER_NAME="${STN_SERVER_NAME:-Stationeers Server}"
SERVER_PASSWORD="${STN_SERVER_PASSWORD:-change-this-password}"
WORLD_NAME="${STN_WORLD_NAME:-MarsBase}"
WORLD_TYPE="${STN_WORLD_TYPE:-Mars2}"

mkdir -p "$DATA_DIR"
chmod +x "$STN/test/pre-shutdown.sh"
cp "$STN/test/pre-shutdown.sh" "$DATA_DIR/pre-shutdown.sh"
chmod +x "$DATA_DIR/pre-shutdown.sh"

echo "Bundling tool.js..."
(cd "$ROOT" && pnpm eval build-game-tool --game=stationeers)

echo "Building $IMAGE (large download on first build; context games/stationeers)..."
docker build --platform=linux/amd64 -f "$STN/Dockerfile" -t "$IMAGE" "$STN"

docker rm -f "$NAME" 2>/dev/null || true

cat <<EOF

Starting $NAME.
  RCON:     tcp://${RCON_PORT}  password = ServerAuthSecret from setting.xml (${RCON_SECRET} via -settings below)
  Hook:     GAME_PRE_SHUTDOWN=/data/pre-shutdown.sh  →  say Server is shutting down...
  Stop:     docker stop -t 90 $NAME   (or Ctrl+C if attached)

EOF

exec docker run --rm -it \
  --name "$NAME" \
  -v "$DATA_DIR:/data" \
  -p "0.0.0.0:${RCON_PORT}:${RCON_PORT}/tcp" \
  -p "0.0.0.0:${GAME_PORT}:${GAME_PORT}/udp" \
  -p "0.0.0.0:${STEAM_PORT}:${STEAM_PORT}/udp" \
  -e "GAME_PRE_SHUTDOWN=/data/pre-shutdown.sh" \
  "$IMAGE" \
  --rcon="${RCON_PORT}" \
  -file start "${WORLD_NAME}" "${WORLD_TYPE}" Normal \
  -settings StartLocalHost true ServerVisible true LocalIpAddress 0.0.0.0 GamePort "${GAME_PORT}" ServerName "${SERVER_NAME}" ServerPassword "${SERVER_PASSWORD}" ServerAuthSecret "${RCON_SECRET}" ServerMaxPlayers 8 UPNPEnabled false SaveInterval 150 UseSteamP2P false
