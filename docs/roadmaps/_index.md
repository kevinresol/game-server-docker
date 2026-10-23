# Roadmap Queue

## Ready

None.

## Not Ready

- `2610112023_STATIONEERS_RCON_SAVE_ON_SIGINT_ROADMAP.md` — **parked** by the user in favor of the console shim roadmap (its HTTP RCON premise is contradicted by `stn-diag/20261022T113113Z/DECOMPILE.md`); T1 is not to be executed; not Executable until the user revives it

## Blocked

- `2610230021_STATIONEERS_CONSOLE_SHIM_ROADMAP.md` — S7 blocked on B1 (2026-10-23). One write of `save stnshim1` plus a newline does not reach the game. The same line sent one byte at a time creates the save. Owner S3. S8 waits on S7.

## Claimed-by

None. The console-shim claim was cleared when S7 was parked.

## Human actions needed

- Opened 2026-10-23. Roadmap `2610230021_STATIONEERS_CONSOLE_SHIM_ROADMAP.md`, residual S7 B1 / S3 pacing. Action: choose whether to reopen S3 so a whole stdin line reaches the game, or change B1 and keep the no-pacing contract. Unblocks S7 and then S8. Requested by the execute-all-roadmaps orchestrator.

## Dependency sketch

- Game README consistency: complete (T1, then T2/T3/T4). Stationeers README from T3 documents the current helper; console-shim S8 may replace that section after S7.
- Stationeers RCON save (parked): T1 → user contract confirmation → T2 → T3/T4 in parallel.
- Stationeers console shim: S1 → S2/S3/S5 in parallel; S2+S3 → S4; S5 → S6; S4+S5+S6 → S7 → S8. Shares `games/stationeers/tool/command/run/handler.ts` with the parked RCON roadmap (T3): if revived, run it only after this roadmap completes.

## Completes

See [`_archive.md`](_archive.md).
