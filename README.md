# Adobe Commerce Upgrade Toolkit

AI-assisted upgrade planning, compatibility analysis, and interactive hop reports for Adobe Commerce and Magento Open Source projects.

Turn a complex version upgrade into a sequence of reviewable steps. The toolkit helps teams understand upgrade impact, identify compatibility blockers, review remediation, and share self-contained HTML reports throughout the upgrade lifecycle.

## What the toolkit covers

| Capability | What it provides |
| --- | --- |
| Upgrade planning | Identifies the current and target versions and proposes intermediate upgrade hops for review. |
| Compatibility analysis | Uses Upgrade Compatibility Tool (UCT/UCA) findings to identify and classify upgrade issues for each hop. |
| Breaking-change assessment | Reviews affected APIs and replacement patterns against version-specific Commerce references. |
| Extension compatibility | Assesses third-party extension readiness and highlights blockers or compatibility gaps. |
| Frontend impact analysis | Reviews theme overrides and template compatibility, producing a developer review checklist rather than automatically changing frontend assets. |
| Guided remediation | Organizes approved fixes into reviewable work, with validation and resumable execution. |
| Deployment preparation | Produces a readiness assessment and deployment runbook after the upgrade hops are complete. |
| Upgrade assessment | `/upgrade-assess <version>` produces a read-only assessment: differential compatibility, platform services, third-party and custom module decisions, patch actions and Composer changes, with High/Medium/Small complexity ratings (no effort numbers). HTML and Markdown are generated; PDF and DOCX are converted by you. |
| Interactive reporting | Generates standalone HTML documents for the roadmap, individual hops, and deployment preparation. |

## Prerequisites

| Requirement | Details |
| --- | --- |
| Adobe I/O CLI (`aio`) | Install it, then verify with `aio --version`. The toolkit is an `aio` plugin. |
| Node.js and npm | A supported LTS release (the package requires Node.js 18 or later; use a current LTS such as 22 or 24 for new setups). Verify with `node --version` and `npm --version`. Install them before the Adobe I/O CLI. |
| Commerce project | An installed, working Adobe Commerce or Magento Open Source project containing `composer.json` and `bin/magento`, with PHP and service versions matching its release. |
| Local environment | One of Warden, Adobe Commerce Cloud Docker (`magento-cloud-docker`), Markshust Docker Magento, or bare-metal. |
| AI agent | [GitHub Copilot](https://github.com/features/copilot) (IDE or CLI) or [Claude Code](https://claude.com/claude-code), installed and authenticated. |
| Linux host or container | The installer and several helpers need Linux `/proc` (see [Troubleshooting](#troubleshooting)). |

Use a local or development environment only. Never run the toolkit against production or with production credentials.

## Installation

### 1. Install the plugin
To work from source:

```bash
git clone https://github.com/adobe/commerce-upgrade-toolkit.git
cd commerce-upgrade-toolkit
npm install
```

### 2. Set up the toolkit in your Commerce project

Run this from the Commerce application root (the folder with `composer.json` and `bin/magento`):

```bash
cd /path/to/commerce/project
aio ccua:setup                              # prompts for the agent
aio ccua:setup --agent github-copilot       # or: --agent claude-code
```

Optional flags:

| Flag | Values | Purpose |
| --- | --- | --- |
| `--agent`, `-a` | `claude-code`, `github-copilot` | Agent flavour to install. |
| `--project` | path | Project to install into (defaults to the current directory). |
| `--install-type` | `fresh`, `existing` | Pre-seeds `upgrade-state.md`. |
| `--environment` | `warden`, `markshust`, `cloud`, `bare-metal` | Pre-seeds the environment (used with `--install-type=fresh`). |

If you did not pass `--agent` and need to change it later, run `aio ccua:agent:select` from the same project directory.

Running from a source checkout is equivalent:

```bash
node scripts/setup-project.mjs --project /path/to/project --agent github-copilot --install-type existing --environment warden
```

| Flavour | Files installed in the project |
| --- | --- |
| GitHub Copilot | `.github/` (instructions, skills, scripts, reports and context folders) |
| Claude Code | `.claude/` and `CLAUDE.md` |

Existing project instruction files are preserved, not overwritten.

### 3. Verify and update

```bash
npm run verify:integrity                    # checks installed instruction files against the SHA-256 manifest
aio ccua:update                             # sync an existing install with the installed package version
```

`update` reports local tampering and regenerates toolkit-managed files. An older install without a version marker cannot be updated in place; remove the old toolkit files and run setup again.

## Quick start

Open the project in your agent session and run:

```text
/upgrade-hop                      # detect versions, build the multi-hop roadmap
/upgrade-hop 2.4.7-p3             # analyse one hop (UCT scan, findings by domain)
/upgrade-hop-execute 2.4.7-p3     # execute one hop after approvals and gates
/upgrade-deploy-prep              # deployment-readiness runbook after the last hop
/upgrade-assess 2.4.9             # read-only upgrade assessment
```

You approve the environment, plan and every code change in the live session. Resume an interrupted hop with `/upgrade-hop-execute <version> --chunk=N`.

## Command reference

| Command | When to use |
| --- | --- |
| `/upgrade-hop` | Detect the current environment and version and generate the multi-hop plan (writes `upgrade-state.md`). |
| `/upgrade-hop <version>` | Analyse blockers for one hop: UCT scan and findings across Backend, API Contract, Schema, Frontend, Services and Module Decommission. |
| `/upgrade-hop-execute <version>` | Execute one hop: pre-execution gates, dependency-ordered chunks with validation, post-hop checklist. |
| `/upgrade-hop-execute <version> --chunk=N` | Resume from a specific chunk. |
| `/upgrade-deploy-prep` | Review deployment readiness and produce the runbook. |
| `/upgrade-assess <version>` | Produce a read-only assessment with High/Medium/Small complexity ratings. |

## How it works

Each hop runs in two phases.

**Phase A: assessment**
1. **Setup**: detect the environment (Warden, Cloud Docker, Markshust) and installed service versions.
2. **Roadmap planning**: research the target version and design the multi-hop path. Commerce upgrades follow mandatory intermediate stops, for example `2.4.4 → 2.4.6 → 2.4.7 → 2.4.8`. Hops are never combined.
3. **Hop scan**: run the Upgrade Compatibility Tool (UCT) for the hop and collect findings.
4. **Analysis**: map code impact and blockers (payment plugins, high-risk files, extensions).
5. **Reporting**: publish the pre-hop report and mark the plan ready.

**Phase B: execution**
6. **Pre-execution gate**: confirm `env.php` and database backups, a clean working tree, and the encryption-key check before any change.
7. **Chunk execution loop**: specialist agents work dependency-ordered chunks (Services, Schema, Backend, API Contract, Frontend, Module Decommission), validating with DI compile, PHPCS and PHPUnit after each. Failures are retried a limited number of times, then escalated.
8. **Post-hop and completion**: after approval, `setup:upgrade`, DI compile, static content deploy, cache flush and reindex, QA smoke tests, then the post-hop report.

Typical post-hop smoke test: storefront and search work, checkout completes, admin and orders grid load, cron runs, payment credentials decrypt, and `var/log/exception.log` has no critical errors.

## Guardrails

- **No git operations by sub-agents.** Only the top-level session commits, and one finding is one commit.
- **Deployment safety.** No chunk proceeds without its validation step; infrastructure changes need explicit human confirmation.
- **No core overrides.** Core and `vendor/` changes are flagged, never modified.
- **PII and secret protection.** No secrets, keys or customer data in code, logs or reports.
- **Encryption.** Key rotation (`bin/magento encryption:key:change`) is human-operated only.
- **Explicit approval** of exact diffs, files and environment before any application change.

Custom modules and Marketplace extensions are handled the same way: the toolkit proposes what it safely can, flags items with no upgrade path, and leaves replace-or-remove decisions to you.

## Key considerations

- **Encryption key.** `app/etc/env.php` holds the key for payment vault tokens, API credentials and OAuth secrets. Back it up before every hop; never lose it.
- **Elasticsearch to OpenSearch.** From 2.4.8, Elasticsearch is not supported. The toolkit flags it as a blocker.
- **Never combine hops.** Each hop is a separate Composer update.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `Anchored publication requires Linux procfs` | The installer needs Linux `/proc`. On macOS, run setup in a Linux container, for example: `docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v /path/to/toolkit:/toolkit:ro -v /path/to/project:/project -w /toolkit node:22-bookworm node scripts/setup-project.mjs --project /project --agent github-copilot`. See [docs/security-linux-publication.md](docs/security-linux-publication.md). |
| `Denied by preToolUse hook: exit code 2` | A project hook (for example `.claude/hooks/protect-paths.py`) failed closed. Copilot sends the target as `path`, Claude Code as `file_path`; make the hook accept both. |
| `aio: command not found` | Install the Adobe I/O CLI and check your Node.js installation. |
| PHP or UCT sections show "NOT ASSESSED" | `phpcs`, `phpstan` or UCT is not installed in the project container. Install it yourself; the toolkit never installs dependencies automatically. |
| Cannot update an old install | Remove the old toolkit-managed files, then run `aio ccua:setup` again. |

## Contributing and development

The `.claude/` folder is the source of truth; `.github/` is generated from it. After editing `.claude/*` or `CLAUDE.md`, run:

```bash
npm run generate:github
npm test                          # on macOS some environment-dependent tests fail without Linux /proc
npm run check:secret-safety
```

Please read the [Code of Conduct](CODE_OF_CONDUCT.md), keep commit messages in the form `{TYPE}({scope}): short description`, and report problems through the repository's [issues](https://github.com/adobe/commerce-upgrade-toolkit/issues). Release notes are in the [CHANGELOG](CHANGELOG.md); the workflow is described in [docs/upgrade-workflow.md](docs/upgrade-workflow.md).

## How hop reports are generated

1. **Define the upgrade.** Confirm the Commerce project, current version, target version, and local/development environment.
2. **Review the roadmap.** The toolkit proposes the upgrade sequence and generates an HTML roadmap report.
3. **Analyze a hop.** For the next approved destination version, run compatibility analysis and review upgrade findings, blockers, and recommended work. The toolkit generates a pre-hop report.
4. **Execute approved work.** Review exact changes before applying them. The workflow tracks remediation and validation, then generates a post-hop report recording the outcome and unresolved items.
5. **Repeat and prepare.** Complete the remaining hops, then generate the deployment-preparation runbook. Deferred work must be resolved or explicitly signed off.

Report generation reflects the analysis and validation actually completed. Unknown compatibility, blocked checks, and unresolved findings must remain visible; a generated report is not proof that an upgrade is production-ready.

## Reports you can save and share

| Report | Purpose |
| --- | --- |
| Upgrade roadmap | Review the proposed multi-hop path before starting implementation. |
| Pre-hop report | Understand a hop's compatibility findings, risks, and planned remediation. |
| Post-hop report | Review completed work, validation outcomes, and remaining blockers. |
| Deployment runbook | Review deployment readiness and the human-operated deployment plan. |

Reports are self-contained HTML files with embedded styles and scripts, interactive navigation, collapsible sections, and copyable code blocks. No external CDN dependencies are required to view them.

**Current delivery model:** reports are generated as files in the Commerce project. You can open them in a browser, save a copy, or distribute them through your own approved download channel. This repository does not itself provide a hosted reporting service or public download endpoint.

## Safety and scope

The toolkit supports version upgrades; it is not a general-purpose application builder or an autonomous production deployment service. AI-generated recommendations require developer review.

Run upgrade work only in an approved local/development environment without production access or credentials. Application changes require explicit review and approval. Dependency, database, infrastructure, and other sensitive operations require separate authorization. Production deployment and secret/key operations remain human-operated.

Compatibility analysis and automated validation help identify risk but do not replace project-specific testing, secure backups, or release approval. See the [security guidance](docs/security-migration.md).

## License

Copyright 2026 Adobe. Licensed under [Apache-2.0](LICENSE); see [COPYRIGHT](COPYRIGHT). Third-party components retain their own licenses and notices. Previously distributed MIT-licensed versions retain their original license rights.

The toolkit license does not cover Adobe Commerce or external AI services, grant general Adobe trademark rights, or establish hosted-service terms or support commitments.
