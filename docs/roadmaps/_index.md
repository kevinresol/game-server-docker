# Roadmap Queue

## Ready

- `2610232219_STATIONEERS_RCON_ROADMAP.md` — **Executable**. Source RCON server in the Stationeers tool, bridged to the working console. Replaces the removed save-on-SIGINT roadmap.

## Not Ready

None.

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

## Completes

See [`_archive.md`](_archive.md).
