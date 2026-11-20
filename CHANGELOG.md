# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Each release branch (`release/x.y.z`) must add its own `## [x.y.z]` section here
before opening the PR into `main` — the publish workflow reads this file to fail
fast if the entry is missing and to populate the GitHub Release notes.

## [Unreleased]
### Security
- Agent instruction files are now integrity-protected against stored prompt injection:
  setup/update record a SHA-256 manifest (`<flavour>/context/.ccua-manifest.json`);
  `update` reports local tampering, regenerates toolkit-managed files from the package
  (also on same-version drift), removes injected files and fails if post-sync verification
  does not match. New `npm run verify:integrity` / `scripts/verify-integrity.mjs` for CI and
  pre-flight checks. Added contributor guidance for these paths.

### Added
- `scripts/export-assessment.mjs` (`npm run export:assessment -- --html <f> [--md <f>] --out-dir <d>`):
  human-run PDF (headless Chrome/Edge) and DOCX (`pandoc`) export of assessment reports;
  report print CSS no longer leaves blank pages.
- `/upgrade-assess <version>` and the `upgrade-assessment` skill: a read-only Upgrade
  Assessment report modelled on Adobe Professional Services assessments (PHP and
  differential UCT compatibility, platform/cloud services, third-party and custom module
  decisions, patch actions, Composer proposal, delivery outline). Complexity is rated
  High/Medium/Small only; no effort points, hours or durations. Supports Cloud and
  on-premises hosting profiles. Produces HTML and Markdown; PDF/DOCX are human-converted.
- Mandatory security gate for AI-generated upgrade code (`security_gate.py`, Semgrep rules and
  policy): per-chunk scan before any patch is applied, human approval for security-critical
  changes, post-upgrade scan across all hops, a `Security Scan` CI job, and a secure-code
  generation guardrail for all agents. See `docs/security-gate.md`.
### Changed
- Disabled CodeGraph provisioning and default MCP grants; upgrade analysis now uses
  direct project read/search. Explicit activation fails closed pending independently
  reviewed version/integrity, transitive lock, provenance, catalog/proxy and OS sandbox
  contracts. Setup, switching and same-version updates reconcile only recognizable
  legacy workspace registrations/grants after joint preflight; root/global rules
  require manual repair. Added inert-executable regression tests and nightly containment CI.
- Adopted Apache-2.0 licensing with Adobe copyright, consistent npm metadata,
  and full starter-template source headers with SPDX identifiers. Previously
  distributed MIT-licensed versions retain their original license rights.
- Setup and updates now include toolkit license and copyright notices in an
  agent-specific `ccua-legal/` directory without changing customer-project licensing.
- Replaced project-authored report and schema terminology with inclusive wording,
  while preserving literal third-party commands, filenames, and branch references.
- Pinned GitHub Actions to immutable commits and added test/generated-asset checks
  before publishing. Releases use the merged commit, Node.js 22, and npm 11.

- Supply-chain hardening (AC-19141): npm publishing now attaches provenance, runs in
  a protected `npm-publish` environment and records `dist.integrity` in release notes (release finalization is idempotent and
  recoverable by rerunning the workflow);
  CI adds `npm audit` and dependency review, Dependabot is enabled, `fs-extra` is
  pinned, and the README documents pinned installs and pre-install verification.

### Added
- Adobe Code of Conduct, tailored contribution and issue/PR templates, and a
  private security-reporting policy based on Adobe's open-source starter guidance.
- Read-only pull-request CI covering Node.js 18, 22, and 24.

### Fixed
- Pinned `@oclif/core` to the Node.js 18-compatible `4.3.1` release, removing
  the vulnerable `braces` and `sprintf-js` dependency chains, and updated
  all locked `brace-expansion` instances to `2.1.7`. No transitive-major overrides
  or new direct dependencies are used. Replaced the removed oclif `ux.prompt` /
  `ux.write` APIs with native Node.js readline/output, preserving agent choices,
  aliases and the default while failing closed on missing or invalid input.
  Regression coverage exercises the real dispatcher, including prompted selection;
  Node.js 18, 22 and 24 remain the supported CI matrix.
  Upstream source:
  https://github.com/oclif/core/tree/687db9f9f63d0c4f65919a828d3b83b58266aec1.
- `/upgrade-hop-execute` fixes from real dogfooding runs (both toolkit flavours upgrading
  a live 2.4.3 project to 2.4.9), found via post-run report review, not synthetic testing:
  - **Infra-bump ordering**: the composer platform update (formerly Step 3c) previously ran
    *before* Chunk 1's infra floor bump, which could make dependent packages (e.g. Adobe
    IMS/Stock companion metapackages) silently resolve to beta pre-releases instead of
    stable ones when the current PHP floor was too low for their stable line. Chunk 1
    (Services/infra) now always executes first as the new Step 3c; the platform update
    moved to Step 3d and explicitly documents why it must come second.
  - **Encryption-rotation gate had no durable proof of completion**: Gate 4 previously
    accepted a bare "yes" with nothing recorded, making a prior hop's rotation status
    unverifiable later. Added an `encryptionRotationConfirmation` column to the `## Hop
    plan` table in `upgrade-state.md`; Gate 4 now asks what was checked to confirm the
    rotation and writes a dated, evidence-bearing record before proceeding.
  - **Post-hop validation was too shallow to catch real regressions**: `setup:upgrade` /
    `di:compile` / reindex all passing, plus a bare HTTP 200 on `/` and the `/admin` login
    page, does not prove the app actually works — a disabled module's DI preference can
    still be soft-depended-on by newly-changed core code, producing a runtime-only fatal
    that only surfaces on the specific page/flow that needs it (observed twice: an admin
    500 on the menu builder, and a storefront PDP/add-to-cart fatal). Added a mandatory
    "Disabled-Module Dependency Audit" step to Step 5 (compares `app/etc/config.php`'s
    disabled modules against enabled modules' DI preferences) and raised the smoke-test
    dispatch's minimum bar to require an authenticated admin dashboard load and a real
    add-to-cart flow, not just root-URL checks.

### Fixed (continued — found via a full GitHub Copilot functional test)
- `scripts/generate-github-assets.mjs`'s guardrail-to-instructions description
  extraction produced `description: 1.` for `deployment-safety.instructions.md` —
  its "Absolute rules" section is a numbered list with no lead prose sentence, and the
  extractor's per-line join let a wrapped list item's continuation line get treated as
  independent prose while the "1."/"2." markers themselves tripped up the
  first-sentence period-detection. Fixed by reconstructing each list item (merging
  soft-wrap continuation lines into their owning marker line) before deciding whether
  to use a genuine prose line or fall back to the first fully-reconstructed item.
  Verified all 4 previously-correct guardrail descriptions are unchanged.

### Fixed (continued — deeper static audit across every skill/agent, same session)
- Same phantom-reference class found 4 more times: `/upgrade-extension-check`
  (`marketplace-extension-analysis.md`, `websearch-scope.md`), `/upgrade-watch`
  (`upgrade-hop-report.md` — an entire report tab, "Watch Log", fed by a scan-tracking
  mechanism that doesn't exist anywhere in this toolkit; removed the tab rather than leave
  it permanently empty), `/upgrade-approve-hop` + `/upgrade-report` (`data-migration-plan.md`,
  `commerce-frontend-developer.md`), and `db-schema-validation` "in the architecture repo"
  (`data-patches.md`, referencing a repo this toolkit has no connection to). All repointed
  at the real current mechanism; consolidated all six into one Known-gap entry in
  `CLAUDE.md`/`README.md` instead of scattered individual notes.
- `encryption-and-passwords.md`'s pre-hop safety checklist had a stray `git stash` command
  that would run for real (meant as a comment — "env.php should NOT be in git" — but written
  as an executable line) and a non-existent `bin/magento setup:db-dump` command. Fixed both:
  a real verification check for env.php's git-tracked status, and the actual command
  (`setup:backup --db`).
- `CLAUDE.md`'s agent table still described `commerce-upgrade-analyst` as running a
  "five-phase" workflow; the agent's own definition (and its RESEARCH phase for parallel
  WebSearch lanes) has been six-phase for a while. Corrected the description to match.
- Two standalone prompt templates (`.claude/prompts/*.md`) and `environment-detection.md`
  also referenced retired command names (`/upgrade-fix`, `/upgrade-scan`, `/upgrade-analyse`,
  `/commerce-init` — the last belongs to the broader module-development toolkit this was
  extracted from, correctly out of scope here). Reworded to reference the current
  `/upgrade-hop`/`/upgrade-hop-execute` phase names instead.

### Fixed (continued — found via a static cross-reference audit, not dogfooding this time)
- **`/deploy-check` was referenced 4 times but never existed in this toolkit** — same class
  of gap as the already-documented `no-git-operations` skill (both carried over from the
  source repo and never authored/extracted here), except this one was undocumented and more
  load-bearing: `upgrade-deploy-prep.md`'s own Step 2 said "reuse the same checks... do not
  duplicate logic, call the same commands" against a command that didn't exist. Made Step 2
  self-contained with its own checklist; repointed the other two references
  (`commerce-devops-engineer.md`, `deployment-safety.md`) at `/upgrade-deploy-prep`'s Step 2;
  documented the gap in `CLAUDE.md`/`README.md` alongside the existing `no-git-operations` one.
- **"Phase 0.5" was referenced 4 times as a load-bearing checkpoint but never formally
  defined** — `/upgrade-hop-execute`'s actual pre-execution checkpoints are named Gate
  1/2/3/4, not "Phase 0.5"; it only existed as informal shorthand scattered across
  `upgrade-hop.md`, `upgrade-deploy-prep.md`, `commerce-installation.md`, and the
  `upgrade-state.md` template. Replaced all four with explicit pointers to the real gates.

### Fixed (continued — P1/P2 findings from the same dogfooding runs)
- **Report/hop tracking was all prose, no structured data**: `/upgrade-hop` and
  `/upgrade-hop-execute` now write the roadmap/hop-version report paths into
  `upgrade-state.md`'s `## Reports` section (`roadmapReportPath`, `hopVersionReports`) and
  populate the `## Hop progress` table, instead of leaving those structured fields empty
  while everything lived only in freeform Session notes.
- **Version drift between `upgrade-state.md` and the live install required manual detective
  work**: `/upgrade-hop-execute` Step 1 now runs a live-version check up front and
  auto-corrects `fromVersion`/`installedVersion` (marking any now-behind hop rows
  `SUPERSEDED`) instead of requiring a human to notice the mismatch mid-run.
- **Standalone UCT install (`uct-install` skill) used to live at `/tmp/uct-standalone`**,
  which doesn't survive a container recreate — every infra-floor bump silently required a
  UCT reinstall. It now installs to `var/ccua/uct-standalone` (project-root-relative,
  survives container recreates for Warden/markshust) with an explicit fallback + note for
  Docker setups where that path isn't mounted.
- **`api-breaking-changes` had no 2.4.8 → 2.4.9 entry**: added the `elasticsearch7` module
  removal and the OpenSearch-vs-`elasticsearch8` migration gotcha (Elastic's client
  hard-rejects non-Elastic distros) as a documented breaking change instead of something
  each hop has to rediscover by trial.
- **`commerce-installation` had no per-service in-place-upgrade guidance**: added notes on
  which infra bumps are safe in-place (MariaDB) vs. typically need a fresh data
  volume/index (OpenSearch/Elasticsearch major jumps, RabbitMQ major jumps) so this doesn't
  have to be discovered via a failed container start mid-hop.
- **`module-inventory.md`'s seeded example rows looked like real data**: fenced them
  explicitly behind an `EXAMPLE ROWS` HTML comment marker, and added a one-time "module
  inventory reality check" to `/upgrade-hop` Step 0 that verifies (and clears, for core-only
  projects) the example content against actual `app/code/` before any hop trusts it.
- Confirmed the `nikic/php-parser` conflict between `magento/mray` and 2.4.8+ core (forcing
  `uctInstallMode: standalone-fallback`) was already fully documented and handled correctly
  by the existing `uct-install` skill — no change needed there; this one was working as
  designed.

### Changed
- Reduced Adobe-ecosystem bias flagged by the product team: `.claude/context/integrations.md`
  now leads with generic capability headers (SSO/IdP, CDP, journey orchestration, serverless
  runtime, ERP/PIM/OMS) with the Adobe stack (IMS/Entra, AEP/RTCDP, AJO, App Builder) shown
  as a labeled example, not the section identity. The same treatment was applied to
  `architecture.md`'s integration-map diagram and `module-inventory.md`'s example module
  rows. More importantly, the behavior-driving files that had baked Adobe-specific
  assumptions in as universal fact — `commerce-security-reviewer.md`'s "IMS/ENTRA SPECIFIC"
  section, `deployment-safety.md`'s credential-handling rules, `pii-protection.md`'s
  "App Builder / AEP rules" — now read `integrations.md` and apply checks conditionally on
  what a project actually documents there, rather than assuming every project uses Adobe
  IMS/Entra/AEP/App Builder. `api-breaking-changes.md`'s note on the IMS module refactor
  between 2.4.5→2.4.6 was left as-is — that's real Magento/Commerce-core changelog content
  (Commerce ships an optional Adobe IMS module OOTB), not project-specific bias.
  `.github/*` regenerated from the updated `.claude/*` source via `generate:github`.

### Removed
- FluffyJaws MCP fully decommissioned: the registry entry and
  `scripts/setup-fluffyjaws.mjs` are gone. Document/release-note lookups move to
  `WebSearch`/`WebFetch` — see the CLAUDE.md §2 rewrite tracked separately.
- `aio ccua:mcp:install` command (and `scripts/mcp-install.mjs`) removed. With
  FluffyJaws gone, CodeGraph is the only MCP the toolkit uses, and `aio ccua:setup`
  already installs and wires it automatically — a separate maintenance command had no
  remaining purpose. To retry a failed CodeGraph install or rebuild its index, re-run
  `aio ccua:setup`.

### Changed
- `aio ccua:setup` no longer installs FluffyJaws (optional MCP). It now installs base
  toolkit assets and configuration (commands, agents, skills, `CLAUDE.md`,
  upgrade-state seeding, version marker), and installs/wires **CodeGraph** only — the
  one MCP the core workflow depends on. Existing projects that already ran the old
  `aio ccua:setup` (which auto-installed both CodeGraph and FluffyJaws) are unaffected —
  nothing is removed on `aio ccua:update`.
- `scripts/lib/mcp-registry.mjs` trimmed to what `aio ccua:setup` actually consumes
  (`MCP_REGISTRY`, `getMandatoryMcps()`) now that there is no install command left to
  serve the optional-MCP/picker code paths.

### Added
- GitHub Copilot toolkit flavour, alongside the existing Claude Code one. `aio
  ccua:agent:select` (interactive) or `aio ccua:setup --agent github-copilot` installs a
  `.github/{agents,skills,instructions,context,hooks,scripts}` tree plus
  `.github/copilot-instructions.md`, generated 1:1 from the `.claude/*` source of truth by
  `scripts/generate-github-assets.mjs` (agents → `*.agent.md`, skills and all three
  phase-gated commands → `skills/<name>/SKILL.md`, guardrails → `*.instructions.md` with a
  scoped `applyTo`, `CLAUDE.md` → `copilot-instructions.md`). CodeGraph is installed and
  wired the same way for both flavours — into `.mcp.json` for Claude Code, into
  `.vscode/mcp.json` for Copilot — since the toolkit's CodeGraph-first workflow is
  load-bearing for either. `.claude/settings.json`'s Bash-permission allow/deny list and
  its SessionStart hook have no Copilot equivalent; both are documented in the generated
  `.github/copilot-settings-notes.md` rather than silently dropped. `aio ccua:update` now
  auto-detects which flavour is installed (via each flavour's own version marker) and
  syncs only that tree. A project gets one flavour or the other, never both.

## [1.2.1] - 2026-08-21
### Added
- `aio ccua:setup` command — first-time toolkit install into a Commerce project via
  `aio plugins:install @adobe-thillai/aio-cli-plugin-ccua`, with no repo checkout required.
- `oclif` plugin configuration (`bin`, `commands`, `ccua` topic) so the package loads
  correctly as an `aio-cli` plugin.

### Fixed
- Removed `"type": "module"` from `package.json` — it silently broke the CommonJS
  command files (`ccua:update`, `ccua:setup`) when loaded from a published package.
- Declared `@oclif/core` as a dependency and added `src` to the package `files` list —
  command code was missing from the published npm tarball.
