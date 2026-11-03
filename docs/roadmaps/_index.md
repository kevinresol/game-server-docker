# Roadmap Queue

## Ready

- `2610232219_STATIONEERS_RCON_ROADMAP.md` — **Executable**. Source RCON server in the Stationeers tool, bridged to the working console. Replaces the removed save-on-SIGINT roadmap.
- `2611031304_STATIONEERS_SIGNAL_HOOK_ROADMAP.md` — **Executable**. Generic `--pre-shutdown` / `GAME_PRE_SHUTDOWN` hook before console `quit`; fd-3 stdin bridge. Complements RCON (not a replacement). Supersedes the removed save-on-SIGINT plan only.

## Not Ready

None.

## Blocked

None.

## Claimed-by

- `2610232219_STATIONEERS_RCON_ROADMAP.md` — queue orchestrator (execute-all-roadmaps), 2026-11-03.

## Human actions needed

None.

## Dependency sketch

- Game README consistency: complete (T1, then T2/T3/T4).
- Stationeers console shim: complete (S1–S9). RCON and the signal hook edit `handler.ts` and `command.ts` only after that shim, which is done.
- Stationeers RCON server (**Executable**): R1–R5 in parallel, then R6 after R4 and R7 after R5, then R8 after R2, R3, R6, and R7, then **R9** (shared shutdown + RCON stdin/`quit` ordering), then R10.
- Stationeers pre-shutdown hook (**Executable**): T1 after **R2** (both touch `command.ts`—do not parallelize). **T2 after R9** (extends the same shutdown entry point). T3 after T2; T4 README aligns with R10. Both features can ship together; neither supersedes the other.

## Completes

See [`_archive.md`](_archive.md).
