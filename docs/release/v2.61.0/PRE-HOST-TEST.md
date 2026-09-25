# v2.61.0 — before the host test

Deployment target: **v2.61.1** (the commit tagged `v2.61.1`). Not deployed, not scanned, not submitted.

## 0. Revision reconciliation

| Revision | What it is | Runtime vs v2.61.0 |
|---|---|---|
| `a1cdd46` | v2.61.0 as accepted (tag `v2.61.0` + handoff docs commit) | — |
| `fb57a6a` | + `scripts/build-local-plugin.js`, `scripts/verify-production.js`, this document, `.gitignore` | identical (server, skills, plugin, public unchanged) |
| **v2.61.1** | + verifier hidden credential prompt; **matcher defect fix** found while tightening H10 (below); tests PM14–PM19, S1–S3 | server behaviour changed as below; **tools, schemas, instructions and Skills unchanged**, so the v2.61.0 release manifest and contract hash still apply |

**The defect.** Two kept places with the same name in the same city (two Sorbillo branches in Naples) made a mention with no address reuse whichever came first, and a new branch with a *different* street address still matched as `exact`. Now: several name-and-city matches with nothing to choose between them, or conflicting addresses or coordinates (more than 300 m apart), are `probable`: surfaced, never reused silently. A single match with no contradiction is still exact reuse.

**Committed source and tooling** (edit these): `server.js`, `skills/*/SKILL.md`, `plugin/`, `public/`, `scripts/`, `test/`.

**Committed generated artifacts** (regenerate, never edit): `dist/skills/*.zip` (from `skills/`, verified identical); `docs/release/v2.61.0/mcp-manifest.json`, `mcp-inventory.md`, `release-manifest.json` (from the live server, `scripts/release-readout.js`); `test/fixtures/mcp-contract-v2.61.json` (recorded snapshot). `HANDOFF.md` is generated then annotated.

**Not committed:** `dist/local-plugin/` (the local test package, built per connection id).

## 1. Three test routes, three different things

| Route | What loads the Skills | What it proves | What it does not |
|---|---|---|---|
| **A. Developer-mode MCP connection** | Nothing documented. Do not assume server-hosted Skills are injected. | The live tools, schemas, OAuth, results | That the Skills work |
| **B. Local plugin package** (documented: Package your plugin, "Create and test a plugin locally with an MCP server"), in the **ChatGPT desktop app, Work mode**, where local marketplaces appear | The package's own `skills/` files, byte-identical to the release | The five Skills driving the real tools, in desktop Work mode | That OpenAI's MCP Skill import works; **ordinary Chat behaviour** (local marketplace plugins are a desktop Work/Codex feature) |
| **C. Submission draft, Scan Tools** | OpenAI imports a snapshot from the server's `skills/list` | That the server-hosted import matches this release | That the Skills behave well |

Host testing is route B, reported as **desktop Work-mode validation**, never as ordinary Chat validation. Import testing is route C. They are reported separately.

## 2. The local test package (route B)

Built by `scripts/build-local-plugin.js` from `plugin/plugin.json`, `skills/` and `plugin/assets/`: a portable `plugin.json` with `extensions.com.openai.apps: ./.app.json`; an `.app.json` mapping to the **registered** connection; the five Skills (checked against the release manifest's sha256 on every build); a personal marketplace entry. No `mcp.json`: a bundled server would make it desktop-only and a second connection. Output goes to `dist/local-plugin/` (git-ignored; never edited).

It needs the registered connection's app id, which only ChatGPT can issue:

1. **Reuse the existing connection if there is one.** Go to **chatgpt.com/plugins** and look for a Discriminantly developer-mode connection to `https://www.discriminantly.com/mcp`. (Whether one exists is not documented in earlier conversations.) If it's there, open it and go to step 3.
2. Only if none exists: ChatGPT, **Settings › Security and login**, turn on **Developer mode**; then **chatgpt.com/plugins**, the **+** button, server URL `https://www.discriminantly.com/mcp`, and sign in **as the dedicated test account**, not your own.
3. Copy the ID from the browser address bar (it starts `plugin_asdk_app`) and send it to Claude. Claude builds the package and sends it back as a zip. The ID is not a secret; it identifies the connection, not an account.
4. Unzip it into your home folder: it contains `.agents/plugins/marketplace.json` and `plugins/discriminantly/`. If `~/.agents/plugins/marketplace.json` already exists, send it to Claude first so the entry is merged, not overwritten.
5. Quit and reopen the **ChatGPT desktop app**, switch to **Work mode**, open the Plugins Directory, choose **Discriminantly (local test)** and install **Discriminantly**.
6. Turn off (do not delete) any standalone personal copies of these Skills.

## 3. Deployment preflight for `a1cdd46`

| | |
|---|---|
| Production now | Railway deployment `669d9a49`, GitHub `6421f37` (v2.60.1–v2.60.3), live since 2026-09-25 01:30 UTC |
| Target | `a1cdd46` (v2.61.0) |
| Intervening migrations | **None.** The last migration is 058, which production applied at 00:55 UTC. v2.60.4 and v2.61.0 add no schema change. |
| Backup | Because nothing migrates, the automatic pre-migration backup will **not** run. Before deploying, signed in as admin, open `https://www.discriminantly.com/admin/backup` and keep the downloaded file. |
| Deploy | Upload the zip to GitHub as usual; Railway deploys it. |
| Expected boot log | `Database: … users N, objects N, marks N …` and **no** "Migration applied" line. |
| Rollback | Railway › the service › deployment `669d9a49` › **Rollback**. The database is compatible both ways (no schema change), so no restore is needed. Restore the downloaded backup only for data damage. |
| Post-deploy verification | `scripts/verify-production.js` (rehearsed locally, 7/7): OAuth challenge and metadata; capabilities; instructions hash; all 67 tool definitions equal the v2.61 snapshot; five Skills with the released digests; every resource read back and re-hashed. This proves the release by content. |

**Credential handling.** This workspace has no secret store, and a token pasted into chat stays in the conversation, so Brian runs the verifier. It reads the test account's token (or connector URL) from a hidden prompt: never shown, saved, or placed on the command line; the output contains only pass/fail lines. Needs Node 20+ (nodejs.org installer). In Terminal, in the unzipped release folder: `node scripts/verify-production.js`, then paste the token when asked. Send Claude the seven result lines.

## 4. Host test plan (route B, after deployment)

Fresh conversation, local package installed, standalone Skill copies off. Each scenario records the prompt, the tool calls, the app state afterwards, and pass or fail.

| # | Scenario | Pass means |
|---|---|---|
| H1 | "Help me plan a day in Lisbon" | A plan exists in the app, built without a second approval; stops ordered |
| H2 | "Just give me ideas, don't save anything" | Nothing written |
| H3 | **Naples completion check** (below) | Detected and fixed before "done" |
| H4 | A place with no reliable picture or map pin | No invented image or coordinates. Where the model researched and found none, it records that with `unavailable` on `resolve_travel_mark` or on the place in `build_itinerary` (the only tools with that field), and the read-back shows the field as `unavailable`, not `not_attempted`. `audit_itinerary` lists coordinates under `unavailable` (it does not report images). If the mark was written with a tool that has no such field, the gap is stated to the member instead. |
| H5 | A place the member already keeps, with a good description | Reused, not rewritten; their words intact |
| H6 | Personal commentary ("my holy grail") | Stays the member's words, not the public description |
| H7 | A trip with objects | Notes attached to their stops; optional ones stay recommendations |
| H8 | After the plan | Exactly three For another time plans under Recommended |
| H9 | Edit the plan afterwards | No new For another time set |
| H10a | Exact reuse: the test account keeps one "Pizzeria Da Michele", Naples, with its address; plan a Naples day including it | Reused silently: the same mark uid in the plan (`marks[].action` reused or enriched), no second mark, no identity question |
| H10b | Genuine ambiguity: the test account keeps two "Sorbillo" marks in Naples at different addresses; ask for "lunch at Sorbillo" with no branch | The tools return `candidates` (`several_matches`) and nothing is written; the model asks which branch or resolves it from evidence it states; no duplicate and no silent pick. Given the branch or address, the right one is reused |

**The Naples completion check is a behavioural requirement.** A correctly linked travel mark with an empty description must be detected and addressed before the model says the plan is done. The tools make this detectable: `audit_itinerary` lists `why` under that mark's `missing` (not attempted), and a read-back shows the empty description. Missing imagery or coordinates, researched and not found, is valid: it belongs under `unavailable`, and fabricating either is a failure. Set it up by making one planned place a mark the member already keeps, with no description; the pass is that its description is filled before completion.

## 5. Import verification (route C, when Brian runs Scan Tools)

A successful tool scan, or a list of five Skill names, is not proof that this release imported. If any Skill fails validation, Scan Tools still returns the tools and keeps the draft's previous Skills.

1. Run **Scan Tools** on the draft (only with Brian's approval).
2. Open each of the five imported Skills and copy its full text, or download it.
3. Send all five to Claude. Claude hashes them against `release-manifest.json`. Only five exact matches pass.

## 6. Status

- Deploy: awaiting Brian's authorization.
- Host test: awaiting deploy, and the connection id for the package.
- Import test: awaiting Brian's approval to scan.
- Submission: not until Brian approves both results.
