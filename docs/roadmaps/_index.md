# Roadmap Queue

## Ready

None.

## Not Ready

- `2610112023_STATIONEERS_RCON_SAVE_ON_SIGINT_ROADMAP.md` — **parked** by the user in favor of the console shim roadmap (its HTTP RCON premise is contradicted by `stn-diag/20261022T113113Z/DECOMPILE.md`); T1 is not to be executed; not Executable until the user revives it

## Blocked

None.

## Claimed-by

None.

## Human actions needed

None.

## Dependency sketch

- Game README consistency: complete (T1, then T2/T3/T4).
- Stationeers RCON save (parked): T1 → user contract confirmation → T2 → T3/T4 in parallel. Shares `games/stationeers/tool/command/run/handler.ts` with the completed console shim: run it only after that shim, which is now complete.
- Stationeers console shim: complete (S1–S9).

## Completes

See [`_archive.md`](_archive.md).
