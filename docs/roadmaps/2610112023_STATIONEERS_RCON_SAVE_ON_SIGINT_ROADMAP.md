# Stationeers RCON Save Before SIGINT — Task Map

**Status:** Draft — not Executable.

## Goal (locked)

When the Node.js Stationeers runner receives SIGINT, it must prevent the server process from receiving that signal prematurely, request a Stationeers save through RCON, and then explicitly forward SIGINT to the server. This protects the world save during an orderly stop while retaining a bounded shutdown path if RCON cannot complete.

**Out of scope:** Changing Stationeers server behavior beyond the requested shutdown flow; changing the existing SIGTERM-to-SIGINT behavior; adding support for other games; introducing a third-party RCON dependency; changing unrelated startup, logging, or save configuration.

## Decisions (locked)

- The RCON command requested by the user is the literal `save`, with no filename argument. Do not silently substitute another command. If the supported Stationeers version requires a save filename, stop and ask the user before proceeding with a different command.
- The new save-before-forward behavior is for SIGINT only. Preserve the existing SIGTERM behavior.
- RCON errors must not leave the server indefinitely running without the forwarded signal. Use a bounded attempt and then forward SIGINT; settle the timeout and error-reporting behavior in T1.
- Stationeers RCON is not Source RCON. Prior research found an HTTP console endpoint at `/console/run` with a login/session-cookie flow; T1 must verify this contract and its settings against the supported server version before implementation.
- RCON host, port, and credential configuration are not yet established for this image. T1 must propose a concrete configuration contract; it remains provisional until the user reviews T1's findings and confirms them before T2–T4.

## Acceptance

### Feature: Save the Stationeers world before forwarding SIGINT

Scenario A1 — Save request precedes the forwarded signal
Given the Stationeers server is running and its RCON endpoint is reachable with valid credentials
When the Node.js runner receives SIGINT
Then it sends the literal RCON command `save`
And it forwards SIGINT to the server only after the RCON request has completed

Scenario A2 — Terminal Ctrl+C cannot signal the server prematurely
Given the runner and Stationeers server are running in a terminal process group
When the operator presses Ctrl+C
Then the server does not receive the terminal's SIGINT before the runner completes its RCON save attempt
And the runner explicitly forwards SIGINT after that attempt

Scenario A3 — RCON failure does not prevent shutdown
Given the runner receives SIGINT and the RCON request fails or reaches its configured timeout
When the save attempt ends
Then the runner reports the failure
And the runner forwards SIGINT to the server without waiting indefinitely

Scenario A4 — SIGTERM behavior remains unchanged
Given the runner receives SIGTERM
When the existing signal handler forwards SIGINT to Stationeers
Then no new RCON save attempt is made
And the server receives the same forwarded signal behavior as before this work

Scenario A5 — RCON configuration is usable and documented
Given a user configures the documented RCON settings for the Stationeers image
When the runner handles SIGINT
Then it connects to the configured endpoint and authenticates without exposing the password in logs
And the README accurately describes required and optional settings

## Protocol

**Pack:** two-pack

- **Chunk order:** T1 verifies and records the RCON/command/configuration contract. T2 depends on T1 and implements the RCON client and its unit tests. After T2 is approved, T3 (signal integration and ordering tests) and T4 (README guidance) may run in parallel because they own disjoint files.
- **Scope boundaries:** Each implementor may change only the files listed for that task and append task evidence to that task's Agent log below. A blocker discovered in T1 must be reported for user clarification; it must not be resolved by changing the requested `save` command without approval.
- **Review:** Use coder → independent reviewer for each task. Reviewers check the task checklist, the locked decisions, and the end-to-end ordering guarantee; review approval does not grant Executable status.
- **Verification:** Run the focused tests with `pnpm exec tsx --test games/stationeers/tool/command/run/rcon.test.ts games/stationeers/tool/command/run/handler.test.ts`, type-check with `pnpm exec tsc --noEmit --pretty false`, bundle the Stationeers tool with `pnpm exec esbuild games/stationeers/tool/main.ts --bundle --platform=node --outfile=/tmp/stationeers-tool.js`, and run `git diff --check`. A live-server test is optional when no Stationeers server is available; mocked tests must verify request and signal ordering.

---

## Human gate / Executable

- [ ] User explicitly approves this roadmap as **Executable** before any implementor begins work.

Drafts are not execute-ready until the user explicitly approves Executable. That approval authorizes T1's research-only work; it does not authorize implementation. T2–T4 remain blocked until the user reviews T1's evidence and explicitly confirms the RCON settings contract, failure-timeout policy, and that the literal `save` command is supported. If a filename is required, the user must choose how it is supplied before implementation proceeds.

## Task list

### T1 — Verify Stationeers RCON and save-command contract

**Status:** pending

**Depends on:** none

**Files:** `docs/roadmaps/2610112023_STATIONEERS_RCON_SAVE_ON_SIGINT_ROADMAP.md` (T1 Agent log only)

#### Implementor checklist

- [ ] Verify the Stationeers RCON HTTP endpoint, authentication/session behavior, and applicable default port against current authoritative Stationeers documentation or source.
- [ ] Verify whether the supported server accepts the literal `save` command without a filename. Record evidence; if a filename is required, mark T2–T4 blocked and request user direction rather than inventing a value.
- [ ] Propose the image's RCON host/port/password configuration convention, including which value is required, safe defaults, timeout bound, and behavior when authentication or save fails.
- [ ] Record any uncertainty or unavailable live-server checks explicitly. Do not claim an end-to-end save has been validated without running it against Stationeers.

#### Reviewer checklist

- [ ] Confirm RCON and save-command claims are supported by authoritative evidence and apply to the image's server version.
- [ ] Confirm the proposed configuration and bounded-failure behavior do not leak credentials or prevent shutdown indefinitely.
- [ ] Confirm no implementation or change to the literal `save` command is hidden in this research task.

#### Agent log

<!-- implementor / reviewer append below -->

---

### T2 — Implement and test the Stationeers RCON request client

**Status:** pending

**Depends on:** T1 approved and the user's explicit confirmation of its RCON contract, timeout policy, and save-command findings

**Files:** `games/stationeers/tool/command/run/rcon.ts`, `games/stationeers/tool/command/run/rcon.test.ts`

#### Implementor checklist

- [ ] Add a focused Stationeers-specific HTTP RCON client using the T1-approved endpoint, authentication, and configuration contract; do not use Source RCON framing.
- [ ] Support sending the literal `save` command with the authenticated session and expose completion/failure to the caller without logging the password.
- [ ] Bound network waits according to the T1-approved timeout and return actionable errors for connection, authentication, HTTP, and timeout failures.
- [ ] Add focused tests using a local mock HTTP server for login/session-cookie handling, command encoding, save request, and failed/timeout requests.
- [ ] Add no third-party runtime dependency.

#### Reviewer checklist

- [ ] Confirm requests use the Stationeers-specific HTTP contract and preserve the authenticated session between login and command.
- [ ] Confirm test evidence covers successful and failed requests and that credentials are not logged.
- [ ] Confirm timeout and failure results allow the caller to continue shutdown safely.

#### Agent log

<!-- implementor / reviewer append below -->

---

### T3 — Intercept SIGINT, save, and then forward it

**Status:** pending

**Depends on:** T2 approved and the user's confirmation gate above satisfied

**Files:** `games/stationeers/tool/command/run/handler.ts`, `games/stationeers/tool/command/run/command.ts`, `games/stationeers/tool/command/run/handler.test.ts`

#### Implementor checklist

- [ ] Ensure the server process cannot receive the terminal's group-delivered SIGINT before Node completes the RCON attempt; explicitly forward SIGINT to the server afterward.
- [ ] On Node-level SIGINT, invoke the T2 RCON client with the literal `save` command and forward SIGINT only after the RCON request completes or fails within its bound.
- [ ] Log the signal/save outcome without exposing credentials, and prevent duplicate signals from starting multiple concurrent save attempts.
- [ ] Preserve existing SIGTERM-to-SIGINT behavior and do not add an RCON save to SIGTERM.
- [ ] Update the run command description to describe the SIGINT/RCON save behavior accurately.
- [ ] Add tests with a mock RCON endpoint and fake server process that prove save-request-before-signal ordering, terminal-signal isolation, bounded failure forwarding, and unchanged SIGTERM behavior.

#### Reviewer checklist

- [ ] Verify both direct Node SIGINT and terminal Ctrl+C follow the required ordering; a normal process-group signal must not bypass the save.
- [ ] Verify the server receives exactly one forwarded SIGINT after a successful save or bounded RCON failure.
- [ ] Verify SIGTERM behavior remains unchanged and tests do not rely solely on source-text assertions.

#### Agent log

<!-- implementor / reviewer append below -->

---

### T4 — Document the Stationeers RCON shutdown configuration

**Status:** pending

**Depends on:** T2 approved and the user's confirmation gate above satisfied

**Files:** `games/stationeers/README.md`

#### Implementor checklist

- [ ] Document the T1-approved RCON environment/configuration settings, required credential setup, defaults, and timeout/failure behavior that users need to understand.
- [ ] Explain that the runner sends `save` through Stationeers RCON before forwarding SIGINT, and distinguish this from the existing SIGTERM behavior.
- [ ] Keep ports and configuration claims specific to Stationeers and follow the project README rules for concrete examples and optional arguments.

#### Reviewer checklist

- [ ] Verify documented settings, defaults, ports, and save behavior against the implementation and T1 evidence.
- [ ] Check README examples use concrete representative values and do not expose a real secret or introduce unsupported server settings.

#### Agent log

<!-- implementor / reviewer append below -->
