# Game Server README Consistency — Task Map

**Status:** Draft — not Executable.

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

- [ ] User explicitly approves this roadmap as **Executable** before any implementor begins work.

Drafts are not execute-ready until the user explicitly approves Executable.

## Task list

### T1 — Establish baseline and align Abiotic Factor / Don't Starve Together

**Status:** pending

**Depends on:** none

**Files:** `games/abiotic-factor/README.md`, `games/dont-starve-together/README.md`

#### Implementor checklist

- [ ] Review all six existing game READMEs and the relevant implementation/configuration files for all seven games to inventory documented topics and identify which topics apply to each image.
- [ ] Record a topic-to-game applicability matrix in this task's Agent log. Include evidence or a clear not-applicable reason for image references/tags, ports, argument behavior, persistent volumes/save paths, configuration/environment variables, compose guidance, startup caveats, and documentation links.
- [ ] Record the shared section order, heading hierarchy, command-fence/line-continuation style, and example-value/optional-argument conventions in the Agent log for T2–T4 to follow.
- [ ] Update only the two listed READMEs to match the baseline and include equivalent applicable content, verified against each image.

#### Reviewer checklist

- [ ] Confirm the matrix distinguishes shared applicable topics from image-specific or unsupported behavior, with evidence for each material claim.
- [ ] Confirm both READMEs follow the recorded baseline and project rules without losing accurate game-specific guidance.
- [ ] Check command examples for concrete values, optional brackets, consistent Markdown, and image-specific accuracy.

#### Agent log

<!-- implementor / reviewer append below -->

---

### T2 — Align Project Zomboid / Satisfactory

**Status:** pending

**Depends on:** T1

**Files:** `games/project-zomboid/README.md`, `games/satisfactory/README.md`

#### Implementor checklist

- [ ] Apply T1's recorded structure and style baseline to both READMEs.
- [ ] Use T1's applicability matrix, verifying relevant implementation details for both images, to add equivalent guidance wherever supported without copying unrelated settings or behavior.
- [ ] Replace abstract example placeholders with concrete representative values and correct inconsistent heading levels, command formatting, and shell line continuations.

#### Reviewer checklist

- [ ] Confirm both READMEs match the approved baseline and include equivalent content for supported topics.
- [ ] Verify ports, argument forwarding, config/environment-variable behavior, volume/save paths, and startup notes against the corresponding image.
- [ ] Confirm no unsupported behavior was introduced and useful game-specific information remains.

#### Agent log

<!-- implementor / reviewer append below -->

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
