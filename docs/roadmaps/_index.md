# Roadmap Queue

## Ready

- `2610232219_STATIONEERS_RCON_ROADMAP.md` — **Executable**. Source RCON server in the Stationeers tool, bridged to the working console. Replaces the removed save-on-SIGINT roadmap.

## Not Ready

- `2611031304_STATIONEERS_SIGNAL_HOOK_ROADMAP.md` — **Draft**. Generic `--pre-shutdown` / `GAME_PRE_SHUTDOWN` hook before server SIGINT; fd-3 stdin bridge. Supersedes the removed save-on-SIGINT plan (do not implement built-in HTTP RCON save).

## Blocked

None.

## Claimed-by

None.

## Human actions needed

None.

## Dependency sketch

- Game README consistency: complete (T1, then T2/T3/T4).
- Stationeers console shim: complete (S1–S9). The new RCON roadmap edits `handler.ts` and `command.ts` only after that shim, which is done.
- Stationeers RCON server: R1–R5 in parallel, then R6 after R4 and R7 after R5, then R8 after R2, R3, R6, and R7, then R9, then R10.
- Stationeers pre-shutdown hook (draft): not Executable; both it and the RCON roadmap edit `handler.ts` — sequence when one is approved for execution.

## Completes

See [`_archive.md`](_archive.md).
