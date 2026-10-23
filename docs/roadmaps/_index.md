# Roadmap Queue

## Ready

- `2610230021_STATIONEERS_CONSOLE_SHIM_ROADMAP.md` — Executable; S1 through S6 approved; F1 confirmed at 15 percentage points; S7 next

## Not Ready

- `2610112023_STATIONEERS_RCON_SAVE_ON_SIGINT_ROADMAP.md` — **parked** by the user in favor of the console shim roadmap (its HTTP RCON premise is contradicted by `stn-diag/20261022T113113Z/DECOMPILE.md`); T1 is not to be executed; not Executable until the user revives it

## Blocked

None.

## Claimed-by

- `2610230021_STATIONEERS_CONSOLE_SHIM_ROADMAP.md` — execute-all-roadmaps orchestrator (2026-10-23). README roadmap T3 is complete, so S8 is no longer waiting on that Stationeers README edit.

## Human actions needed

None. F1 CPU threshold for `2610230021_STATIONEERS_CONSOLE_SHIM_ROADMAP.md` was confirmed at 15 percentage points on 2026-10-23.

## Dependency sketch

- Game README consistency: complete (T1, then T2/T3/T4). Stationeers README from T3 documents the current helper; console-shim S8 may replace that section after S7.
- Stationeers RCON save (parked): T1 → user contract confirmation → T2 → T3/T4 in parallel.
- Stationeers console shim: S1 → S2/S3/S5 in parallel; S2+S3 → S4; S5 → S6; S4+S5+S6 → S7 → S8. Shares `games/stationeers/tool/command/run/handler.ts` with the parked RCON roadmap (T3): if revived, run it only after this roadmap completes.

## Completes

See [`_archive.md`](_archive.md).
