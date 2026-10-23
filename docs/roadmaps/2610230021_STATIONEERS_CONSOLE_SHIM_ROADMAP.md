# Stationeers Console Shim — Task Map

**Status:** Blocked — S7. A single stdin line does not reach the game.

## Goal (locked)

Make the Stationeers dedicated server's built-in headless console work inside the Linux container, so that (a) the game's own console output reaches container stdout/stderr and (b) commands written to the container's stdin (for example `save mysave`, `quit`) are executed by the game. Per `stn-diag/20261022T113113Z/DECOMPILE.md`, the stock Linux build never reads stdin because `RocketSystemConsole` (1) throws at its Win32 P/Invokes `kernel32.dll!SetConsoleOutputCP` / `SetConsoleCP`, (2) is only constructed when the args contain no exact `-logFile` token, and (3) only reads input when Mono selects `TermInfoDriver`, which requires stdin and stdout to be real terminals. The work ships a two-part shim: a native `kernel32` stub library that makes the Win32 calls resolve, and an in-container PTY bridge that gives the game a real terminal while the container itself can use plain pipes.

**Out of scope:**

- Any change to the RCON/HTTP console path or to `docs/roadmaps/2610112023_STATIONEERS_RCON_SAVE_ON_SIGINT_ROADMAP.md` (that roadmap may later reuse the stdin console; deciding that is a separate human decision).
- Save-on-SIGINT/SIGTERM behavior, `autosavecancel`, or any new shutdown flow. The existing SIGTERM→SIGINT forwarding stays as is.
- The RakNet `serverrun` command channel and any fake-client emulation.
- Patching, redistributing, or modifying game binaries other than adding a `<dllmap>`/preload entry (and only if S1 selects it).
- Other games' images, shared base image changes, and README conventions shared across games.
- Patching IL or any game assembly. The game's busy-wait input loop is mitigated only at the native layer (see the CPU throttle decision), never by editing managed code.
- Changing `games/stationeers/tool/command/run/*` behavior unrelated to this goal, or the RCON roadmap itself beyond marking it parked in `_index.md`.

## Decisions (locked)

- **Shim mechanism:** the `kernel32` stubs live in one native library, `libkernel32-shim.so`. Preferred wiring is a Mono `<dllmap dll="kernel32.dll" target="..."/>` entry; fallback is `LD_PRELOAD`. S1 selects one based on evidence; S4 implements it. Neither may be chosen without S1 evidence. Note that `LD_PRELOAD` can only help if Mono resolves `kernel32.dll` to a handle whose `dlsym` can see the preloaded symbols; S1's "why `EntryPointNotFoundException`" finding is the real gate.
- **CPU throttle (native, no IL change):** the game's input loop spins on `Console.KeyAvailable`, which under `TermInfoDriver` is a zero-timeout `poll` on fd 0 per iteration (decompile `RocketSystemConsole.cs:96-123`, `TermInfoDriver.cs:285-297`; the exact syscall is to be confirmed in S1). The shim library also exports an interposing `poll()` that, only for calls with a single descriptor equal to fd 0 and timeout 0, substitutes a short timeout (about 10 ms) and otherwise forwards to libc unchanged. This makes the loop block in the kernel instead of spinning, with input latency of at most that timeout. Because this needs `LD_PRELOAD` regardless of how kernel32 is wired, **`LD_PRELOAD` is set by the Node wrapper on the game child only** (via the `stn-pty` environment), never as an image-wide `ENV`, so node, bash and the helper are unaffected. If S1 shows the throttle is not feasible (for example, the call does not go through an interposable `poll`), stop and ask the user to choose between an opt-in console and accepting about one busy core.
- **Always on:** the PTY bridge and console are enabled for every run (no opt-in flag). The CPU acceptance threshold in F1 is the guard for this decision; failing it blocks S7.
- **Feasibility spike first:** S1 must prove, before any production code is written, that stub + PTY + no log flag executes a typed command on the real server build. S2–S8 are blocked until the spike passes.
- **Terminal source:** the image ships its own PTY bridge, `stn-pty`, a small C helper using `forkpty`. `docker run -i`, `docker attach`, and ECS exec must work without `-t`. Requiring `docker run -it` and LD_PRELOAD faking of `isatty`/`tcgetattr` are rejected alternatives.
- **Helper CLI contract (frozen so S3 and S5 can run in parallel):**
  - Invocation: `stn-pty <program> [args...]`. It resolves `<program>` by path, execs it on a PTY slave as fd 0/1/2 (UTF-8 locale unchanged, `TERM=xterm` when `TERM` is unset or `dumb`, fixed window size 200x50), copies PTY master output to its own stdout and its own stdin to the PTY master.
  - Signals: forwards `SIGINT` and `SIGTERM` to the child. Exits with the child's exit status, or `128+n` if the child died from signal `n`.
  - Stdin EOF must not terminate or signal the child.
  - Install path in the image: `/home/steam/shim/stn-pty`; the Node wrapper reads an optional override from env `STN_PTY_BIN` (used by tests), default that path.
  - PTY output is a single merged stream; the helper has no separate stderr (it writes only its own diagnostics to stderr). The wrapper treats helper stdout as the game's console output.
  - Terminal settings: the slave keeps the kernel line discipline defaults that Mono's `TermInfoDriver` expects to set up itself; the helper does not pre-switch to raw mode if S1's spike shows this breaks Mono's own `termios` handling (S1 records the working setting, and S3 implements exactly that). `ONLCR` stays on, so output carries `\r\n`; the tee/log normalization rule is in scenario C2. Which byte (`\n` or `\r`) the helper must deliver for Mono to see `ConsoleKey.Enter` is decided by the S1 spike and then frozen.
  - Stdin EOF: the helper removes fd 0 from its `poll` set (no `POLLHUP` spin) and must **not** close the PTY master, because that would send `SIGHUP` to the child. Without `docker run -i`, stdin is `/dev/null` and EOF is immediate; this must also leave the game running.
  - `STN_PTY_BIN` is a test seam only; it is documented as such and not advertised in the README.
- **Log flag handling:** the game process must never receive `-logfile` or `-logFile` (any case). A user-supplied `-logfile`/`-logFile` in the forwarded args is a hard error with the existing error style. The wrapper never appends such a flag.
- **`--log-file` / `GAME_LOG_FILE` is kept** but its meaning changes to "duplicate the game's console output into this file." The wrapper tees the helper's stdout into the file (append) while stdout/stderr behavior stays unchanged. The existing "make sure the file exists" and "delete on exit" behavior is preserved. The `tail -f` subprocess is removed.
- **`-noclear`:** the wrapper adds `-noclear` to the game args unless the user already passed it, to avoid clear-screen escape sequences in container logs.
- **Unity `Player.log`:** without `-logFile`, Unity's `Debug.Log` stream goes to `~/.config/unity3d/<company>/<product>/Player.log`. The wrapper tails it to **stderr** (not the `--log-file` tee). The exact path comes from S1, with a glob fallback `~/.config/unity3d/*/*/Player.log`.
- **Signals:** `SIGTERM` to the wrapper still results in the game receiving `SIGINT`, now delivered through `stn-pty`. No save is added.
- **Spawn contract (S5):** spawn with `stdio: ['inherit', 'pipe', 'pipe']`; resolve the run promise on the child's `close` event (not `exit`), so the final output is flushed to stdout and the tee file before the log file is deleted.
- **`entrypoint.sh`:** `set -x` is removed because it echoes `ServerPassword`/`ServerAuthSecret` into logs (`REPORT.md` side finding). The node job is started in the background by a non-interactive bash, which redirects its stdin to `/dev/null`; the command must therefore be written with `0<&0` (or equivalent) so the container's stdin reaches Node. The SIGTERM trap and wait structure are otherwise unchanged.
- **Relation to the RCON roadmap:** `2610112023_STATIONEERS_RCON_SAVE_ON_SIGINT_ROADMAP.md` is parked by the user in favor of this work (its HTTP console premise is contradicted by the decompile, which found no HTTP/RCON console). It is marked parked in `_index.md`; reviving it requires a new user decision and must be sequenced after this roadmap because both edit `handler.ts`/`command.ts`.
- **Build:** the helper and stub library are compiled in a throwaway multi-stage Docker stage and only the outputs are copied into the final image. The final image gains no compiler. Target is linux/amd64 only.
- **Test safety:** all live runs use throwaway containers, a throwaway save, and random throwaway credentials. Never start, stop, or modify the user's existing `stationeers` container or its data. Do not commit game files, and keep any recorded evidence free of credentials.
- **Evidence location:** research evidence goes in the relevant task's Agent log, with bulky artifacts under a new `stn-diag/<timestamp>/` directory, which is git-untracked and not part of the deliverable.

## Acceptance

### Feature: Win32 console calls resolve on Linux

Scenario A1 — Console constructs without the kernel32 exception
  Given the built Stationeers image is started with no `-logfile`/`-logFile` arguments
  When the server finishes starting
  Then neither container output nor Unity's `Player.log` contains `EntryPointNotFoundException` or `DllNotFoundException` for `SetConsoleOutputCP`/`SetConsoleCP`
  And the game's own console lines, including `RakNet successfully hosted` and `Ready`, appear in `docker logs`

### Feature: Stdin commands reach the game

Scenario B1 — Piped stdin works without a TTY
  Given a running container started with `docker run -i` (no `-t`) and a throwaway save
  When `save stnshim1` is written to the container's stdin followed by a newline
  Then a save named `stnshim1` appears under `/data`
  And the command's console response appears on container stdout

Scenario B2 — Attached terminal works
  Given a running container started with `docker run -it`
  When the operator types `help` and Enter
  Then the game's command list is printed in the terminal

Scenario B3 — Closing or absent stdin does not stop the server
  Given a running container started with `docker run -i`, and separately one started without `-i` (stdin is `/dev/null`)
  When stdin reaches EOF (explicitly, or immediately)
  Then the game keeps running
  And the container's CPU use does not spike due to a poll/EOF spin in `stn-pty`

Scenario B4 — Container stdin reaches the game
  Given a container started with `docker run -i`
  When the process tree is inspected
  Then fd 0 of the Node wrapper is not `/dev/null`

### Feature: Log flag and log file behavior

Scenario C1 — The game never sees a log flag
  Given the image started with or without `--log-file /home/steam/stationeers.log`
  When the game process command line is inspected
  Then it contains neither `-logfile` nor `-logFile`

Scenario C2 — `--log-file` duplicates output
  Given the image started with `--log-file /home/steam/stationeers.log`
  When the server runs
  Then the file contains the same console lines as container stdout, byte-for-byte as emitted by `stn-pty` (any `\r`/escape-sequence stripping is the same for both or neither; S5 chooses and tests one rule)
  And container stdout/stderr content is not reduced by using the option

Scenario C3 — Manual log flag is rejected
  Given forwarded game args include `-logfile x` or `-logFile -`
  When the wrapper starts
  Then it exits with an error that points to `--log-file`/`GAME_LOG_FILE` and does not start the game

Scenario C4 — Unity log reaches stderr
  Given the server running without a log flag
  When Unity writes to its `Player.log`
  Then those lines appear on the container's stderr

### Feature: Shutdown and secrets

Scenario D1 — SIGTERM shuts the server down cleanly
  Given a running container
  When `docker stop` is issued
  Then the game receives `SIGINT` through `stn-pty` and exits within the `docker stop` grace period (10 s default; S7 records the observed time)
  And the wrapper logs the game's exit status, and the container exit code is recorded in S7 evidence
  And the pass condition is "exited without being killed (not 137)"; the exact code (0, 130 or 143) is recorded and, if non-zero, documented rather than changed in this roadmap

Scenario D2 — No credentials echoed by the entrypoint
  Given the image started with `-settings ServerPassword secretx ServerAuthSecret secrety`
  When the container starts
  Then neither value appears in `docker logs` output produced by the entrypoint

### Feature: CPU cost

Scenario F1 — Idle console does not peg a core
  Given a running idle server (no clients) with the console active
  When the game process's CPU use is sampled over 60 s
  Then it is no more than 15 percentage points above the same idle server run with the old direct-spawn path (user confirmed this threshold on 2026-10-23; S1 baseline was 27.5% of one core)

### Feature: Documentation

Scenario E1 — README matches behavior
  Given the finished implementation
  When a reader follows `games/stationeers/README.md`
  Then the documented stdin usage, optional `--log-file` (including that it no longer contains Unity's own log), no-manual-log-flag rule, and CPU note match what S7 measured

## Protocol

**Pack:** four-pack

- **Chunk order:** S1 first (feasibility spike and research); nothing else starts until S1 is approved, because it fixes the kernel32 wiring, the terminal settings and Enter byte, the throttle feasibility, and the `Player.log` path. After S1, S2, S3 and S5 may run in parallel (disjoint files). S4 depends on S2 and S3. S6 depends on S5 (and S1). S7 depends on S4, S5 and S6. S8 depends on S7.
- **Parallelism and ownership:** S2/S3/S5 own disjoint files. S5 and S6 both touch `handler.ts`; they must run sequentially (S6 after S5 is approved). The RCON roadmap is parked (see Decisions); no other roadmap may edit `games/stationeers/tool/command/run/*` while this one is in progress.
- **Scope boundaries:** each implementor may change only the files listed for its task and append evidence to that task's Agent log. If S1 shows neither `<dllmap>` nor `LD_PRELOAD` removes the kernel32 failure, or the end-to-end spike fails, or the throttle is infeasible, mark S2–S8 blocked and ask the user; do not invent another mechanism.
- **Build for live tests:** build the tool bundle with `pnpm eval build-game-tool --game=stationeers` (produces `games/stationeers/dist/tool.js`), then `docker build --platform=linux/amd64 --file=games/stationeers/Dockerfile games/stationeers` (context is `games/stationeers`, matching `build-game-image`; this downloads about 10 GB of game files, so reuse the local layer cache and the existing local image where possible).
- **Verification commands (when applicable):**
  - TypeScript: `pnpm exec tsc --noEmit --pretty false`
  - Focused tests: `pnpm exec tsx --test games/stationeers/tool/command/run/handler.test.ts`
  - Bundle: `pnpm exec esbuild games/stationeers/tool/main.ts --bundle --platform=node --outfile=/tmp/stationeers-tool.js`
  - Whitespace: `git diff --check`
  - Live checks (S7) use throwaway containers as described in Decisions.
- **Review:** coder → cleaner → reviewer per four-pack. Reviewers check the task checklist, the locked decisions, and the signal/stdio contract end to end.

## Cleanup lane

- Behavior-preserving tidy only, within each chunk's Files list: remove the dead commented-out `autosavecancel` block in `handler.ts` and the stale "perform autosave" sentence in `command.ts` only as part of S5, and nowhere else. The separate `cleaner` stage is part of four-pack and has the same file limits.

---

## Human gate / Executable

- [x] User sets this roadmap **Executable** (explicit approval) before implementors treat it as execute-ready. Approved by the user on 2026-10-23.

Drafts are not execute-ready until the user explicitly approves Executable. Review approval does not grant Executable status. The F1 CPU threshold is confirmed: on 2026-10-23 the user approved 15 percentage points above the old direct-spawn idle CPU. S2 still waits for S1 review approval.

## Task list

### S1 — Feasibility spike: kernel32 loading, end-to-end console, throttle, Player.log

**Status:** approved

**Depends on:** none

**Files:** this roadmap (S1 Agent log only). Optional scratch evidence under `stn-diag/<timestamp>/` (untracked).

#### Implementor checklist

- [x] Using a throwaway container from the existing local image (`kevinresol/stationeers-dedicated-server:latest`) and a throwaway save, explain why the failure is `EntryPointNotFoundException` rather than `DllNotFoundException`, with `strace -f -e openat` or `LD_DEBUG=libs` evidence.
- [x] Inspect `MonoBleedingEdge/etc/mono/config` for existing `<dllmap>` entries and record its path inside the image.
- [x] Build a throwaway stub exporting `SetConsoleOutputCP` and `SetConsoleCP` returning `1`; test wiring A (`<dllmap>`) then, only if A fails, wiring B (`LD_PRELOAD`). Record which removes the exception, with log evidence.
- [ ] If neither works, stop and mark S2–S8 blocked with the evidence.
- [x] **End-to-end spike:** with the working stub, no `-logfile`/`-logFile`, and a PTY on fd 0/1 (for example `docker run -t`, or Python `pty`/`script` as a stand-in for `stn-pty`), prove the game executes typed `help` and `save stnspike1` (save file appears under the throwaway data dir). Record which input byte (`\n` or `\r`) Mono maps to Enter, and whether a raw-mode slave breaks Mono's own `termios` handling; record the terminal settings that work.
- [x] Confirm the exact syscall behind `Console.KeyAvailable` (expected `poll` on fd 0 with timeout 0) by `strace -f -e trace=poll,ppoll,select`, measure the spin rate and idle CPU, then prototype the `poll()` interposer and measure again. Record whether it is effective and that input latency stays acceptable. Also measure the baseline CPU of the old direct-spawn path and propose the F1 threshold (user confirms before S2).
- [x] Determine the real `Player.log` path for the dedicated server build (and whether `HOME` differs for the `steam` user). Check whether Unity writes console lines to both `Player.log` and the console (duplicate lines on stderr/stdout).
- [x] Record whether any further Win32 symbols are resolved after the console constructor runs (look for additional `EntryPointNotFoundException`s during a bounded 60 s run).
- [ ] If the spike or the throttle fails, mark S2–S8 blocked and ask the user (opt-in console vs accepting one busy core vs stopping).
- [x] Do not touch the user's existing `stationeers` container, volumes, or data.

#### Reviewer checklist

- [x] The chosen wiring is supported by captured evidence, not assumption, and was tested against the current image build.
- [x] No existing container/data was modified; no credentials appear in recorded evidence.
- [x] The `Player.log` path claim is evidence-backed.
- [x] The spike really executed a command on the real server (save file present), and the Enter byte, terminal settings, and throttle effectiveness are each recorded with evidence.

#### Agent log

Implementor, 2026-10-23. Evidence under `stn-diag/20261022T222241Z/` (image `stn-s1-lab:1`, from `kevinresol/stationeers-dedicated-server:latest`). Throwaway containers only. `stationeers` stayed exited; `FinishedAt` unchanged (`2026-10-22T11:39:53.851256288Z`). Containers `stn-s1-nm`, `stn-s1-symtest`, `stn-s1-throttle`, `stn-s1-base` and volumes `stn-s1-vol-throttle`, `stn-s1-vol-base` were removed. No credentials recorded.

**Why `EntryPointNotFoundException`.** Mono config file (Mono logs the directory `.../MonoBleedingEdge/etc`; the file is `mono/config` under that):

`/home/steam/Steam/steamapps/common/StationeersDedicatedServer/rocketstation_DedicatedServer_Data/MonoBleedingEdge/etc/mono/config`

The stock `<dllmap dll="i:kernel32.dll">` block maps `CopyMemory`, `FillMemory`, `MoveMemory`, and `ZeroMemory` to `__Internal`. The dll resolves, so `q1/strace-open.txt` never opens a `kernel32` file, and `q1/game.log` is `EntryPointNotFoundException: SetConsoleOutputCP` (lowercase `-logfile` still constructs the console; only exact `-logFile` skips it). Removing that block (`v1-remove`) makes Mono search the filesystem and throw `DllNotFoundException: kernel32.dll`.

**Wiring S4 must apply (wiring A, dllentry).** Mono keeps the last matching map. A new `<dllmap dll="kernel32.dll" target="..."/>` inserted before the stock block (`vA1`) is ignored: the shim is never opened and `EntryPointNotFoundException` remains. The same element appended after the block (`vA1b`) does clear the exception, but it replaces the whole dll and drops the four `__Internal` entries. Do not ship that.

S4 must insert these two lines inside the existing `<dllmap dll="i:kernel32.dll">` block, after the four `__Internal` entries and before that block's `</dllmap>`, and fail the build if that block is missing. Spike path was `/tmp/shim/libkernel32-shim.so`; the image path is `/home/steam/shim/libkernel32-shim.so`:

```xml
		<dllentry dll="/home/steam/shim/libkernel32-shim.so" name="SetConsoleOutputCP" target="SetConsoleOutputCP"/>
		<dllentry dll="/home/steam/shim/libkernel32-shim.so" name="SetConsoleCP" target="SetConsoleCP"/>
```

`vA2` used that shape. `vA2/stn-shim.log` shows `SetConsoleOutputCP(65001)` and `SetConsoleCP(65001)`, and `vA2/game.log` has neither exception. `LD_PRELOAD` was not needed to resolve kernel32. It is still required on the game child only, for the `select` throttle below (same `.so`).

**End-to-end.** No `-logFile`, A2 dllentry, PTY via `lab/ptyrun.py` (kernel slave defaults, no `RAWSLAVE`, 200x50, `TERM=xterm`). Paced typing executed `help` (command list at 22:38:01) and `save stnspike1` (`Starting NewSave for stnspike1`, `Created new save` at 22:38:45–46) in `e2e2/pty-out.redacted.txt`. Enter byte Mono reads is `\n` (0x0a): `e2e2/strace-read-fd0-paced.txt` shows `read(0, "\n", 1024) = 1`. `icrnl` is on, so a master-side `\r` would also be delivered as `\n`; the byte the helper writes is `\n`. Raw mode was not switched on. Working `stty -a` (e2e1 after Mono init, and the same reading on the throttle run) is 38400 baud, rows 50, columns 200, `min = 1`, `time = 0`, `-inlcr -igncr icrnl`, `opost onlcr`, `isig -icanon iexten -echo`. S3 leaves those kernel defaults and does not call `cfmakeraw`. Output lines end in CR LF.

Burst-vs-paced risk for `stn-pty` (contract unchanged): Mono's read is `read(0, buf, 1024)`. A queued burst returned four bytes at once (`e2e1/strace-read-write-after-abc.txt`, `read(0, "abc\n", 1024) = 4`). Paced one-byte writes are what executed `help` and `save`. A single write of a whole line to the PTY master is not what this spike proved.

**Throttle.** `Console.KeyAvailable` is not `poll`. Unthrottled (`e2e2/strace-keyavailable.txt`): 31232 `pselect6(1, [0], NULL, NULL, {tv_sec=0, tv_nsec=0})` in 6 s (~5205/s), zero `poll`/`ppoll`. An unversioned `select` interposer changed `pselect6`. An `LD_PRELOAD` `select` (and `pselect`/`poll`, forwarded unless they match) lengthens only `nfds==1`, read fd 0, `NULL` write/except, zero `timeval` to 10 ms. Counters on the game (`throttle/post.txt`): `select` 7153, of which 7152 were that case; `pselect` 0; `poll` 84, of which 0 were fd-0 timeout 0. Attached strace (`throttle/pselect-sample.txt`): `pselect6` timeout `tv_nsec=10000000`, 188 calls in 2 s, `poll` count 0. Idle CPU, same `cpu.py`, 60 s after the world save:

| run | process CPU | hottest thread |
| --- | --- | --- |
| console, no throttle (`e2e2/cpu-60s-console-nothrottle.txt`) | 117.5% | `rocketstation_D` 100.0% |
| console + 10 ms `select` (`throttle/cpu-60s.txt`) | 26.9% | `rocketstation_D` 12.3% |
| old direct spawn, no PTY, `-logfile /home/steam/stationeers.log`, stdin `/dev/null` (`baseline/cpu-60s.txt`) | 27.5% | `rocketstation_D` 13.4% |

Throttled minus baseline is −0.6 percentage points. **Proposed F1 threshold: 15 percentage points** above the direct-spawn process CPU (the provisional number). This pair of samples also fits a threshold of 5; 15 is the number to confirm so a heavier world does not false-fail. User confirms before S2. A paced `help\n` (30 ms/byte) after the sample showed "Displays helpful stuff" within the 1 s check. S2 interposes `select` with that predicate, not `poll`.

**`Player.log`.** `steam` HOME is `/home/steam` (passwd and the game environ). On the no-`-logFile` PTY run there was no `Player.log` under `/home/steam` (walk count 0), no `~/Rocketwerkz`, and `~/.config/unity3d/Rocketwerkz/rocketstation/` contained only `prefs` (218 bytes). The ready check required `RakNet successfully hosted` on the PTY. `e2e2/pty-out.redacted.txt` has both that line and the Unity shader errors. Those lines are on the console only; there is no second copy in `Player.log` while stdout is a PTY. S6's glob `~/.config/unity3d/*/*/Player.log` does not match this run. Company/product directory, if a file appears later, is `Rocketwerkz/rocketstation`.

**Further Win32 symbols.** None. Full PTY log and the 60 s idle delta (`throttle/window-exceptions.txt`) had no `EntryPointNotFoundException` or `DllNotFoundException`. Shim log shows only the two `SetConsole*` calls. S2 exports those two and nothing else.

Spike and throttle both worked. S2–S8 stay pending. S2 does not start until this chunk is approved and the user confirms the F1 number of 15.

**F1 confirmed — 2026-10-23.** The user approved the idle-console CPU limit: 15 percentage points above the old direct-spawn path (S1 sample 27.5% of one core; throttled console sample 26.9%). S2 may start once S1 is approved.

#### Reviewer — S1 — 2026-10-23

Verdict: revise

- Issue: the paced `save stnspike1` is only a console transcript (`Starting NewSave`, `file created in 18ms`, `Created new save`). The only on-disk path captured is the startup world `/data/StnS1/StnS1.save`. Risk: later chunks can treat a console line as proof the command wrote a save. Expected change: on a throwaway container, repeat the paced `save stnspike1` and record the save file path and size in the evidence and this log.
- Also drop or source the sentence that `libmonobdwgc-2.0.so` imports `select@GLIBC_2.2.5`. No artifact shows that version. The captured fact is that an unversioned `select` interposer changed `pselect6`.

Wiring A, Enter byte `\n`, kernel terminal defaults, the `select` throttle (117.5% / 26.9% / 27.5%), no `Player.log`, no further Win32 exception, and throwaway cleanup matched the evidence. `stationeers` was still exited at `2026-10-22T11:39:53.851256288Z`. After the save listing, S2 may interpose `select` (not `poll`). The missing `Player.log` does not block S6. Retry 1 of 2.

**Implementor — S1 revise 1.** Throwaway `stn-s1-e2e-save` (image `stn-s1-lab:1`, volume `stn-s1-vol-e2e-save`, no published ports): A2 dllentry, no `-logFile`, PTY, paced one-byte `save stnspike1` and a final `\n`. After the console reported `Starting NewSave for stnspike1` and `Created new save`, `stn-diag/20261022T222241Z/e2e-save/data-listing.txt` lists `/data`. Save path `/data/stnspike1/stnspike1.save`, 18249 bytes. Removed container `stn-s1-e2e-save` and volume `stn-s1-vol-e2e-save`. `stationeers` stayed exited at `2026-10-22T11:39:53.851256288Z`.

#### Reviewer — S1 attempt 2 — 2026-10-23

Verdict: approve. The paced save is on disk at `/data/stnspike1/stnspike1.save` (18249 bytes) in `stn-diag/20261022T222241Z/e2e-save/data-listing.txt`. The `select@GLIBC_2.2.5` version is not stated as fact. Residual risk: a single whole-line write to the PTY master is still unproved; paced one-byte writes ending in `\n` created the save. S2 implements `select`, not `poll`. The missing `Player.log` does not block S6. Pack four-pack; no separate cleaner diff because S1 files are this log and untracked evidence. Evidence under `stn-diag/` stays untracked. S2, S3, and S5 start in parallel worktrees.

---

### S2 — `kernel32` stub and `poll` throttle library

**Status:** approved

**Depends on:** S1 approved

**Files:** `games/stationeers/shim/kernel32_shim.c`

#### Implementor checklist

- [x] Implement `SetConsoleOutputCP` and `SetConsoleCP` as no-ops returning `1`, with the signatures the game uses (`uint32_t` argument).
- [x] Add any additional Win32 symbols S1 found to be required, and nothing else.
- [x] Implement the `poll()` interposer exactly as specified in the CPU throttle decision (only `nfds == 1`, `fd == 0`, `timeout == 0` is altered; everything else forwards to libc via `dlsym(RTLD_NEXT, "poll")`; thread-safe, no allocation). If S1 selected another syscall (`ppoll`/`select`), interpose that one instead and say so in the file header.
- [x] Compile with `-shared -fPIC -O2 -Wall -Wextra -Werror` in a throwaway `gcc` container and confirm the exported symbols appear in `nm -D` output.
- [x] Add a small standalone test (shell + tiny C driver compiled in the same container; the driver may live inline in the Agent log rather than the repo) showing `poll(fd 0, timeout 0)` blocks about the substituted timeout while other `poll` calls are unchanged; paste the output.
- [x] Add a header comment stating why the library exists and linking to the decompile finding.

#### Reviewer checklist

- [x] Exported symbol names and return type match the P/Invoke usage (`bool` marshalled as non-zero success).
- [x] The interposer cannot alter any call except the exact fd-0 zero-timeout case, and cannot recurse.
- [x] No scope creep beyond the symbols justified by S1 evidence.

#### Agent log

Pack four-pack. Coder starting 2026-10-23 in worktree `roadmap/stationeers-console-shim/S2`. Interpose `select`, not `poll`. No extra Win32 symbols.

**Implementor — S2 — 2026-10-23.** `games/stationeers/shim/kernel32_shim.c` only, uncommitted, worktree `roadmap/stationeers-console-shim/S2`. Exports `SetConsoleOutputCP` and `SetConsoleCP` (`uint32_t` in, return 1) and nothing else. Interposes `select` and `pselect`: only `nfds==1`, read fd 0 set, NULL write and except, and a zero timeout is replaced with 10 ms (`timeval` `{0,10000}` / `timespec` `{0,10000000}`) via `dlsym(RTLD_NEXT)`. Other calls forward unchanged. Pointers resolved in a constructor. Throwaway `gcc:13` (`stn-s2-gcc-throwaway`, `--rm`): `gcc -shared -fPIC -O2 -Wall -Wextra -Werror` clean. `nm -D` defined symbols: `SetConsoleCP`, `SetConsoleOutputCP`, `pselect`, `select`. Preloaded `select(fd 0, timeout 0)` measured 10234, 10487, 10376, 10252, 10278 µs; caller's `timeval` stayed `{0,0}`. Other shapes (empty read set, non-NULL write or except, extra fd, 1 ms, 50 ms, ready fd 0) stayed unthrottled. `pselect` zero timeout 10223 µs. Both console calls returned 1. `failures=0`. The `.so` imports `dlsym@GLIBC_2.34`; S4 must rebuild on the game image's glibc. `stationeers` stayed exited at `2026-10-22T11:39:53.851256288Z`.

**Cleaner — S2 — 2026-10-23.** No changes. `kernel32_shim.c` already matches the S1 predicate and the two Win32 stubs. The gcc container was not re-run.

#### Reviewer — S2 — 2026-10-23

Verdict: approve. `kernel32_shim.c` exports `SetConsoleOutputCP` and `SetConsoleCP` (`uint32_t` in, `int` 1 out) and interposes `select` and `pselect` only for `nfds==1`, read fd 0, NULL write and except, zero timeout, substituting a stack 10 ms timeout via the constructor-cached `dlsym(RTLD_NEXT)` pointer. Other call shapes are forwarded and the hook cannot recurse. Cleaner made no changes. Residual: S4 must rebuild this source on the game image's glibc. The gcc:13 test `.so` imports `dlsym@GLIBC_2.34` and is not the image binary. If `dlsym` failed, `select` and `pselect` would return `ENOSYS`.

---

### S3 — `stn-pty` PTY bridge

**Status:** approved

**Depends on:** S1 approved (terminal settings and Enter byte are fixed by S1; the CLI contract is frozen in Decisions)

**Files:** `games/stationeers/shim/stn_pty.c`, `games/stationeers/shim/stn_pty_test.sh`

#### Implementor checklist

- [x] Implement the frozen CLI contract: `forkpty` child exec, the terminal settings and Enter byte S1 proved to work, 200x50 window size, `TERM=xterm` default, bidirectional copy master↔stdio with a `poll` loop. Set `LD_PRELOAD` for the child only if the wrapper passes it in the environment; the helper itself must not be preloaded.
- [x] Forward `SIGINT`/`SIGTERM` to the child, propagate its exit status (`128+n` for signals), and keep running when stdin reaches EOF: drop fd 0 from the `poll` set on EOF and never close the PTY master while the child lives.
- [x] Handle `SIGCHLD`, partial writes, and `EINTR` correctly; drain remaining PTY output before exiting.
- [x] Compile with `-Wall -Wextra -Werror` in a throwaway `gcc` container (`-lutil` as needed).
- [x] `stn_pty_test.sh` uses a trivial child (for example a shell script that prints `isatty` results for fd 0/1 and echoes lines) to prove: both fds are TTYs under `docker run -i` without `-t`; input lines reach the child; exit status propagates for both normal exit and signal death; SIGTERM is forwarded; EOF on stdin (explicit and `/dev/null`) leaves the child running and does not make the helper spin (measure its CPU over a few seconds).
- [x] Run the test script in a throwaway container and paste the output into the Agent log.

#### Reviewer checklist

- [x] The contract in Decisions is implemented exactly, including the EOF and signal behavior.
- [x] No fd leaks into the child; no zombie processes; no busy loop in the helper itself.
- [x] Test evidence covers each bullet, not just the happy path.

#### Agent log

Pack four-pack. Coder starting 2026-10-23 in worktree `roadmap/stationeers-console-shim/S3`. Enter byte is `\n`. Leave kernel terminal defaults; do not call `cfmakeraw`.

**Implementor — S3 — 2026-10-23.** `stn_pty.c` and `stn_pty_test.sh` only, uncommitted. `forkpty`, no `cfmakeraw`, window 200x50, `TERM=xterm` when unset or `dumb`, Enter copied as `\n`. Stdin EOF drops fd 0 and does not close the master. `SIGINT`/`SIGTERM` forwarded; exit is the child's or `128+n`. Helper re-execs so it is not preloaded; the child keeps `LD_PRELOAD` with the helper path removed. Throwaway `gcc:13`, `docker run -i` without `-t`: `ALL_PASS`. Child fds 0/1/2 were a PTY. EOF left the child running at 0 CPU ticks over 3s. Residual: a whole line in one PTY write is still unproved against Mono. `stationeers` stayed exited at `2026-10-22T11:39:53.851256288Z`.

**Cleaner — S3 — 2026-10-23.** No changes. `stn_pty.c` and `stn_pty_test.sh` already match the frozen contract. The gcc container was not re-run.

#### Reviewer — S3 — 2026-10-23

Verdict: approve. `stn-pty` uses `forkpty` with kernel defaults, copies Enter as `\n`, and does not close the PTY master on stdin EOF. Signals and exit status propagate. The helper is not preloaded. Residual: a whole line in one PTY write is still unproved against Mono. The frozen contract does not require pacing.

---

### S4 — Dockerfile and entrypoint wiring

**Status:** approved

**Depends on:** S2 and S3 approved

**Files:** `games/stationeers/Dockerfile`, `games/stationeers/entrypoint.sh`

#### Implementor checklist

- [x] Add a compile stage (throwaway Debian/gcc image matching the base image's glibc generation; record `ldd --version` of both in the Agent log and confirm the built `.so`/binary run in the final image) that builds `libkernel32-shim.so` and `stn-pty` from `games/stationeers/shim/`; copy only the outputs to `/home/steam/shim/` in the final image with `steam:steam` ownership.
- [x] Implement the S1-selected kernel32 wiring: the `<dllmap>` entry written into the Mono config at build time (fail the build loudly if the config edit target is missing), or the `LD_PRELOAD` fallback. In either case, `LD_PRELOAD` for the throttle is set only for the game child by the wrapper (S5 reads the library path from `/home/steam/shim/libkernel32-shim.so`); never add an image-wide `ENV LD_PRELOAD`.
- [x] Ensure the `xterm` terminfo entry exists in the final image (install the package only if it is absent).
- [x] Remove the default `ENV GAME_LOG_FILE` so no log file is created unless the user opts in. Keep other internal vars unchanged.
- [x] In `entrypoint.sh`, remove `set -x` and make the backgrounded node command inherit stdin explicitly (`0<&0`), so `docker run -i` input is not replaced by `/dev/null`; keep the SIGTERM trap and `wait` structure unchanged.
- [x] Build the image locally using the build commands in Protocol with the current `dist/tool.js`, and confirm the shim files and wiring are present and that fd 0 of the node process is a pipe/tty (not `/dev/null`) under `docker run -i` using a short-lived throwaway container. Do not run a long-lived server in this task.

#### Reviewer checklist

- [x] The final image contains no compiler or build artifacts beyond the two shim outputs.
- [x] Wiring matches S1's evidence; the build breaks if the config file moves; no image-wide `LD_PRELOAD`.
- [x] `entrypoint.sh` diff is limited to removing `set -x` and the stdin inheritance.

#### Agent log

Pack four-pack. Coder starting 2026-10-23 in worktree `roadmap/stationeers-console-shim/S4`. Kernel32 wiring is two `dllentry` lines inside the existing `<dllmap dll="i:kernel32.dll">` block. Do not set an image-wide `LD_PRELOAD`. Rebuild the shim on the game image's glibc.

**Implementor — S4 — 2026-10-23.** `games/stationeers/Dockerfile` and `entrypoint.sh` only, uncommitted, worktree `roadmap/stationeers-console-shim/S4`. Local image `stn-s4-wiring:local`; `kevinresol/stationeers-dedicated-server` was not retagged. Compile stage is the base image plus `gcc` and `libc6-dev` from the Debian snapshot in `debian.sources` (`20260223T000000Z`). `ldd --version` is `ldd (Debian GLIBC 2.41-12+deb13u1) 2.41` in that stage and in the final image. Both outputs are `/home/steam/shim/`, owner `steam:steam`. Highest imported glibc symbol is `GLIBC_2.34`. In the final image `ldd` resolves both, `SetConsoleOutputCP(65001)` and `SetConsoleCP(65001)` return 1, and `stn-pty /bin/true` exits 0. `gcc` is absent. No image `ENV LD_PRELOAD`. Runtime stage does not set `GAME_LOG_FILE` (install stage keeps the previous `ENV` so the Steam layer can be reused). xterm terminfo was already `/usr/share/terminfo/x/xterm`; `ncurses-base` was not installed. Two `dllentry` lines sit after the four `__Internal` entries inside `<dllmap dll="i:kernel32.dll">`. The edit exits 1 if the config file, that block, or any of the four entries is missing (checked on a copy: renamed block, missing file, dropped `ZeroMemory`). `entrypoint.sh` is `set -e` and `node ~/tool.js run -- "$@" 0<&0 &`; the SIGTERM trap and `wait` are unchanged. Under `docker run -i` without `-t`, node fd 0 was `pipe:[18278]`, the same pipe as `stn-pty`, not `/dev/null`. Removed throwaway `stn-s4-fdcheck`. `stationeers` stayed exited at `2026-10-22T11:39:53.851256288Z`.

**Cleaner — S4 — 2026-10-23.** No changes. The glibc pin, dllmap checks, ownership, and stdin inheritance stay as written. The image was not rebuilt.

#### Reviewer — S4 — 2026-10-23

Verdict: approve. `stn-s4-wiring:local` keeps the four `__Internal` entries and adds the two `dllentry` lines for `/home/steam/shim/libkernel32-shim.so` inside the existing kernel32 `dllmap`. The build exits 1 if that config, that block, or any of those four entries is missing. The runtime image sets neither `LD_PRELOAD` nor `GAME_LOG_FILE`. `/home/steam/shim/` holds only the two shim binaries, both `steam:steam`, and the compiler tools are absent. The `entrypoint.sh` diff is `set -e` and `0<&0` on the backgrounded node command. Residual: this review did not re-measure the discarded compile stage's `ldd --version`, and did not repeat the stdin-pipe run or the negative config edits. Lands with the image wiring in this commit.

---

### S5 — Wrapper: spawn through `stn-pty`, tee, log-flag rules

**Status:** approved

**Depends on:** S1 approved (uses the frozen helper contract)

**Files:** `games/stationeers/tool/command/run/handler.ts`, `games/stationeers/tool/command/run/command.ts`, `games/stationeers/tool/command/run/handler.test.ts`

#### Implementor checklist

- [x] Spawn `${STN_PTY_BIN ?? "/home/steam/shim/stn-pty"} <game binary> <args>` with `stdio: ['inherit', 'pipe', 'pipe']`, setting `LD_PRELOAD=/home/steam/shim/libkernel32-shim.so` (joined with any existing value) in the child environment only. Pipe helper stdout to `process.stdout` and tee it into the log file; forward helper stderr to `process.stderr`. Resolve the run promise on the child's `close` event, not `exit`.
- [x] Choose and test one normalization rule for the tee file versus stdout (identical bytes, or the same stripping applied to both), per scenario C2.
- [x] Stop appending `-logfile`. Reject (case-insensitive) a user-supplied `-logfile` or `-logFile` with an error pointing to `--log-file`/`GAME_LOG_FILE`.
- [x] Add `-noclear` unless already present.
- [x] With `--log-file`: ensure the file exists, tee console output into it (append), and delete it on exit as today. Remove the `tail -f` subprocess.
- [x] Preserve `SIGTERM` → `SIGINT` forwarding (target is the helper, which forwards it) and the exit-code logging/reject-on-non-zero behavior.
- [x] Update the command description in `command.ts` to describe the real behavior (stdin console, `--log-file` tee) and remove the stale autosave sentence.
- [x] Remove the dead commented-out `autosavecancel` block (cleanup lane).
- [x] Add tests with a fake helper and a fake game script (via `STN_PTY_BIN`): arg list contains no log flags and has `-noclear`; manual log flag rejected in both spellings; tee matches stdout per the chosen rule; fd 0 of the helper is inherited from the wrapper (a fake helper asserts it is not a pipe created by Node); `LD_PRELOAD` is set for the child only; the log file is not deleted before the last output is flushed; SIGTERM maps to SIGINT; exit code handling. Tests must not depend on source-text assertions only.
- [x] Run tsc, focused tests, esbuild bundle, and `git diff --check`; paste results in the Agent log.

#### Reviewer checklist

- [x] The game process can never receive a log flag, via any path (user args, env, option).
- [x] stdout/stderr behavior is unchanged when `--log-file` is set.
- [x] Signal and exit behavior match the pre-change behavior; no new shutdown flows.
- [x] Scope limited to the listed files; the dead-code removal is behavior-neutral.

#### Agent log

Pack four-pack. Coder starting 2026-10-23 in worktree `roadmap/stationeers-console-shim/S5`. Helper contract is frozen. Do not tail `Player.log` here.

**Implementor — S5 — 2026-10-23.** Uncommitted in `roadmap/stationeers-console-shim/S5`. Spawns `stn-pty` with `stdio: ['inherit','pipe','pipe']`, sets `LD_PRELOAD` on the child only, and settles on `close`. C2 rule is identical bytes: helper stdout is copied unchanged to process stdout and appended to `--log-file`. The wrapper never appends `-logfile` and rejects an exact `-logfile`/`-logFile` token in any case. Adds `-noclear` unless present. `tail -f` is gone. SIGTERM still sends SIGINT to the helper. `tsc`, 14 handler tests, esbuild, and `git diff --check` passed. Residual: a one-token `-logfile=/path` is not rejected. `Player.log` remains S6.

**Cleaner — S5 — 2026-10-23.** No changes. The `autosavecancel` block and the stale autosave sentence are already gone. Verify commands were not rerun.

#### Reviewer — S5 — 2026-10-23

Verdict: approve. The wrapper spawns `stn-pty` with inherited stdin, tees identical console bytes when `--log-file` is set, rejects an exact `-logfile` token, and still turns SIGTERM into SIGINT. Residual: a one-token `-logfile=/path` is still forwarded. That is outside C3, whose examples are the separate tokens `-logfile x` and `-logFile -`.

---

### S6 — Tail Unity `Player.log` to stderr

**Status:** approved

**Depends on:** S1 and S5 approved

**Files:** `games/stationeers/tool/command/run/playerlog.ts`, `games/stationeers/tool/command/run/playerlog.test.ts`, `games/stationeers/tool/command/run/handler.ts` (hook only)

#### Implementor checklist

- [x] Implement a small module that waits (bounded, about 30 s) for the S1-identified `Player.log` (glob fallback `~/.config/unity3d/*/*/Player.log`), then streams appended lines to `process.stderr`; it must also stream content written before it attached.
- [x] Stop it cleanly when the server exits; a missing file must never fail or delay startup/shutdown, and a single warning line is acceptable.
- [x] Wire it into the handler with the smallest possible change; do not alter the `--log-file` tee or the signal handling.
- [x] Tests with a temp directory: file appears late, file pre-exists, never appears, stop-on-exit.
- [x] Run tsc, focused tests, bundle, `git diff --check`; paste results in the Agent log.

#### Reviewer checklist

- [x] No unbounded wait, no leaked watchers/child processes after exit.
- [x] Output goes to stderr only.
- [x] `handler.ts` changes are limited to the hook.

#### Agent log

Pack four-pack. Coder starting 2026-10-23 in worktree `roadmap/stationeers-console-shim/S6`. S1 found no `Player.log` under `/home/steam` when stdout is a PTY. Company/product directory, if a file appears, is `Rocketwerkz/rocketstation`. A missing file must not fail startup.

**Implementor — S6 — 2026-10-23.** Uncommitted. New `playerlog.ts` and `playerlog.test.ts`. `handler.ts` starts the tail and stops it on the helper `close` event. The known path is `~/.config/unity3d/Rocketwerkz/rocketstation/Player.log`, with a newest-file glob fallback. A missing file warns once after 30s and does not hold startup or shutdown. Output goes to stderr. `tsc`, 7 playerlog tests, 14 handler tests, esbuild, and `git diff --check` passed. Residual: S1's PTY run had no `Player.log`, so a normal container may only log that warning.

**Cleaner — S6 — 2026-10-23.** No changes. The tail, tests, and handler hook were already limited to this chunk. Verify commands were not rerun.

#### Reviewer — S6 — 2026-10-23

Verdict: approve. The tail prefers `~/.config/unity3d/Rocketwerkz/rocketstation/Player.log`, otherwise the newest `~/.config/unity3d/*/*/Player.log`. `startPlayerLog` returns immediately. A missing file writes one stderr warning after about 30 seconds and then stops. `stop()` on the helper `close` event clears that timer and does not wait out the deadline. The `handler.ts` change is the start/stop hook only. Residual: a normal PTY run may have no `Player.log`, so the container may only emit that warning. Lands with the Player.log tail in this commit.

---

### S7 — Live integration verification

**Status:** blocked

**Depends on:** S4, S5, S6 approved

**Files:** this roadmap (S7 Agent log only); scratch evidence under untracked `stn-diag/<timestamp>/`

#### Implementor checklist

- [x] Build the full image locally and run only throwaway containers with random credentials, a throwaway save, and no published ports unless needed.
- [ ] Verify Acceptance A1 (grep both container output and `Player.log`), B1, B2, B3 (both the `-i` EOF and no-`-i` cases), B4, C1 (via `/proc/<pid>/cmdline`), C2, C3, C4, D1, D2 and F1; record command, output excerpt (credentials redacted), and result for each.
- [x] If a scenario fails, record evidence and mark S7 blocked rather than patching files outside this task's scope; report the failing owner task.
- [ ] For F1, sample the game's CPU for 60 s with the console active and compare against the S1 direct-spawn baseline; for D1, record the observed stop time and the container exit code.
- [x] Clean up all containers, volumes, and images created, and list what was removed.

#### Reviewer checklist

- [ ] Every Acceptance scenario (A1 through F1) has captured evidence or an explicit, justified "not verifiable".
- [ ] No credentials in evidence; the user's existing containers/data untouched.
- [ ] Cleanup list is complete.

#### Agent log

Pack four-pack. Coder starting 2026-10-23 on master `c47408c`. Live checks use throwaway containers only. Do not touch the user's `stationeers` container. F1 limit is 42.5% of one core (S1 baseline 27.5% plus 15 points).

Implementor — S7. Image `stn-s7-live:local` (`linux/amd64`, built from `games/stationeers/Dockerfile` after `pnpm eval build-game-tool --game=stationeers`; Steam layer reused from cache). Tag removed when the run finished. `kevinresol/stationeers-dedicated-server` was not retagged. `stationeers` stayed `exited 2026-10-22T11:39:53.851256288Z`. B1 failed, owner S3. Status blocked. No product files were patched. Evidence is under `stn-diag/20261023T013258Z/` with credentials written as redacted.

- A1 pass. `docker run -i` with `-file start MarsBase Mars2 Normal` and `-settings ServerPassword redacted ServerAuthSecret redacted`. Docker logs contain `RakNet successfully hosted with Address: 172.17.0.2:27016` and `Ready`. No `EntryPointNotFoundException` or `DllNotFoundException` for `SetConsoleOutputCP`/`SetConsoleCP`. `Player.log` was absent.
- B1 fail, owner S3. After Ready, one write of `save stnshim1` plus a newline on `docker run -i` produced no console echo and no `/data/stnshim1/stnshim1.save` within 90s. MarsBase had already been created on that volume. A separate diagnostic that wrote the same line one byte every 30ms created `/data/stnshim1/stnshim1.save` (18323 bytes) and logged `Starting NewSave for stnshim1`. Stopped after this failure, so B2, B3, C1 with `--log-file`, C2, and D1 were not run.
- B4 pass. On `docker run -i`, Node wrapper fd 0 was `pipe:[21356]`.
- C1 pass without `--log-file`. Game cmdline: `-file start MarsBase Mars2 Normal -settings ServerPassword redacted ServerAuthSecret redacted -noclear`. No `-logfile` or `-logFile`.
- C3 pass. `-logfile x` and `-logFile -` each exited 1 in under a second. Stderr: `Do not specify -logfile manually in the rest arguments, use the --log-file flag or GAME_LOG_FILE env var instead.` The game did not start.
- C4 not verifiable. No `Player.log`. Stderr warning once: `Player.log was not found under ~/.config/unity3d; Unity's file log will not be mirrored`.
- D2 pass. No entrypoint `set -x` lines. The wrapper argv echo and the game `Changed setting` lines contain the password and secret; those lines are redacted in the evidence.
- F1 pass. Idle server, no clients, console active, 60s: `process_cpu=28.0% of one core` (limit 42.5). Hottest thread `rocketstation_D` at 12.6%.
- D1 not run. No stop time or exit code.

Cleanup removed every `stn-s7-*` container and `stn-s7-vol-*` volume this task created, and removed the `stn-s7-live:local` tag. Retained `stn-s4-wiring:local` (`7f28c086e535`). No `docker system prune`. `stationeers` was not started, stopped, or modified.

**Orchestrator — S7 — 2026-10-23.** Hard block. Acceptance B1 requires one write of `save stnshim1` plus a newline. The approved S3 contract does not require pacing, and that write does not run the command. The same line sent one byte at a time does. S8 stays pending.

**Debug — 2026-10-23.** A single `help\n`, 10s after Ready on `docker run -it`, is delivered intact. `stn-pty` reads 5 bytes from its stdin and writes `help\n` (`0x0a` included) to the PTY master in one `write`. The game's `read(0, …, 1024)` returns those same 5 bytes. Mono's `ReadKey` returns only `h`. `KeyAvailable` then polls an empty fd 0, so `e`, `l`, `p`, and Enter stay in Mono's buffer and `OnEnter` never runs. The `> help` on screen is the outer terminal echo. The game redraws `> h`. The select hook saw the line (`pselect` returned readable) and is not the cause. Evidence: `stn-diag/20261023T030556Z/`. A paced control on the same server printed the help list. Unblocks if input is delivered one byte at a time so each `ReadKey` sees a fresh fd-0 byte, or if B1/B2 are changed to require that pacing. Patching Mono is out of scope.

---

### S8 — README documentation

**Status:** pending

**Depends on:** S7 approved

**Files:** `games/stationeers/README.md`

#### Implementor checklist

- [ ] Document sending commands over stdin (`docker run -i` / `docker attach`), with concrete example values and `[...]` around optional parts, per `AGENTS.md` README rules.
- [ ] Document the optional `--log-file`/`GAME_LOG_FILE` meaning (console output duplicate; no game log flag passed) and that manual `-logfile`/`-logFile` is rejected.
- [ ] Mention that `-noclear` is added automatically, that Unity's own log is mirrored to stderr, that `--log-file` no longer contains Unity's own log (migration note for users who relied on the old file), and the measured idle CPU note from S7.
- [ ] Document only behavior verified in S7 and specific to this image; do not alter other READMEs or the common structure.

#### Reviewer checklist

- [ ] Every documented behavior is backed by S7 evidence.
- [ ] Examples use concrete values, not abstract placeholders; optional parts bracketed.
- [ ] Only `games/stationeers/README.md` changed.

#### Agent log

<!-- implementor / reviewer append below -->
