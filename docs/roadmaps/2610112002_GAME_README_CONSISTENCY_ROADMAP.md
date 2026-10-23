# Game Server README Consistency — Task Map

**Status:** Ready — Executable.

## Goal (locked)

Bring all seven game-specific READMEs to a consistent level of presentation and useful, accurate content: align the shared format and style, carry equivalent guidance across games wherever it applies, preserve accurate game-specific information, and add a README for Space Engineers. Add Space Engineers to the repository README catalog so its guide is discoverable.

**Out of scope:** Changing Docker images, entrypoints, runtime behavior, ports, or configuration support to make documentation match; rewriting `AGENTS.md`; documenting games outside these seven directories; copying game-specific instructions to images that do not support them.

## Decisions (locked)

- Follow the repository's `AGENTS.md` README rules: mark optional command parts and arguments with square brackets, and use concrete representative example values rather than abstract placeholders. Do not treat existing placeholder examples as precedent.
- Use a shared section order and heading hierarchy across the game READMEs: game/server title; `## Run Server`; `## Script Arguments`; supported configuration guidance; `## Volumes`. Keep configuration guidance game-specific and omit it where the image has no relevant supported behavior.
- Keep the shared sections consistent in wording, heading style, and shell code-fence style. Preserve useful game-specific links and details, adapting them rather than copying claims across images.
- Treat ports, image references, argument forwarding, config/environment-variable behavior, data paths, and save-path flags as image-specific facts. Verify each against its implementation or authoritative documentation before documenting it.
- Interpret “highest common factor” as documenting each topic in every README where the corresponding feature or guidance applies; do not add empty or unsupported sections just to make the files identical.
- Do not modify `AGENTS.md` as part of this work.

## Acceptance

### Feature: Shared presentation and examples

Scenario A1 — All game READMEs share a clear structure  
Given the six existing game-specific READMEs and the new Space Engineers README  
When a reviewer compares their structure  
Then each has a game/server title, a `## Run Server` section, a `## Script Arguments` section describing the image's actual argument behavior, and a `## Volumes` section  
And supported configuration guidance appears in a consistent position between those shared sections  
And shared headings use consistent levels, names, and order

Scenario A2 — Command examples follow project conventions  
Given a command example in any game README  
When a reviewer checks its optional segments, example values, and Markdown presentation  
Then optional command parts and arguments are marked with square brackets  
And values are concrete and representative rather than abstract placeholders  
And shell command fences and line continuations are consistently formatted

### Feature: Applicable content is complete and accurate

Scenario A3 — Applicable guidance is shared across games  
Given a topic documented in one game README, such as argument forwarding, persistent data, configuration, environment variables, setup caveats, or compose usage  
When the topic is checked against the other game images  
Then equivalent game-specific guidance is added to each README where supported  
And unsupported topics are omitted rather than copied for uniformity

Scenario A4 — Game-specific claims are evidence-based  
Given each game's README and implementation, including Dockerfiles, entrypoints, configuration handling, and relevant authoritative game documentation  
When a reviewer verifies image references, ports, arguments, volumes, configuration, startup requirements, and save paths  
Then every claim and example matches behavior supported by that game image

### Feature: Space Engineers coverage

Scenario A5 — Space Engineers has an accurate guide  
Given `games/space-engineers` currently has image implementation files but no README  
When the roadmap work is complete  
Then `games/space-engineers/README.md` follows the shared README structure and style  
And its command, persistent data, ports, and configuration guidance are verified against the image  
And it does not claim arbitrary server arguments are forwarded when the entrypoint does not forward them

Scenario A6 — The root game catalog links to Space Engineers  
Given the repository-level `README.md` catalogs game images and links to their guides  
When the Space Engineers guide is added  
Then the catalog includes a Space Engineers entry linking to that guide using the existing catalog format

## Protocol

**Pack:** two-pack

- **Chunk order:** T1 establishes a documented content/style baseline and coverage matrix. T2, T3, and T4 depend on T1 and may proceed in parallel after T1 is approved; they own disjoint files.
- **Scope boundaries:** Implementation changes are limited to the files listed under each task's Files heading. Implementors and reviewers may append status, outcome, and evidence only to that task's Agent log in this roadmap; no other roadmap edits are in scope. T1 records its topic-to-game applicability matrix and evidence summary there for dependent tasks; do not create an extra permanent matrix file.
- **Cleanup:** Keep style cleanup within each task's listed README files. Do not change image behavior or broaden into unrelated documentation.
- **Review:** Use the two-pack coder → independent reviewer sequence for each task. Reviewers check consistency against T1's matrix as well as the target files' game-specific evidence.
- **Verification:** Compare each command and behavior claim with the corresponding Dockerfile, entrypoint, configuration handling, and authoritative game documentation where needed. Check Markdown links and rendered structure, and run `git --no-pager diff --check`. No documentation-specific lint/test script is listed in `package.json`; manual content review is required. Do not build or run game images for this documentation-only task.

---

## Human gate / Executable

- [x] User explicitly approves this roadmap as **Executable** before any implementor begins work.

Drafts are not execute-ready until the user explicitly approves Executable.

## Task list

### T1 — Establish baseline and align Abiotic Factor / Don't Starve Together

**Status:** approved

**Depends on:** none

**Files:** `games/abiotic-factor/README.md`, `games/dont-starve-together/README.md`

#### Implementor checklist

- [x] Review all six existing game READMEs and the relevant implementation/configuration files for all seven games to inventory documented topics and identify which topics apply to each image.
- [x] Record a topic-to-game applicability matrix in this task's Agent log. Include evidence or a clear not-applicable reason for image references/tags, ports, argument behavior, persistent volumes/save paths, configuration/environment variables, compose guidance, startup caveats, and documentation links.
- [x] Record the shared section order, heading hierarchy, command-fence/line-continuation style, and example-value/optional-argument conventions in the Agent log for T2–T4 to follow.
- [x] Update only the two listed READMEs to match the baseline and include equivalent applicable content, verified against each image.

#### Reviewer checklist

- [x] Confirm the matrix distinguishes shared applicable topics from image-specific or unsupported behavior, with evidence for each material claim.
- [x] Confirm both READMEs follow the recorded baseline and project rules without losing accurate game-specific guidance.
- [x] Check command examples for concrete values, optional brackets, consistent Markdown, and image-specific accuracy.

#### Agent log

<!-- implementor / reviewer append below -->

#### Implementor — 2026-10-11

Status set to `in_progress`. The requested coder instruction file `/Users/kevin/.cursor/agents/coder.md` was not present, so this work followed the repository `AGENTS.md` and the locked roadmap decisions.

Baseline for T2–T4:

- Every guide uses `# Game/Server title`, then `## Run Server`, `## Script Arguments`, supported `## Configuration` guidance when applicable, and `## Volumes`.
- Use `sh` fences for shell commands, one command component per continued line, and a trailing `\` on every continued line. Keep optional command components and arguments in square brackets.
- Use concrete examples (`:latest`, numeric ports, representative server names/passwords/IDs) rather than `<value>` or `<tagname>` placeholders. Explain Docker Compose as the equivalent `command`/`volumes` configuration when the image supports the same behavior.
- Keep game links in the relevant guide; link text should describe the destination. Do not add configuration sections for unsupported behavior.

Applicability matrix and evidence:

| Topic | Abiotic Factor | Don't Starve Together | Project Zomboid | Satisfactory | Stationeers | Valheim | Space Engineers |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Image reference/tag | `kevinresol/abiotic-factor-dedicated-server:latest`; existing guide had the repository name and an abstract tag placeholder. | `kevinresol/dont-starve-together-dedicated-server:latest`; existing guide had the repository name and an abstract tag placeholder. | `kevinresol/project-zomboid-dedicated-server`; existing README is the source for the published repository name; tag convention needs cleanup in T2. | `kevinresol/satisfactory-factor-dedicated-server`; existing README is the source for the published repository name; tag convention needs cleanup in T2. | `kevinresol/stationeers-dedicated-server`; existing README is the source for the published repository name; tag convention needs cleanup in T3. | `kevinresol/valheim-dedicated-server`; existing README is the source for the published repository name; tag convention needs cleanup in T3. | No README or published image reference established; T4 must verify from repository/image metadata. |
| Ports | README and existing example: `7777/udp`, `27015/udp`; no port rewriting in `entrypoint.sh`, which directly starts the executable. | Templates define `Master` `11000/udp`, `Caves` `11001/udp`, Steam master ports `27018/udp` and `27019/udp`, and authentication ports `8768/udp` and `8769/udp`; `entrypoint.sh` runs the wrapper without changing them. The old `10999` example was not supported by the checked-in templates. | Existing README documents `16261/udp`, `16262/udp`, optional `27015/tcp`; T2 must verify against startup/config behavior. | Existing README documents `7777/udp`, `27015/udp`; T2 must verify against image behavior. | Existing README documents `7777/udp`, `27015/udp`; T3 must verify against implementation/authoritative docs. | Existing README documents `2456/udp`, `2457/udp`; Dockerfile sets `SteamAppId` and entrypoint starts the server; T3 must verify any additional port guidance. | No README; T4 must inspect implementation and authoritative docs. |
| Argument behavior | `entrypoint.sh` invokes `AbioticFactorServer-Win64-Shipping.exe "$@"`; arbitrary Docker arguments are forwarded. | `entrypoint.sh` invokes `tool.js run`; `run/handler.ts` constructs fixed Master/Caves arguments and does not append arbitrary game arguments. Document non-forwarding and use supported environment/config options. | `entrypoint.sh` invokes `start-server.sh ... "$@"`; arbitrary arguments are forwarded. | `entrypoint.sh` invokes `FactoryServer.sh "$@"`; arbitrary arguments are forwarded. | `entrypoint.sh` invokes `tool.js run -- "$@"`; wrapper behavior must remain verified by T3. | `entrypoint.sh` invokes `valheim_server.x86_64 -savedir ... "$@"`; arbitrary arguments are forwarded. | `entrypoint.sh` invokes the executable with fixed arguments and no `"$@"`; T4 must explicitly document non-forwarding. |
| Persistent volume/save path | Dockerfile sets `GAME_DATA_PATH=/data` and symlinks `AbioticFactor/Saved` to it; `/data` is the persistent save path. | Dockerfile sets `GAME_DATA_PATH=/data`; wrapper passes it as `-persistent_storage_root`; cluster files and saves live under `/data/<conf-dir>/<cluster>`. | Dockerfile sets `GAME_DATA_PATH=/data`; entrypoint passes `-cachedir=/data`; T2 must preserve the existing save/config distinction. | Dockerfile symlinks both game Saved locations to `/data`; existing `/data` mount is applicable. | Dockerfile symlinks the game `saves` directory to `/data`; existing `/data` mount is applicable. | Entrypoint passes `/data` as `-savedir`; existing `/data` mount is applicable. | Dockerfile sets `GAME_DATA_PATH=/data`; entrypoint starts Wine with `-path Z:\\data`; T4 must verify the host mount and save layout. |
| Configuration/environment variables | No helper/config tool or supported configuration environment variables; only `GAME_BIN_PATH`/`GAME_DATA_PATH` are internal Dockerfile variables. | `DST_CLUSTER_*` updates `cluster.ini`; `GAME_CLUSTER_TOKEN` creates the required token; `DST_MOD_IDS` generates mod setup; `GAME_CONF_DIR`/`GAME_CLUSTER` select wrapper paths. Config templates are under `config/`. | `PZ_*` updates config via the helper; `SERVER_NAME` selects the server name; T2 must verify documented defaults and `GAME_DATA_PATH`. | No helper/config environment support found; configuration is performed through the in-game Server Manager as the existing README states. | No config environment support found in inspected tool/entrypoint; T3 must verify any game-side config guidance. | No config environment support found in inspected Dockerfile/entrypoint/tool. | No helper/config environment support found in inspected Dockerfile/entrypoint/tool; T4 must verify. |
| Compose guidance | Applicable: Compose `command` forwards optional server args and `volumes` maps a host directory to `/data`. | Applicable for environment variables and `volumes`; arbitrary game args must not be described as forwarded. | Applicable: existing README's `command`/`volumes` guidance matches entrypoint behavior; T2 to align wording. | Applicable for `command`/`volumes`; T2 to align wording. | Applicable for `command`/`volumes`; T3 to align wording. | Applicable for `command`/`volumes`; T3 to align wording. | T4 to add only after implementation verification. |
| Startup caveats | None beyond persistent `/data`; Windows server runs through Wine in `entrypoint.sh`. | First run requires `GAME_CLUSTER_TOKEN`; wrapper copies missing `cluster.ini`/shard templates, starts both shards, and handles SIGTERM. Mods require enabling generated setup in shard `modoverrides.lua`. | Existing README notes first-run admin password requirement; T2 must verify. | Existing README directs initial setup through in-game Server Manager. | Wrapper manages a child process and signal handling; T3 must verify any setup caveats. | No additional startup caveat found in entrypoint. | Fixed Wine startup flags and no argument forwarding; T4 must document verified caveats. |
| Documentation links | Existing Abiotic Factor dedicated-server quickstart link retained and renamed descriptively. | Existing dedicated-server guide retained; mod handler points to Klei's forum guide, which should be considered if T4 needs mod-link wording. | Existing startup-parameter link retained for T2 verification. | Existing dedicated-server link retained for T2 verification. | Existing dedicated-server guide retained for T3 verification. | Existing dedicated-server links retained for T3 verification. | T4 must add an authoritative link after verification. |

Evidence reviewed:

- All six existing game READMEs.
- `Dockerfile` and `entrypoint.sh` for all seven game directories.
- Wrapper/tool sources for all seven directories, including DST `config`, `run`, and `mod` commands.
- DST templates `config/cluster.ini`, `config/Master/server.ini`, and `config/Caves/server.ini`.
- Commands: `git status --short`; `git --no-pager diff --check`; repository searches for DST port/token/mod identifiers.
- No image builds or game-server runs were performed, per the roadmap protocol.

T1 changes are limited to `games/abiotic-factor/README.md`, `games/dont-starve-together/README.md`, and this T1 log/status. Independent review should check the matrix against the target READMEs and confirm the DST port/config assumptions before approval.

#### Reviewer — 2026-10-11

Verdict: revise

Findings:

- Issue: `games/abiotic-factor/README.md` uses `[-SteamServerName=Abiotic Example]` in the `docker run` example. Risk: after applying the documented optional-argument convention, the unquoted space splits the server-name value into separate shell arguments, so the concrete command example is invalid or misroutes the value. Expected change: use a shell-safe concrete value such as `[-SteamServerName=AbioticExample]`, or quote the value while retaining the repository's optional-argument notation.

Verification:

- Independently checked all seven matrix columns against the seven image Dockerfiles and entrypoints, the DST templates, and the available DST tool sources. The matrix correctly distinguishes forwarded arguments from fixed-wrapper behavior, `/data` persistence, DST configuration variables, and unsupported configuration claims.
- Confirmed the DST template ports (`11000`, `11001`, `27018`, `27019`, `8768`, `8769`) and that its wrapper does not append arbitrary Docker arguments to the game processes.
- Confirmed both target README structures, image references, `/data` mounts, and argument/configuration claims. The Abiotic example issue above prevents full checklist approval.
- `git diff --check` passes. No product files were edited and no commit was created.

#### Implementor — revise 1 — 2026-10-23

Addressed the reviewer's single finding. In `games/abiotic-factor/README.md`, changed `[-SteamServerName=Abiotic Example]` to `[-SteamServerName=AbioticExample]`. The value is now a single shell word and keeps the optional-bracket convention.

Re-scanned both T1 READMEs for unquoted spaces in values, abstract placeholders, missing line-continuation backslashes, and inconsistent fences. Found no other instances and made no other changes. Both files still match the recorded T1 baseline.

Verification: `git --no-pager diff --check` is clean. Files edited: `games/abiotic-factor/README.md` only. No image builds or runs.

Residual notes (out of scope): the trailing `[...]` line in the Abiotic example and unquoted `$(pwd)` volume paths in both examples.

#### Reviewer — attempt 2 — 2026-10-23

Verdict: approve

Findings: none critical/important. The prior finding is resolved: Abiotic's `[-SteamServerName=AbioticExample]` is now a single shell word and keeps the optional-bracket convention. No other unquoted-space values, abstract placeholders, missing `\` continuations, or fence inconsistencies in either README.

Verification: Spot-checked both READMEs against `games/abiotic-factor` and `games/dont-starve-together` Dockerfiles, entrypoints, config templates and tool sources.
- Abiotic: `"$@"` forwarded to the Wine-launched executable; `/data` is symlinked to `AbioticFactor/Saved`; ports 7777/udp and 27015/udp match the upstream quickstart's `-PORT`/`-QueryPort` values.
- DST: ports 11000/11001, 27018/27019, 8768/8769 match templates; run args are fixed (no arbitrary game-arg forwarding); `GAME_CLUSTER_TOKEN` is written to `/data/DoNotStarveTogether/Cluster_1/cluster_token.txt` only if missing; `DST_CLUSTER_` `__` -> `.` mapping, `DST_MOD_IDS`, `GAME_CONF_DIR`/`GAME_CLUSTER` defaults, and `-persistent_storage_root` = `/data` all confirmed.
- `git --no-pager diff --check` is clean.

Residual risks (non-blocking):
- `-tcp` in the Abiotic example is retained from the original README; the linked quickstart does not document it and only UDP ports are published, so TCP-port need is unverified.
- Unquoted `$(pwd)` in `-v` in both examples.
- DST example omits an optional `DST_MOD_IDS` / Compose `environment` mention.

Orchestrator: Pack two-pack (coder -> reviewer), end-qa skipped (not six-pack, no `end-qa: true`, no user request). T1 approved; committed locally with the two READMEs. T2/T3/T4 now eligible and run in parallel worktrees.

---

### T2 — Align Project Zomboid / Satisfactory

**Status:** approved

**Depends on:** T1

**Files:** `games/project-zomboid/README.md`, `games/satisfactory/README.md`

#### Implementor checklist

- [x] Apply T1's recorded structure and style baseline to both READMEs.
- [x] Use T1's applicability matrix, verifying relevant implementation details for both images, to add equivalent guidance wherever supported without copying unrelated settings or behavior.
- [x] Replace abstract example placeholders with concrete representative values and correct inconsistent heading levels, command formatting, and shell line continuations.

#### Reviewer checklist

- [x] Confirm both READMEs match the approved baseline and include equivalent content for supported topics.
- [x] Verify ports, argument forwarding, config/environment-variable behavior, volume/save paths, and startup notes against the corresponding image.
- [x] Confirm no unsupported behavior was introduced and useful game-specific information remains.

#### Agent log

**Implementor — T2 — 2026-10-23.** Worktree `roadmap/readme-consistency/T2`. Both guides follow the T1 section order and `sh` fence style. Project Zomboid documents forwarded arguments, `PZ_` config, `/data` as `-cachedir`, and UDP 16261/16262. Satisfactory uses `kevinresol/satisfactory-dedicated-server:latest`, forwards arguments to `FactoryServer.sh`, and documents 7777 UDP and TCP plus 8888/tcp. `git diff --check` was clean. No image run.

#### Reviewer — T2 — 2026-10-23

Verdict: approve. No critical or important findings. Ports, argument forwarding, config, and save paths match the image sources. Residual: the Satisfactory `-Port` sentence blends roles the wiki splits, but the example publishes the correct three ports. Optional RCON `27015/tcp` is the bundled `RCONPort` without a stated protocol. Unquoted `$(pwd)` matches the approved T1 examples.

---

### T3 — Align Stationeers / Valheim

**Status:** pending

**Depends on:** T1

**Files:** `games/stationeers/README.md`, `games/valheim/README.md`

#### Implementor checklist

- [ ] Apply T1's recorded structure and style baseline to both READMEs.
- [ ] Use T1's applicability matrix, verifying relevant implementation details for both images, to add equivalent guidance wherever supported without copying unrelated settings or behavior.
- [ ] Replace abstract example placeholders with concrete representative values and correct inconsistent command formatting and shell line continuations.

#### Reviewer checklist

- [ ] Confirm both READMEs match the approved baseline and include equivalent content for supported topics.
- [ ] Verify ports, argument forwarding, config/environment-variable behavior, volume/save paths, and startup notes against the corresponding image.
- [ ] Confirm no unsupported behavior was introduced and useful game-specific information remains.

#### Agent log

<!-- implementor / reviewer append below -->

---

### T4 — Add Space Engineers guide and catalog entry

**Status:** pending

**Depends on:** T1

**Files:** `games/space-engineers/README.md`, `README.md`

#### Implementor checklist

- [ ] Create `games/space-engineers/README.md` using T1's shared structure and style baseline.
- [ ] Verify Space Engineers image references, ports, data mount/path behavior, startup arguments, and supported configuration against its Dockerfiles and entrypoint; document that arbitrary arguments are not forwarded if confirmed by the implementation.
- [ ] Use concrete representative examples, mark optional parts with square brackets, and include only supported game-specific guidance.
- [ ] Add a Space Engineers entry to the root README catalog using its existing format and a verified link to the game README.

#### Reviewer checklist

- [ ] Confirm the new guide follows the shared baseline and accurately represents Space Engineers behavior, especially the entrypoint's argument handling and persistent data path.
- [ ] Confirm the root catalog entry matches the existing list style and links to the new guide.
- [ ] Confirm no other files or runtime behavior changed.

#### Agent log

<!-- implementor / reviewer append below -->
