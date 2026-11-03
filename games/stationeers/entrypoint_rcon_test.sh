#!/usr/bin/env bash
# Acceptance A6, A6b, A8 — entrypoint --rcon peeling (PATH stub for node).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENTRYPOINT="$ROOT/games/stationeers/entrypoint.sh"
STUB_DIR="$(mktemp -d)"
NODE_STUB_LOG="$(mktemp)"
export NODE_STUB_LOG
trap 'rm -rf "$STUB_DIR" "$NODE_STUB_LOG"' EXIT

cat >"$STUB_DIR/node" <<'EOF'
#!/usr/bin/env bash
printf 'invoked\n' >"${NODE_STUB_LOG:?}"
printf '%s\n' "$@" >>"${NODE_STUB_LOG:?}"
exit 0
EOF
chmod +x "$STUB_DIR/node"

node_ran() {
	[[ -f "$NODE_STUB_LOG" ]] && [[ "$(head -n1 "$NODE_STUB_LOG" 2>/dev/null || true)" == "invoked" ]]
}

read_node_args() {
	tail -n +2 "$NODE_STUB_LOG"
}

LOGGED_TOOL=()
LOGGED_GAME=()

tool_and_game_from_log() {
	LOGGED_TOOL=()
	LOGGED_GAME=()
	local past_run=0
	local past_sep=0
	while IFS= read -r arg; do
		if [[ $past_run -eq 0 ]]; then
			if [[ "$arg" == "run" ]]; then
				past_run=1
			fi
			continue
		fi
		if [[ $past_sep -eq 0 ]]; then
			if [[ "$arg" == "--" ]]; then
				past_sep=1
				continue
			fi
			LOGGED_TOOL+=("$arg")
		else
			LOGGED_GAME+=("$arg")
		fi
	done < <(read_node_args)
}

assert_no_node() {
	local label=$1
	shift
	: >"$NODE_STUB_LOG"
	set +e
	PATH="$STUB_DIR:$PATH" bash "$ENTRYPOINT" "$@" >/dev/null 2>&1
	local status=$?
	set -e
	if node_ran; then
		echo "FAIL $label: node stub ran but should not have" >&2
		cat "$NODE_STUB_LOG" >&2
		exit 1
	fi
	if [[ $status -eq 0 ]]; then
		echo "FAIL $label: expected non-zero exit, got 0" >&2
		exit 1
	fi
	echo "PASS $label"
}

assert_node_split() {
	local label=$1
	local expect_tool=$2
	local expect_game=$3
	shift 3
	local -a container=("$@")

	: >"$NODE_STUB_LOG"
	PATH="$STUB_DIR:$PATH" bash "$ENTRYPOINT" "${container[@]}" >/dev/null 2>&1

	if ! node_ran; then
		echo "FAIL $label: node stub did not run" >&2
		exit 1
	fi

	tool_and_game_from_log

	if [[ "${LOGGED_TOOL[*]-}" != "$expect_tool" ]]; then
		echo "FAIL $label: tool args" >&2
		echo "  expected: $expect_tool" >&2
		echo "  got:      ${LOGGED_TOOL[*]-}" >&2
		exit 1
	fi
	if [[ "${LOGGED_GAME[*]-}" != "$expect_game" ]]; then
		echo "FAIL $label: game args" >&2
		echo "  expected: $expect_game" >&2
		echo "  got:      ${LOGGED_GAME[*]-}" >&2
		exit 1
	fi
	echo "PASS $label"
}

# A6 — rejected forms do not start node
assert_no_node "A6 --rcon=" --rcon=
assert_no_node "A6 duplicate bare and port" --rcon --rcon=27500
assert_no_node "A6 --rcon 27500" --rcon 27500
assert_no_node "A6 duplicate port forms" --rcon=27500 --rcon=27015

# A6b — bare flag keeps next game argument
assert_node_split "A6b --rcon -file" --rcon -file --rcon -file

# A8 — flag stays with the tool
assert_node_split "A8 --rcon=27500 -file" --rcon=27500 -file --rcon=27500 -file

echo "All entrypoint RCON tests passed."
