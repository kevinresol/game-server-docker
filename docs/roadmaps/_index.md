# Roadmap Queue

## Ready

- `2610230021_STATIONEERS_CONSOLE_SHIM_ROADMAP.md` — Executable; S5 revise approved. S7 re-runs live acceptance. D1 uses a 15s stop timeout because this daemon's default grace is about 3s.

## Not Ready

- `2610112023_STATIONEERS_RCON_SAVE_ON_SIGINT_ROADMAP.md` — **parked** by the user in favor of the console shim roadmap (its HTTP RCON premise is contradicted by `stn-diag/20261022T113113Z/DECOMPILE.md`); T1 is not to be executed; not Executable until the user revives it

## Blocked

None.

## Claimed-by

- `2610230021_STATIONEERS_CONSOLE_SHIM_ROADMAP.md` — execute-all-roadmaps orchestrator (2026-10-23). S5 revise is approved. S7 re-runs live acceptance.

## Human actions needed

None. On 2026-10-23 the user chose the stdin byte cache in `libkernel32-shim.so` for `2610230021_STATIONEERS_CONSOLE_SHIM_ROADMAP.md`. F1 remains 15 percentage points above the old direct-spawn idle CPU.

## Dependency sketch

- Game README consistency: complete (T1, then T2/T3/T4). Stationeers README from T3 documents the current helper; console-shim S8 may replace that section after S7.
- Stationeers RCON save (parked): T1 → user contract confirmation → T2 → T3/T4 in parallel.
- Stationeers console shim: S1 → S2/S3/S5 in parallel; S2+S3 → S4; S5 → S6; S4+S5+S6 → S7 evidence; S9 (stdin byte cache) → S7 re-run → S8. Shares `games/stationeers/tool/command/run/handler.ts` with the parked RCON roadmap (T3): if revived, run it only after this roadmap completes.

## Completes

See [`_archive.md`](_archive.md).
