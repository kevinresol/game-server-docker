# Roadmap Queue

## Ready

- `2610112002_GAME_README_CONSISTENCY_ROADMAP.md` — Executable; T1 approved; T2/T3/T4 in progress
- `2610230021_STATIONEERS_CONSOLE_SHIM_ROADMAP.md` — Executable; S1 approved; F1 confirmed at 15 percentage points; S2/S3/S5 in progress

## Not Ready

- `2610112023_STATIONEERS_RCON_SAVE_ON_SIGINT_ROADMAP.md` — **parked** by the user in favor of the console shim roadmap (its HTTP RCON premise is contradicted by `stn-diag/20261022T113113Z/DECOMPILE.md`); T1 is not to be executed; not Executable until the user revives it

## Blocked

None.

## Claimed-by

- `2610112002_GAME_README_CONSISTENCY_ROADMAP.md` — execute-all-roadmaps orchestrator (2026-10-23)
- `2610230021_STATIONEERS_CONSOLE_SHIM_ROADMAP.md` — execute-all-roadmaps orchestrator (2026-10-23); `games/stationeers/README.md` overlap with README roadmap T3: S8 must run after T3 is approved

## Human actions needed

None. F1 CPU threshold for `2610230021_STATIONEERS_CONSOLE_SHIM_ROADMAP.md` was confirmed at 15 percentage points on 2026-10-23.

## Dependency sketch

- Game README consistency: T1 → T2/T3/T4 in parallel.
- Stationeers RCON save (parked): T1 → user contract confirmation → T2 → T3/T4 in parallel.
- Stationeers console shim: S1 → S2/S3/S5 in parallel; S2+S3 → S4; S5 → S6; S4+S5+S6 → S7 → S8. Shares `games/stationeers/tool/command/run/handler.ts` with the parked RCON roadmap (T3): if revived, run it only after this roadmap completes.

## Completes

See [`_archive.md`](_archive.md).
