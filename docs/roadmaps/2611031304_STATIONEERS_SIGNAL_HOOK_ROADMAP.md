# Stationeers pre-shutdown signal hook — Task Map

**Status:** Draft — not Executable.

## Goal (locked)

Add an optional CLI flag (with environment fallback) to the Stationeers `run` command so that when the Node runner receives **SIGTERM or SIGINT**, it runs a user-supplied command **before** forwarding shutdown to the dedicated server process. This lets Docker image users (and interactive `docker run -it` operators) run custom logic—such as sending a save command—during orderly stop without baking a specific protocol into the image.

**Supersedes:** `docs/roadmaps/2610112023_STATIONEERS_RCON_SAVE_ON_SIGINT_ROADMAP.md` — do not implement built-in HTTP RCON save; use the generic pre-shutdown hook instead.

**Out of scope:** Built-in Stationeers RCON save or other fixed save protocols. Changing Unity/server binaries, entrypoint signal wiring, or unrelated games. Replacing the existing no-hook behavior (Node termination signal → `SIGINT` on server) when `--pre-shutdown` is unset.

## Decisions (locked)

- **Flag name:** **`--pre-shutdown`** (CLI kebab-case). Rejected aliases: `--on-signal`, `--signal-hook` (do not implement).
- **Environment mirror:** **`GAME_PRE_SHUTDOWN`**, same precedence pattern as `--log-file` / `GAME_LOG_FILE` (CLI overrides env when both set; unset/empty disables the hook).
- **Triggering signals:** **SIGTERM and SIGINT** on the Node process share one shutdown path (Docker stop via `entrypoint.sh` → Node SIGTERM; interactive TTY → Ctrl+C → SIGINT). First signal wins; duplicate delivery is ignored via single-flight guard.
- **Hook invocation:** Run the flag/env string with **`/bin/sh -c <value>`** so scripts and one-line commands both work. Do not split on spaces into a fixed argv list.
- **Ordering:** On SIGTERM or SIGINT: (1) run hook at most once, (2) await hook exit (bounded timeout below), (3) then `proc.kill("SIGINT")` on the dedicated server. No hook → on SIGTERM forward server SIGINT as today; on SIGINT with hook unset, forward server SIGINT (same end state as today for SIGTERM-only registration—extend to SIGINT registration for symmetry when hook is set).
- **Interactive / process group:** When a pre-shutdown hook is configured, the server child must **not** receive the terminal’s SIGINT before the hook completes. Use a process-group strategy (e.g. spawn the dedicated server in its own process group / session so Ctrl+C targets the Node runner first) and verify in T3 with a test that simulates ordered delivery.
- **Hook timeout:** **60 seconds** maximum wait; on timeout, log clearly, terminate the hook child if still running, then forward SIGINT to the server.
- **Hook failure:** Non-zero exit or spawn error → log to stderr; **still forward SIGINT** to the server (do not fail-closed on hook errors).
- **Signal context (in scope):** Export **`SIGNAL_NAME`** and **`SIGNAL_NUMBER`** in the hook child’s environment to match the signal that started shutdown (`SIGTERM`/`15` or `SIGINT`/`2`).
- **Docker stop grace:** Default `docker stop` grace is often **10s**; hook timeout is **60s**. Operators must set `--stop-timeout` (or compose `stop_grace_period`) **≥ 60s plus margin** for server shutdown after SIGINT, or hooks may be cut off before they run or finish.
- **Server stdin bridge (Option A, always with hook):** Whenever `--pre-shutdown` / `GAME_PRE_SHUTDOWN` is set, the hook spawn **always** includes an extra pipe (stdio fd **3**). Do **not** add `--pre-shutdown-stdio`, env toggles, or other opt-in flags for the bridge. Node is the sole writer to the dedicated server’s real `proc.stdin`: read hook fd 3 and forward bytes/lines to `proc.stdin` for the hook phase only, then close/stop forwarding before `proc.kill("SIGINT")`. Export **`SERVER_STDIN_FD=3`** (and document `printf 'command\n' >&3`) so scripts know where to write game console input. Hook stdio 0–2 remain inherited/piped to the operator console as today. When pre-shutdown is unset, do not create the bridge and do not spawn the server differently solely for stdin bridging.

## Acceptance

### Feature: Pre-shutdown hook CLI flag

Scenario A1 — Hook runs before server shutdown signal on Docker stop path
  Given `run` is started with `--pre-shutdown` (or `GAME_PRE_SHUTDOWN`) set to a command that logs a distinct line or writes a witness file
  And the dedicated server process is running
  When the Node runner receives SIGTERM
  Then the hook runs and completes or hits the configured timeout handling
  And the dedicated server receives SIGINT only after the hook phase finishes per Decisions ordering
  And the hook’s observable output appears before server shutdown signalling

Scenario A2 — Hook runs before server shutdown on interactive SIGINT
  Given `run` is started with `--pre-shutdown` configured
  And the dedicated server process is running (including interactive TTY attach)
  When the Node runner receives SIGINT (e.g. Ctrl+C)
  Then the hook runs once before the dedicated server receives SIGINT
  And the server does not receive a terminal group SIGINT ahead of the hook phase

Scenario A3 — Default behavior without hook
  Given `run` is started with no pre-shutdown command configured
  And the dedicated server process is running
  When the Node runner receives SIGTERM or SIGINT
  Then no hook command runs
  And the server receives SIGINT consistent with pre-change termination handling

Scenario A4 — CLI and environment configuration
  Given the hook is set only via `GAME_PRE_SHUTDOWN` or only via `--pre-shutdown`
  When SIGTERM or SIGINT is delivered to the Node runner
  Then the hook runs once with the expected command string
  And documented precedence between CLI and env matches `--log-file` behavior

Scenario A5 — Hook failure or timeout does not block server shutdown
  Given a hook that exits non-zero or exceeds the 60s bound
  When SIGTERM or SIGINT is delivered
  Then failure or timeout is logged observably
  And the dedicated server still receives SIGINT afterward

Scenario A6 — Operator documentation
  Given the Stationeers README and `run` command meta/help text
  When an operator reads them
  Then they can configure the hook, understand SIGTERM/SIGINT → hook → server SIGINT order, and are not told that built-in autosave/RCON shutdown exists

### Feature: Signal context for hook (v1)

Scenario B1 — Hook receives signal identity for SIGTERM
  Given a hook that prints `SIGNAL_NAME` and `SIGNAL_NUMBER` from its environment
  When SIGTERM triggers the hook
  Then `SIGNAL_NAME` is `SIGTERM` and `SIGNAL_NUMBER` is `15`

Scenario B2 — Hook receives signal identity for SIGINT
  Given the same hook instrumentation
  When SIGINT triggers the hook
  Then `SIGNAL_NAME` is `SIGINT` and `SIGNAL_NUMBER` is `2`

### Feature: Server stdin bridge via hook fd 3 (v1)

Scenario C1 — Hook can forward a line to server stdin before SIGINT
  Given `run` is started with `--pre-shutdown` set to a command that writes a distinct line to fd 3 (e.g. `SERVER_STDIN_FD`)
  And a fake or real dedicated server process reads stdin into an observable witness
  When SIGTERM or SIGINT triggers the hook
  Then the witness shows that line before the server process receives SIGINT
  And Node forwards hook fd 3 to server stdin only during the hook phase

Scenario C2 — No bridge when pre-shutdown is unset
  Given `run` is started without `--pre-shutdown`
  When the runner handles termination
  Then no fd-3 bridge is created for a hook child (no hook runs)

## Protocol

**Pack:** two-pack

- **Chunk order:** T1 (CLI contract) → T2 (handler signal path + fd-3 stdin bridge) → T3 (automated tests). T4 (README) may run in parallel with T3 after T2 is approved (disjoint files).
- **Scope boundaries:** Each implementor may change only the files listed for that task and append evidence to that task’s Agent log. Trace Docker args through `entrypoint.sh` → `tool.js run` → handler; preserve startup order and existing log tail behavior.
- **Verification:** `pnpm exec tsc --noEmit --pretty false`; `pnpm exec tsx --test games/stationeers/tool/command/run/handler.test.ts` (after T3); `pnpm exec esbuild games/stationeers/tool/main.ts --bundle --platform=node --outfile=/tmp/stationeers-tool.js`; manual optional: `docker stop` with a hook that touches a file under `/data`.
- **Review:** coder → independent reviewer per chunk; review approval does not grant Executable status.
- **Commits (required):** Local commit after each approved chunk (chunk Files + this roadmap in the same commit). A chunk is not done until that commit exists and the Agent log records the hash. Do not `git push` unless the operator asks.

## Cleanup lane

- Update stale `run` meta description in `command.ts` (autosave/SIGINT claims) in **T1** so help text matches behavior.

---

## Human gate / Executable

- [ ] User sets this roadmap **Executable** (explicit approval) before implementors treat it as execute-ready.

Drafts are not execute-ready until the user explicitly approves Executable. Locked Decisions include **`--pre-shutdown` / `GAME_PRE_SHUTDOWN`**, **SIGTERM + SIGINT**, **Option A fd-3 bridge always on with hook (no `--pre-shutdown-stdio`)**, and **superseding** the RCON roadmap.

## Task list

### T1 — Expose `--pre-shutdown` on the run command

**Status:** pending

**Depends on:** none

**Files:** `games/stationeers/tool/command/run/command.ts`, `games/stationeers/tool/command/run/handler.ts` (Args type only if needed for wiring)

#### Implementor checklist

- [ ] Add `--pre-shutdown` option with `GAME_PRE_SHUTDOWN` fallback, matching `@why-ts/cli` patterns used by `--log-file`.
- [ ] Plumb the value into the run handler input type; no signal behavior change yet beyond passing the option through.
- [ ] Fix `run` meta description so it no longer claims unimplemented autosave-on-SIGINT behavior; mention optional pre-shutdown hook at a high level.

#### Reviewer checklist

- [ ] Confirm option naming, env fallback, and precedence match Decisions and existing CLI conventions.
- [ ] Confirm no hook execution or signal-handler changes are smuggled into this CLI-only chunk.

#### Agent log

<!-- implementor / reviewer append below -->

---

### T2 — Hook, fd-3 server stdin bridge, then forward SIGINT to server

**Status:** pending

**Depends on:** T1 approved

**Files:** `games/stationeers/tool/command/run/handler.ts`

#### Implementor checklist

- [ ] Register **SIGTERM and SIGINT** handlers that share one **serialized** shutdown function: no fire-and-forget async path that forwards SIGINT before the hook finishes. Use a single-flight guard and an async `await` path so hook completion (or timeout/kill) always precedes `proc.kill("SIGINT")`.
- [ ] When `preShutdown` is unset, preserve today’s termination behavior (SIGTERM → server SIGINT; register SIGINT → server SIGINT for interactive parity).
- [ ] When set, spawn `sh -c` with `SIGNAL_NAME`, `SIGNAL_NUMBER`, and **`SERVER_STDIN_FD=3`**; use **`stdio: ['inherit', 'inherit', 'inherit', 'pipe']`** (or equivalent) so fd 3 is the hook→Node pipe; Node forwards fd-3 data to `proc.stdin` until hook exit/timeout, then stops forwarding and closes the pipe.
- [ ] When `preShutdown` is set, spawn the dedicated server so terminal SIGINT does not reach the server before the hook (process group / session per Decisions); document spawn options in the Agent log.
- [ ] Ensure hook stdout/stderr remain visible on the operator console; stdin (fd 0) is not the server bridge—fd 3 is.
- [ ] Avoid duplicate hook runs and duplicate server SIGINT if SIGTERM and SIGINT arrive close together.

#### Reviewer checklist

- [ ] Verify ordering: hook phase completes or times out before server SIGINT when a hook is configured.
- [ ] Verify no-hook SIGTERM/SIGINT paths match pre-change behavior where applicable.
- [ ] Verify interactive SIGINT ordering (A2) when hook is configured.
- [ ] Verify Decisions on failure policy and timeout are implemented, not hard-coded silent swallow.
- [ ] Verify async SIGTERM handling cannot forward SIGINT before hook completion (including race with duplicate SIGTERM).
- [ ] Verify fd-3 forwarding cannot write to server stdin after the hook phase ends and does not run when `preShutdown` is unset.

#### Agent log

<!-- implementor / reviewer append below -->

---

### T3 — Automated tests for pre-shutdown ordering

**Status:** pending

**Depends on:** T2 approved

**Files:** `games/stationeers/tool/command/run/handler.test.ts`, `games/stationeers/tool/command/run/handler.ts` (test hooks/export only if required)

#### Implementor checklist

- [ ] Add `tsx --test` coverage using a fake server process (spawn `node -e` sleep script) and a hook command that writes a sequenced witness (file or stdout).
- [ ] Assert hook runs before fake server receives SIGINT when Node gets SIGTERM or SIGINT (proxy observable in test).
- [ ] Cover unset hook, hook failure (non-zero exit still forwards), `SIGNAL_NAME` for both SIGTERM and SIGINT, and **C1** (line written to fd 3 reaches fake server stdin before SIGINT).
- [ ] Keep tests hermetic; no Docker or real Stationeers binary required.

#### Reviewer checklist

- [ ] Confirm tests prove ordering and regression for no-hook path, not only string matching in source.
- [ ] Confirm test Files stay within chunk scope.

#### Agent log

<!-- implementor / reviewer append below -->

---

### T4 — Document hook for Docker operators

**Status:** pending

**Depends on:** T2 approved

**Files:** `games/stationeers/README.md`

#### Implementor checklist

- [ ] Document `--pre-shutdown` / `GAME_PRE_SHUTDOWN`, SIGTERM/SIGINT → hook → server SIGINT flow, timeout/failure behavior, `SIGNAL_NAME` / `SIGNAL_NUMBER`, and **`SERVER_STDIN_FD=3`** with a concrete `printf … >&3` (or equivalent) example for game console lines.
- [ ] Document Docker `--stop-timeout` / compose `stop_grace_period` relative to the 60s hook bound (concrete example, e.g. `--stop-timeout 90`).
- [ ] Give a concrete example (e.g. shell script path under `/data`) per project README rules; use `[...]` for optional parts.
- [ ] State that the fd-3 bridge is automatic whenever pre-shutdown is configured (no separate stdio flag).

#### Reviewer checklist

- [ ] Verify examples and ports/settings are Stationeers-specific and match implementation.
- [ ] Verify no false claims about built-in save or RCON.

#### Agent log

<!-- implementor / reviewer append below -->
