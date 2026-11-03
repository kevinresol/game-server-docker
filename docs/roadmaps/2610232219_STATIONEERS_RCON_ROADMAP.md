# Stationeers RCON Server — Task Map

Replaces `2610112023_STATIONEERS_RCON_SAVE_ON_SIGINT_ROADMAP.md`, which is removed. That plan's HTTP console and save-on-SIGINT behavior are not part of this work.

## Goal (locked)

The Node.js Stationeers tool grows a Source RCON server that sits on the working stdin console. `--rcon` turns it on. `--rcon` with no port listens on 27500, and `--rcon=27500` listens on that port. An authenticated command is written to the console as one line, and the console's reply text is the RCON response.

The password is the `ServerAuthSecret` text in `setting.xml`. The code writes that file (the help text that says `settings.xml` does not). In batch mode the default path is the dedicated-server install directory, beside `saves/`, which this image links to `/data`. A `-settingspath` argument replaces that path. The file is not on the persistent volume unless that argument points there.

The idle prompt is the two characters `> ` at column 0, written with no trailing newline, usually after cursor-address bytes. The game also draws that prompt when it echoes the command, before the command runs, and it draws it again between later output chunks. A prompt that is then wiped is not the end of the reply. The reply ends at the first prompt that stays. Lines the game prints after that, including a later `Created new save`, are not part of that response.

**Out of scope:**

- Built-in save-on-SIGINT or save-on-SIGTERM, and any HTTP or `/console/run` client.
- Changing shutdown except as coordinated with `2611031304_STATIONEERS_SIGNAL_HOOK_ROADMAP.md` (optional `--pre-shutdown` before the same console `quit` path). Without that hook, SIGINT and SIGTERM still write `quit` to the console and do not signal the game process.
- Changing `stn-pty`, `libkernel32-shim.so`, or how the game reads stdin.
- A second RCON password, TLS, command allow-lists, command aliases, or pushing idle console output to a client that has no command in flight.
- Moving `setting.xml` onto `/data`, or following a runtime `SavePath` change. The settings path is fixed on first load; a later save-directory change does not move the file.
- BattlEye RCON, a custom line protocol, or a third-party RCON package.
- Publishing a port from the image build. Operators publish the TCP port themselves.

## Decisions (locked)

- **Protocol:** Valve Source RCON over TCP. Little-endian packet: `int32` size of the following bytes, `int32` id, `int32` type, a null-terminated body, then an extra null-terminated empty string. Types: client auth `3`, auth response `2`, exec command `2`, response value `0`. Auth success sends an empty response-value packet with the request id, then an auth-response packet with that same id. The connection stays open after an auth failure. Auth failure sends an auth-response packet with id `-1` and does not write a console command. An exec response is one or more response-value packets with the request id. The whole packet, including the size field, is at most 4096 bytes, so the size field itself is at most 4092. If the client then sends an empty response-value packet (the usual end marker), the server finishes the command response and then mirrors that empty packet with the same id. A client that does not send the marker still receives the command response. A TCP connection is a byte stream: the server buffers until one full packet is present, and one read that contains two packets yields both. Body text is UTF-8. A null byte in the reply is stripped so the packet stays framed. No new RCON dependency.
- **Flag:** The feature is off when `--rcon` is absent, and nothing listens. The accepted forms are a bare `--rcon` (port 27500) and `--rcon=<port>`. The port text is a decimal integer from 1 through 65535 with no sign, no leading zero, and no extra characters, so `01` is invalid. The entrypoint rejects the exact token `--rcon=` before starting node, because the tool cannot tell that token from a bare `--rcon`. A bare `--rcon` whose next container argument does not start with `-` is also rejected before node (`--rcon 27500` must not listen, and must not forward `27500` to the game). `--rcon -file` stays port 27500, and `-file` stays a game argument. More than one `--rcon` form is rejected before node. An invalid port that does reach the tool fails validation, does not bind, does not substitute 27500, and does not start the game. The listener binds `0.0.0.0` (all IPv4 interfaces). If that bind fails, the game process is not started.
- **Entrypoint:** `entrypoint.sh` places container arguments after `--`. It must remove every `--rcon` and `--rcon=<port>` from that list and pass those tokens to `tool.js run` before `--`. It must not treat the following argument as the port. The game process arguments do not contain the flag.
- **Password file:** Default path is `<bin path>/setting.xml` (`GAME_BIN_PATH`, the install directory). The root element must be `SettingData`. Exactly one `ServerAuthSecret` text element is required. Sibling elements such as `SavePath`, an XML declaration, comments, and a namespace attribute on the root are ignored. A comment that mentions `ServerAuthSecret` is not the secret. `SavePath` does not change which file is read. If the forwarded game arguments contain `-settingspath` followed by a token, that token is the file path, used unchanged, and the install-root file is not read. No token after `-settingspath` is a failure, and the install-root file is not read. There is no XML library in the repo; do not add one. Decode `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`, and numeric character references in both decimal (`&#65;`) and hex (`&#x41;`). A missing file, a missing or duplicated secret element, a wrong root, an empty secret, or a value that cannot be decoded fails closed. Each new connection reads the file again. An empty secret, a failed read, or a failed parse authenticates nobody, including a client that sends an empty password. Comparison is exact, case-sensitive, and does not trim. The secret is never logged, and a failed read does not reuse an older secret. The listener may be up before the game has written the file. The TCP server calls a `readSecret` function supplied by the handler. It does not import the secret reader and it does not see game arguments.
- **Reply:** The exchange writes exactly the command body plus one `\n` (the same newline the existing `quit` write uses). The framer is told that submitted line and drops one echoed occurrence of it. Other lines are kept, including a payload line that happens to be printed first. The RCON body is the remaining console text with cursor-control and cursor-address bytes removed, and it does not include the `> ` prompt. The same raw bytes are still written to container stdout and to `--log-file` when that flag is set. They are not held back for the 300ms prompt timer. A prompt is `> ` at column 0. Terminal column 1 (`CSI <row>;1H`) is that column. A prompt is cleared when the cursor is addressed back to column 0 or a clear-line sequence overwrites that line before 300ms. A prompt counts as the end only after it has stayed for 300ms without being cleared. The echo prompt is cleared when real output starts (the console tick is 100ms), so it is not the end when output follows. If nothing clears the echo prompt for 300ms, the command printed nothing and the body is empty. Bytes that arrive after the chosen end, including `Created new save` about a second later, are not added to that body. After a timeout, bytes that belonged to the timed-out command are discarded before the next reply. Tests may drive the 300ms bound with a fake clock.
- **One console:** Stdin and every RCON connection share one writer. The wrapper tracks whether the bytes it has already forwarded form a partial line. An RCON command waits until that stream is at a line boundary, then holds stdin, writes its own full line, and releases stdin only after the reply has ended. The partial stdin line is still delivered intact, as its own line, before that RCON line. Characters from stdin and from RCON never share a line. Overlapping RCON commands run one at a time. A body that contains CR or LF is not written. The client receives one response-value packet, type `0`, with the exec request id and body `command rejected`. An empty body writes nothing and returns one empty response-value packet with that id. SIGINT or SIGTERM during an RCON submit still writes a separate `quit\n` after the in-flight RCON line, not spliced into it, and does not signal the child.
- **Stuck console:** If no end prompt arrives within 30s, the RCON body is `console reply timed out`. The exchange writes no further line until a prompt has stayed for 300ms. Further commands during that wait return the same error and write nothing. If the console stream ends first, the body is `console closed`.
- **Signals:** SIGINT and SIGTERM use one serialized shutdown path in `handler.ts`. With no `--pre-shutdown` hook, that path writes `quit\n` to the server console stdin only (never `proc.kill("SIGINT")` on the `stn-pty` child). Enabling RCON does not change that default. When a pre-shutdown hook is configured (companion roadmap), the hook runs first with the fd-3 stdin bridge; after the hook phase, the same path applies, including R9 rules for an in-flight RCON line before `quit\n`.
- **Sessions:** The password is checked when a connection authenticates, not on every later command. A secret changed on disk applies to the next authentication. An already authenticated connection keeps its session.
- **Companion roadmap:** `2611031304_STATIONEERS_SIGNAL_HOOK_ROADMAP.md` adds optional `--pre-shutdown` / `GAME_PRE_SHUTDOWN`. It does not replace Source RCON. Implement R9 before the signal hook handler chunk (T2). Do not merge `--pre-shutdown` behavior into R8; T2 extends the shutdown path R9 defines.

## Acceptance

### Feature: Enable RCON

Scenario A1 — Flag absent
  Given the server is started without `--rcon`
  When a client tries to connect to TCP port 27500
  Then the connection is refused
  And the console still accepts stdin

Scenario A2 — Default port on all IPv4 interfaces
  Given the server is started with `--rcon` and no port
  When a client connects to TCP port 27500
  Then the connection succeeds
  And the listen address is `0.0.0.0`

Scenario A3 — Chosen port
  Given the server is started with `--rcon=27500`
  When a client connects to TCP port 27500
  Then the connection succeeds
  And TCP port 27015 does not accept an RCON connection

Scenario A4 — Another valid port
  Given the server is started with `--rcon=27015`
  When a client connects to TCP port 27015
  Then the connection succeeds

Scenario A5 — Invalid port does not start the game
  Given startup is requested with `--rcon=0`, `--rcon=99999`, `--rcon=abc`, or `--rcon=01`
  When the tool handles that request
  Then no RCON port accepts connections
  And port 27500 is not chosen instead
  And the game process is not started

Scenario A6 — Rejected flag forms do not start node
  Given startup is requested with `--rcon=`, with both `--rcon` and `--rcon=27500`, or with `--rcon 27500`
  When the entrypoint handles that request
  Then node is not started
  And nothing listens
  And `27500` is not forwarded to the game

Scenario A6b — Bare flag keeps the next game argument
  Given startup is requested with `--rcon` followed by `-file`
  When the entrypoint handles that request
  Then the tool is started with `--rcon` before `--`
  And `-file` is still a game argument

Scenario A7 — Bind failure does not start the game
  Given `--rcon=27500` and port 27500 is already taken
  When the tool handles that request
  Then the game process is not started

Scenario A8 — Flag stays with the tool
  Given the container is started with `--rcon=27500` among the server arguments, followed by `-file`
  When the process starts
  Then the tool enables RCON on port 27500
  And the game process arguments do not include `--rcon` or `--rcon=27500`
  And `-file` is still passed to the game

### Feature: Password is ServerAuthSecret

Scenario B1 — Exact secret
  Given `setting.xml` at the dedicated-server install root has root `SettingData` and a non-empty `ServerAuthSecret`
  When a client presents that exact text
  Then the client is authenticated

Scenario B2 — Wrong secret
  Given a non-empty `ServerAuthSecret`
  When a client presents any other text
  Then the client is not authenticated
  And the console does not receive a command from that attempt

Scenario B3 — Empty or missing secret
  Given `ServerAuthSecret` is empty, the element is absent, or the file is absent
  When a client presents an empty password or any other text
  Then the client is not authenticated
  And the console does not receive a command

Scenario B4 — Unreadable file
  Given the password file is malformed or cannot be read
  When a client presents any password, including a secret that worked on an earlier connection
  Then the client is not authenticated
  And this attempt does not reuse the older secret

Scenario B5 — Secret replaced on disk
  Given one connection authenticated with the current secret
  When the file's `ServerAuthSecret` changes
  Then the next authentication accepts the new text and rejects the previous text

Scenario B6 — Launch setting is the password
  Given a `setting.xml` fixture written the way a launch `ServerAuthSecret` setting is stored
  When the reader runs
  Then the password is that element's text
  And no live server is required

Scenario B7 — Settings path
  Given the game arguments include `-settingspath` and a following token
  When the reader runs
  Then the file path is that token, unchanged
  And the install-root `setting.xml` is not read

Scenario B7b — Settings path without a token
  Given `-settingspath` is the last game argument
  When the reader runs
  Then the read fails
  And the install-root `setting.xml` is not read

Scenario B8 — Secret stays out of logs
  Given a non-empty `ServerAuthSecret`
  When clients authenticate and fail to authenticate
  Then the tool's logs do not contain the secret

### Feature: Console reply

Scenario C1 — Command text, without the prompt
  Given an authenticated client submits `help`
  And the console echoes that line, draws `> `, clears it, writes `Tags: [launch]`, and draws a `> ` that stays
  When the reply is returned
  Then the body is `Tags: [launch]`
  And the body does not contain `help` or `>`

Scenario C2 — A cleared prompt does not end the reply
  Given the console writes `Saving`, draws `> `, clears that prompt, writes `still saving`, and draws a `> ` that stays
  When the reply is returned
  Then the body contains `Saving` and `still saving`

Scenario C3 — Lines after a stable prompt are excluded
  Given the console writes `Saving`, draws a `> ` that stays for 300ms, and one second later writes `Created new save`
  When the reply is returned
  Then the body is `Saving`
  And the body does not contain `Created new save`

Scenario C4 — No console output
  Given the console only echoes the command and draws a `> ` that stays
  When the reply is returned
  Then the body is empty
  And the client still receives a completed response

Scenario C5 — Cursor-address bytes are removed
  Given the console text is wrapped in cursor-address and color bytes, including a clear-line sequence before `> `
  When the reply is returned
  Then the body is the plain text
  And container stdout still receives the original bytes

Scenario C6 — Stdin and RCON do not share a line
  Given the wrapper has forwarded a partial stdin line with no newline
  When an authenticated client submits `help`
  Then the console does not see a line that contains both that partial text and `help`
  And `help` is submitted as its own line only after the forwarded stdin reaches a newline

Scenario C7 — One command at a time
  Given two authenticated clients each submit a command while the first reply is still open
  When both are handled
  Then the console receives the second line only after the first reply has ended

Scenario C8 — Newlines are not written
  Given an authenticated client submits a body that contains a newline
  When the server handles it
  Then execute is not called
  And the client receives one response-value packet, type `0`, with the exec request id and body `command rejected`

Scenario C9 — Timeout
  Given the console never draws a prompt that stays
  When 30s have passed since the line was written
  Then the body is `console reply timed out`
  And a second command submitted before a later stable prompt writes nothing and returns that same error
  And the next successful reply does not contain bytes from the timed-out command

### Feature: Source RCON session

Scenario D1 — Auth success shape
  Given a client sends a Source RCON auth packet with the current secret
  When the server answers
  Then the client receives an empty response-value packet and an auth-response packet, both with the request id
  And a following exec packet is accepted

Scenario D2 — Auth failure shape
  Given a client sends a Source RCON auth packet with the wrong secret
  When the server answers
  Then the auth-response id is `-1`
  And the connection stays open
  And no console command is written

Scenario D3 — Exec body
  Given an authenticated client sends an exec packet whose body is `help`
  When the console reply is `Tags: [launch]`
  Then the response-value body is `Tags: [launch]`
  And the packet id is the exec request id

Scenario D4 — Split body and end marker
  Given the console reply is longer than one 4096-byte packet
  When an authenticated client sends the exec and then an empty response-value packet
  Then the concatenated response-value bodies equal the console reply
  And the final mirrored packet is empty and uses the marker's id

Scenario D5 — Exec before auth
  Given a connection has not authenticated
  When it sends an exec packet
  Then the console receives no command
  And the connection is closed

Scenario D6 — Signals stay on the quit path
  Given RCON is enabled and an RCON line is in flight
  When the process receives SIGINT or SIGTERM
  Then the console receives that RCON line intact, then `quit` as its own line
  And the game process is not signaled directly

Scenario D7 — Empty exec
  Given an authenticated client sends an exec packet with an empty body
  When the server handles it
  Then execute is not called
  And the client receives one empty response-value packet with the exec request id

Scenario D8 — Split TCP reads
  Given an auth packet arrives in two writes, and a later read contains two full packets
  When the server reads the socket
  Then both packets are decoded
  And a truncated buffer is not treated as a successful auth

Scenario D9 — Secret is read again
  Given one connection is already authenticated
  When the next authentication is given a new secret, and a later read fails
  Then the new secret is accepted
  And the failed read authenticates nobody and does not reuse the old secret
  And an exec on the already authenticated connection still runs

## Protocol

**Pack:** four-pack

- **architect:** true
- **Chunk order:** R1, R2, R3, R4, and R5 touch disjoint files and may run in parallel. R6 depends on R4. R7 depends on R5. R8 depends on R2, R3, R6, and R7. R9 depends on R8 and edits the same handler files, so it cannot run beside R8. R10 depends on R9. The signal-hook roadmap’s handler work (T2) must not start until **R9 is approved**; its CLI chunk (T1) must not run beside **R2** (both edit `command.ts`). Do not start a chunk until every chunk it depends on is approved.
- **Where code lives:** Stationeers tool only, under `games/stationeers/`. No other game image. No new package dependency.
- **Review:** coder, then cleaner, then architect, then reviewer, for every chunk. Architect checks the Architecture lane. Reviewer approval does not grant Executable status.
- **Verification:** From the repo root, run the chunk's `pnpm exec tsx --test` paths, then `pnpm exec tsc --noEmit --pretty false`, `pnpm exec esbuild games/stationeers/tool/main.ts --bundle --platform=node --outfile=/tmp/stationeers-tool.js`, and `git diff --check`. Shell checks for R1 are in that chunk. A live Stationeers server is not required. Do not log `ServerAuthSecret` while verifying.

## Architecture lane

- The packet codec owns Source RCON bytes only. It does not read XML, spawn the game, or parse console ANSI.
- The secret reader owns `setting.xml` only. It does not open sockets or write stdin.
- The reply framer owns console bytes in and plain text out. It does not open sockets or parse RCON packets.
- The TCP server authenticates through a `readSecret` function and calls an execute function that returns the reply string. It does not import the secret reader, see game arguments, spawn the game, or read stdout itself.
- The console exchange owns "write one line, wait for the end prompt." It does not parse RCON packets or XML.
- `handler.ts` is the only place that binds the listener, taps stdout, and writes an RCON line to the console stdin. `entrypoint.sh` only moves the flag to the tool side of `--`.
- SIGINT and SIGTERM use one shutdown entry point in `handler.ts` that writes `quit\n` when no hook is configured. R9 implements that entry point and RCON-aware ordering; the signal-hook roadmap extends it when `--pre-shutdown` is set.

---

## Human gate / Executable

- [x] User sets this roadmap **Executable** (explicit approval) before implementors treat it as execute-ready. Approved by the user on 2026-11-03.

Drafts are not execute-ready until the user explicitly approves Executable. Review approval does not grant Executable status.

## Task list

### R1 — Peel `--rcon` off the game arguments

**Status:** approved

**Depends on:** none

**Files:** `games/stationeers/entrypoint.sh`, `games/stationeers/entrypoint_rcon_test.sh`

#### Implementor checklist

- [x] Move each bare `--rcon` and each `--rcon=<port>` from the container argument list to `node ~/tool.js run` before `--`. Leave every other argument after `--`, in order.
- [x] Reject the exact token `--rcon=` before starting node. A bare `--rcon` whose next argument does not start with `-` also exits non-zero before node. `--rcon -file` is port 27500 with `-file` left after `--`.
- [x] If the list contains more than one `--rcon` form, exit with a non-zero status before starting node, and print an error that does not include a password.
- [x] Keep the existing stdin redirect, SIGTERM trap, and SIGINT trap.
- [x] Prove A6, A6b, and A8 with `entrypoint_rcon_test.sh`, using a `PATH` stub for `node`. Assert the stub is not executed for `--rcon=`, for `--rcon 27500`, and for a duplicate flag.

#### Reviewer checklist

- [x] `--rcon -file` leaves `-file` as a game argument, and `--rcon 27500` does not start node.
- [x] `--rcon=` does not start node and is not turned into port 27500.
- [x] The signal traps and `0<&0` are still present.
- [x] The test does not start `rocketstation_DedicatedServer.x86_64`.

#### Agent log

<!-- implementor / reviewer append below -->

- **Coder (R1):** Peels bare `--rcon` and `--rcon=<port>` from container args into `node ~/tool.js run` before `--`; rejects exact `--rcon=`, bare `--rcon` with a non-flag next arg, and duplicate `--rcon` forms before node. Added `entrypoint_rcon_test.sh` (PATH `node` stub) for A6, A6b, A8. Verify: `bash games/stationeers/entrypoint_rcon_test.sh`, `git diff --check` (pass).
- **Reviewer (R1):** Approve. Verified entrypoint peeling/rejects, traps, and `0<&0`; `entrypoint_rcon_test.sh` covers A6/A6b/A8 with a PATH node stub only. Residual: test relies on inherited `NODE_STUB_LOG` in the stub (works in bash; export would be clearer).

---

### R2 — Parse the `--rcon` option

**Status:** approved

**Depends on:** none

**Files:** `games/stationeers/tool/command/run/command.ts`, `games/stationeers/tool/command/run/command.test.ts`

#### Implementor checklist

- [x] Add an optional `@why-ts/cli` string option `rcon`. Absent means RCON is off. An empty string is only the bare `--rcon` flag and means port 27500. Any other value must be a decimal integer from 1 through 65535 with no sign, no leading zero, and no extra characters.
- [x] Invalid values, including `01`, fail in option validation, before the run handler starts the game.
- [x] Update the run command description so it states that `--rcon` enables Source RCON and that a bare flag uses port 27500.
- [x] Unit-test absent, empty string, `27500`, `27015`, `0`, `99999`, `abc`, and `01`. Do not open a socket in this chunk. Do not treat the empty string as invalid.

#### Reviewer checklist

- [x] A1's "flag absent" state is representable, and A5's invalid values fail before the handler runs.
- [x] The option does not read `setting.xml` and does not change `--log-file`.
- [x] Validation errors do not echo a password.

#### Agent log

<!-- implementor / reviewer append below -->

- **2026-11-03 (implementor):** Added optional `--rcon` string option with `validateRconOptionValue` (empty → default port 27500 at bind time; `^[1-9]\d*$` and ≤65535). Updated run command meta/description for Source RCON. Tests in `command.test.ts` (7 cases, no sockets). Verified: `pnpm exec tsx --test games/stationeers/tool/command/run/command.test.ts`, `pnpm exec tsc --noEmit --pretty false`, esbuild bundle to `/tmp/stationeers-tool.js`, `git diff --check`.
- **Reviewer (R2):** Approve. CLI validation and tests match A1/A5; no secret/XML coupling. Residual: default port 27500 is applied at bind time in later chunks, not in this option module.

---

### R3 — Read `ServerAuthSecret` from `setting.xml`

**Status:** approved

**Depends on:** none

**Files:** `games/stationeers/tool/command/run/rcon/secret.ts`, `games/stationeers/tool/command/run/rcon/secret.test.ts`

#### Implementor checklist

- [ ] Export a reader that takes the install directory, the forwarded game arguments, and a file-read function. Default file is `<install directory>/setting.xml`. The token after `-settingspath` is the file path, used unchanged. No following token fails, and the install-root file is not read.
- [ ] Require root `SettingData` and exactly one `ServerAuthSecret` text element. Ignore the XML declaration, comments, a namespace attribute on the root, and sibling elements. Decode `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`, `&#65;`, and `&#x41;`. Do not trim. Do not add an XML package.
- [ ] Return a distinct failure for a missing file, an empty secret, a duplicated secret element, a wrong root, and a value that cannot be decoded. Do not return a previously read secret.
- [ ] Unit-test a multi-element fixture: an XML declaration, an `xmlns` attribute, a comment that contains `ServerAuthSecret`, a sibling element, and `SavePath`. Assert the secret text is returned and the path is still the install-root file. Also test B7, B7b, empty element, missing element, missing file, wrong root, and a duplicated secret element.

#### Reviewer checklist

- [x] The reader does not open a socket, spawn a process, or log the secret.
- [x] `SavePath` inside the XML does not change the file location.
- [x] Failures are fail-closed: no secret string is returned.

#### Agent log

Implementor, 2026-11-03. Added `readServerAuthSecret` / `resolveSettingXmlPath` with injectable `readFile`, install-root default, `-settingspath` override (B7/B7b), hand-rolled `SettingData` / `ServerAuthSecret` parse, entity decoding, distinct fail-closed reasons, no secret logging or caching. Commit `2877cc1`. Verification: `pnpm exec tsx --test games/stationeers/tool/command/run/rcon/secret.test.ts` (17 pass), `pnpm exec tsc --noEmit --pretty false`, `pnpm exec esbuild games/stationeers/tool/main.ts --bundle --platform=node --outfile=/tmp/stationeers-tool.js`, `git diff --check`.
- **Reviewer (R3):** Approve. Architecture lane holds (XML only, injectable I/O); tests cover B6–B7b and fail-closed paths. Residual: hand-rolled XML parser may reject unusual but valid XML shapes not covered by fixtures.

---

### R4 — Source RCON packets

**Status:** approved

**Depends on:** none

**Files:** `games/stationeers/tool/command/run/rcon/protocol.ts`, `games/stationeers/tool/command/run/rcon/protocol.test.ts`

#### Implementor checklist

- [x] Encode and decode the packet layout in Decisions. Reject a packet whose size does not match its bytes, whose body is not null-terminated, or whose full length including the size field exceeds 4096 bytes (size field at most 4092).
- [x] Split an outgoing body so every full packet is at most 4096 bytes, and strip null bytes from the body before encoding.
- [x] Unit-test auth type `3`, exec type `2`, response-value type `0`, auth-response type `2`, id `-1`, a body split across packets, and the empty end-marker packet. Do not open a socket.

#### Reviewer checklist

- [x] Size is little-endian and does not include itself.
- [x] The codec has no import from the secret reader, the framer, or `handler.ts`.
- [x] A truncated buffer does not decode as a successful auth.

#### Agent log

<!-- implementor / reviewer append below -->

**Implementor — R4 — 2026-11-03.** Added `protocol.ts` (encode/decode, split response bodies, strip nulls, `isEmptyResponseValueMarker`) and `protocol.test.ts` (16 tests: auth/exec/response/auth-response/id -1/split/end marker/truncated buffer). No imports from secret, framer, or handler. Verify: `pnpm exec tsx --test games/stationeers/tool/command/run/rcon/protocol.test.ts` (16 pass), `pnpm exec tsc --noEmit --pretty false`, `pnpm exec esbuild games/stationeers/tool/main.ts --bundle --platform=node --outfile=/tmp/stationeers-tool.js`, `git diff --check`. Commit `c763c80`.
- **Reviewer (R4):** Approve. LE size field excludes itself; codec is self-contained per architecture lane. Residual: oversized single-code-point UTF-8 bodies throw at encode time (acceptable until R6 handles errors).

---

### R5 — Decide when the console reply has ended

**Status:** approved

**Depends on:** none

**Files:** `games/stationeers/tool/command/run/rcon/framer.ts`, `games/stationeers/tool/command/run/rcon/framer.test.ts`

#### Implementor checklist

- [x] Feed stdout bytes and the submitted line in, and return plain reply text. Treat `> ` at column 0 as the prompt. `CSI <row>;1H` is column 0. A prompt is cleared by a cursor address back to column 0 or by the clear-line sequence before 300ms, and that prompt is not the end. The first prompt that stays 300ms is the end.
- [x] Drop one echoed occurrence of the submitted line, and drop the prompt. Keep every other payload line, including C2's first line. Drop ANSI cursor and color sequences from the body.
- [x] Leave bytes that arrive after the end prompt out of the body.
- [x] Unit-test C1, C2, C3, C4, and C5 with scripted byte streams and a fake clock. Include a stream shaped like `ESC[<row>;1H`, spaces, `ESC[<row>;1H`, `> `, and assert that stream is a prompt at column 0.
- [x] Do not open a socket and do not read `setting.xml`.

#### Reviewer checklist

- [x] The first `>` after the echoed command is not the end when a later line clears it.
- [x] `Created new save` arriving one second after a stable prompt is absent from the body.
- [x] The framer does not import the packet codec or the secret reader.

#### Agent log

<!-- implementor / reviewer append below -->

**Implementor — R5 — 2026-11-03.** Added `framer.ts` (`createConsoleReplyFramer`, injectable clock, 300ms stable `> ` at column 0, CSI `;1H` / clear-line prompt reset, one echo drop, ANSI stripped from body) and `framer.test.ts` (C1–C5 plus column-0 prompt stream). No socket or `setting.xml`. Verify: `pnpm exec tsx --test games/stationeers/tool/command/run/rcon/framer.test.ts` (6 pass), `pnpm exec tsc --noEmit --pretty false`, `pnpm exec esbuild games/stationeers/tool/main.ts --bundle --platform=node --outfile=/tmp/stationeers-tool.js`, `git diff --check`. Commit `bb7d16d`.
- **Reviewer (R5):** Approve. C2/C3 behavior and architecture lane verified; framer is stdout-bytes only. Residual: live console timing may differ from fake clock; integration covered in R7/R8.

---

### R6 — Accept Source RCON connections

**Status:** in_progress

**Depends on:** R4

**Files:** `games/stationeers/tool/command/run/rcon/server.ts`, `games/stationeers/tool/command/run/rcon/server.test.ts`

#### Implementor checklist

- [x] Listen on `0.0.0.0` and the given port. Take a `readSecret` function. Do not import `secret.ts` and do not read game arguments. On each auth packet, call `readSecret` again and compare the body with an exact match.
- [x] Buffer the TCP byte stream until a full packet is present. One read that contains two packets yields both. A short read is not a successful auth.
- [x] On success, send the empty response-value packet and then the auth-response packet. On failure, send auth-response id `-1`, leave the connection open, and do not call execute.
- [x] On an exec packet after auth, call `execute(body)`. Send the returned string as response-value packets with the exec id. If the client sends an empty response-value marker, mirror it after that reply.
- [x] An exec before auth calls nothing and closes the connection. A body that contains CR or LF calls nothing and returns one response-value packet, type `0`, with the exec id and body `command rejected`. An empty body calls nothing and returns one empty response-value packet with that id.
- [x] Unit-test D1, D2, D3, D4, D5, D7, D8, and D9 with a fake execute function and a fake `readSecret`. Do not spawn the game.

#### Reviewer checklist

- [ ] A wrong secret and a missing file never call execute.
- [ ] The server does not parse ANSI or write to a child process.
- [ ] Logs from these tests do not contain the secret string.

#### Agent log

<!-- implementor / reviewer append below -->

- **Coder (R6):** Added `createRconServer` in `server.ts` (TCP on `0.0.0.0`, injectable `readSecret`/`execute`, stream buffering, auth/exec/marker handling; no `secret.ts` import) and `server.test.ts` (D1–D5, D7–D9 plus newline rejection and secret-not-in-logs). Verify: `pnpm exec tsx --test games/stationeers/tool/command/run/rcon/server.test.ts` (11 pass), `pnpm exec tsc --noEmit --pretty false`, esbuild bundle to `/tmp/stationeers-tool.js`, `git diff --check`.

---

### R7 — Submit one console line and wait for the reply

**Status:** pending

**Depends on:** R5

**Files:** `games/stationeers/tool/command/run/rcon/exchange.ts`, `games/stationeers/tool/command/run/rcon/exchange.test.ts`

#### Implementor checklist

- [x] Export an exchange that writes exactly the body plus one `\n`, passes that submitted line into the R5 framer, and reads the reply from a readable stream.
- [x] Queue overlapping submits so the second write starts only after the first reply has ended.
- [x] If the end prompt does not arrive within 30s, resolve with `console reply timed out` and do not write another line until a prompt has stayed 300ms. Further submits in that window return the same error and write nothing. The next successful body excludes bytes from the timed-out command.
- [x] If the readable stream ends first, resolve with `console closed`.
- [x] Unit-test C7, C9, and the closed-stream case with a fake clock and a fake stream. Do not listen on a TCP port.

#### Reviewer checklist

- [ ] Two overlapping submits produce two writes, in order, each the command text followed by a single newline.
- [ ] A timed-out exchange does not write the second command.
- [ ] The module does not import `handler.ts` or the TCP server.

#### Agent log

<!-- implementor / reviewer append below -->

**Implementor — R7 — 2026-11-03.** Added `exchange.ts` (`createConsoleExchange`, 30s timeout, post-timeout recovery via R5 framer, serialized command pump) and `exchange.test.ts` (C7, C9, closed stream). Verify: `pnpm exec tsx --test games/stationeers/tool/command/run/rcon/exchange.test.ts` (3 pass), `pnpm exec tsc --noEmit --pretty false`, `pnpm exec esbuild games/stationeers/tool/main.ts --bundle --platform=node --outfile=/tmp/stationeers-tool.js`, `git diff --check`.

---

### R8 — Bind RCON without changing the console bytes

**Status:** pending

**Depends on:** R2, R3, R6, R7

**Files:** `games/stationeers/tool/command/run/handler.ts`, `games/stationeers/tool/command/run/handler.test.ts`

#### Implementor checklist

- [ ] When the parsed option is off, do not listen (A1), and keep the current stdin pipe, stdout tee, and signal behavior.
- [ ] When the option is on, bind the R6 server on the parsed port before spawning the game. `--rcon=27015` listens on 27015 and not on 27500 (A4). If the bind throws, do not spawn (A7).
- [ ] Supply `readSecret` by closing over the R3 reader with the install directory and the forwarded game arguments. Do not copy path rules into the TCP server.
- [ ] Tap the same stdout bytes that `forwardStdout` writes, without dropping, reordering, or holding them for the 300ms prompt timer. Stderr stays on stderr and out of the reply.
- [ ] Extend `handler.test.ts` for A1, A2's listen address, A4, A5, A7, and C5's unchanged stdout bytes, using the existing fake `stn-pty`. Do not require a live Stationeers server.

#### Reviewer checklist

- [ ] `--log-file` still receives only bytes that stdout has accepted, and still omits stderr.
- [ ] A failed bind does not spawn `stn-pty`.
- [ ] Flag absent does not listen, and port 27015 does not also listen on 27500.
- [ ] This chunk does not edit `entrypoint.sh`, `command.ts`, or the R1–R7 modules except to import them.
- [ ] Stdin arbitration and the in-flight `quit` line are left to R9.

#### Agent log

<!-- implementor / reviewer append below -->

---

### R9 — Keep stdin, RCON, and quit on separate lines

**Status:** pending

**Depends on:** R8

**Files:** `games/stationeers/tool/command/run/handler.ts`, `games/stationeers/tool/command/run/handler.test.ts`

#### Implementor checklist

- [ ] Track partial stdin lines already forwarded. Hold the parent stdin pipe while an RCON line is submitted through the R7 exchange. The child still receives the partial stdin line intact, then `help\n`, as two lines (C6).
- [ ] SIGINT or SIGTERM during an RCON submit writes `quit\n` as its own line after the in-flight RCON line (D6). Do not signal the child, and do not splice `quit` into `help`.
- [ ] Refactor signal handlers to call one shared async shutdown function (single-flight) that performs the D6 ordering and ends with `quit\n`. Export or test-hook that function so `2611031304_STATIONEERS_SIGNAL_HOOK_ROADMAP.md` T2 can wrap it after an optional pre-shutdown phase without duplicating RCON stdin holds.
- [ ] Extend `handler.test.ts` for C6 and D6 with the existing fake `stn-pty`.

#### Reviewer checklist

- [ ] The partial stdin bytes are present in the child input, not discarded.
- [ ] SIGINT during an RCON submit does not call `kill` on the child.
- [ ] Shutdown goes through console `quit\n`, not `proc.kill("SIGINT")`, matching today’s `handler.ts` comments for `stn-pty`.
- [ ] This chunk does not edit `entrypoint.sh`, `command.ts`, or the R1–R7 modules except to import them. It does not implement `--pre-shutdown` (signal-hook T2).

#### Agent log

<!-- implementor / reviewer append below -->

---

### R10 — Document the flag, the port, and the password file

**Status:** pending

**Depends on:** R9

**Files:** `games/stationeers/README.md`

#### Implementor checklist

- [ ] In the Run Server example, add an optional TCP publish and an optional `--rcon=27500`, using square brackets. Keep the existing game ports and the `MarsBase Mars2 Normal` example.
- [ ] State that `--rcon` alone uses port 27500, that the protocol is Source RCON, and that the password is `ServerAuthSecret` from `setting.xml` in the dedicated-server install directory, not a separate RCON password.
- [ ] State that `-settings ServerAuthSecret change-this-secret` is what the game writes into that file, and that `-settingspath` points the file elsewhere.
- [ ] State that the RCON reply is the console text up to the idle prompt, and that lines printed after the console is idle again are not part of that reply.
- [ ] State that default `docker stop` grace is unchanged for RCON-only setups. If operators use `--pre-shutdown`, point them at the companion README section for `--stop-timeout` / hook duration (do not duplicate the full hook doc here).
- [ ] Do not document HTTP `/console/run`, and do not put the secret in a sample log line.
- [ ] Mention that optional `--pre-shutdown` (companion roadmap) can run a script before the same console `quit` shutdown; RCON and the hook are independent features that share one console stdin writer.

#### Reviewer checklist

- [ ] Optional example parts are in square brackets, and every example value is concrete.
- [ ] The password description matches B6 and B7, including the filename `setting.xml`.
- [ ] The page does not say SIGINT sends an RCON `save`.

#### Agent log

<!-- implementor / reviewer append below -->
