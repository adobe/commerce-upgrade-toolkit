# Adobe Commerce Upgrade Toolkit

AI-guided, developer-approved upgrades for Adobe Commerce on cloud infrastructure (PaaS).

Use GitHub Copilot or Claude Code to plan upgrade hops, analyze compatibility, review fixes, and prepare deployment. This toolkit is for PaaS upgrades, not Adobe Commerce as a Cloud Service (SaaS) extension development.

## Prerequisites

| Requirement | Details |
| --- | --- |
| Node.js and npm | Node.js 22 or later for the toolkit CLI plugin. |
| Adobe I/O CLI | `aio` with `@adobe/commerce-upgrade-toolkit` version 1.0.1 or later installed as a plugin. |
| Commerce project | A local or development checkout of an installed Adobe Commerce PaaS project with `composer.json` and `bin/magento`. |
| Coding agent | [GitHub Copilot](https://github.com/features/copilot) or [Claude Code](https://claude.com/claude-code), installed and authenticated. |
| Linux development environment | Linux with `/proc`, using Warden, Cloud Docker, Markshust Docker Magento, or bare-metal. On macOS or Windows, run setup in a Linux development container; native setup is not supported. |

Use a local or development environment only, without production access or production credentials.

## Installation

The setup command is provided by this toolkit plugin in version 1.0.1 or later.
No separate Commerce CLI plugin is required.

### 1. Install

If `aio` is not installed:

```bash
npm install -g @adobe/aio-cli
```

Install the toolkit plugin:

```bash
aio plugins:install @adobe/commerce-upgrade-toolkit
```

### 2. Set up your Commerce project

```bash
cd /path/to/commerce/project
aio commerce upgrade tools-setup
```

Choose **Claude Code** or **GitHub Copilot** when prompted. Setup downloads the latest toolkit from npm, installs the selected workflows, and verifies the installed version and file integrity. Your project's npm dependencies and lock file are unchanged.

| Agent | Files installed |
| --- | --- |
| GitHub Copilot | `.github/` instructions, agents, skills, and helper files |
| Claude Code | `.claude/` workflows and helper files, plus `CLAUDE.md` |

### 3. Start your upgrade

Open the Commerce project in your coding agent, restart or reload its session, and run:

```text
/upgrade-hop
```

### Optional setup flags

```bash
aio commerce upgrade tools-setup --agent "GitHub Copilot"
```

| Flag | Purpose |
| --- | --- |
| `--agent`, `-a` | `GitHub Copilot` or `Claude Code`; prompts if omitted. |
| `--project`, `-p` | Existing Commerce project; defaults to the working directory. |
| `--tools-version`, `-v` | Exact toolkit version or npm tag; defaults to `latest`. |

## Updating

From the same Commerce project, rerun setup and select the same agent:

```bash
aio commerce upgrade tools-setup
```

Setup preserves project-owned instructions and state, reports changes to managed files, and rejects downgrades. Restart your coding agent afterward.
To update the CLI plugin itself, run `aio plugins:update`.

## Upgrade workflows

Run these commands in your coding agent, not in the terminal:

| Command | Purpose |
| --- | --- |
| `/upgrade-hop` | Detect the environment and versions, then generate the multi-hop roadmap. |
| `/upgrade-hop <version>` | Analyze compatibility and blockers for one upgrade hop. |
| `/upgrade-hop-execute <version>` | Execute approved changes for that hop, with validation. |
| `/upgrade-deploy-prep` | Generate deployment-readiness checks and a human-operated runbook. |
| `/upgrade-assess <version>` | Generate a read-only assessment with complexity ratings and HTML/Markdown reports. |

Complete and validate each approved hop separately. See the [workflow guide](docs/upgrade-workflow.md) for details.

## Safe use and limitations

- Approve the environment, plan, and exact changes before applying fixes.
- Back up the database and `app/etc/env.php`, including the encryption key, before every hop.
- Core and `vendor/` modifications are flagged, not applied. Frontend analysis produces a review checklist rather than automatically changing theme assets.
- Production deployment, infrastructure changes, and encryption-key operations require human control.
- AI recommendations and generated reports do not guarantee compatibility or production readiness. Complete project-specific validation and release approval.

Reports are generated as local files in your Commerce project, not hosted by this repository. Assessment PDF/DOCX conversion is human-operated.

Read the [security and existing-install guidance](docs/security-migration.md) before using the toolkit or resuming an older installation.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| `aio: command not found` | Install the Adobe I/O CLI and verify that it is on your PATH. |
| `commerce upgrade tools-setup` is not recognized | Install or update the toolkit plugin to version 1.0.1 or later. Version 1.0.0 does not include this command. |
| Setup requires Linux `/proc` | Run setup in a Linux development container or host. See the [platform limitation](docs/security-linux-publication.md). |
| PHP or UCT checks are not assessed | Install the required project tools in your development environment, then rerun the checks. The toolkit does not install Commerce analysis dependencies automatically. |
| An older installation cannot be updated | Back up project-owned files and follow the [existing-install guidance](docs/security-migration.md). |

## Documentation and feedback

- [Workflow and reports](docs/upgrade-workflow.md)
- [Security guidance](docs/security-migration.md)
- [Commerce upgrade guide on Experience League](https://experienceleague.adobe.com/en/docs/commerce-operations/upgrade-guide/overview)
- [Report an installation or upgrade-workflow issue](https://github.com/adobe/commerce-upgrade-toolkit/issues)

Do not include customer code, credentials, personal data, or other confidential material in public issues. Report suspected vulnerabilities through [Adobe's security reporting channel](https://helpx.adobe.com/security/alertus.html), not public GitHub issues.

## License

Copyright 2026 Adobe. Licensed under [Apache-2.0](LICENSE); see [COPYRIGHT](COPYRIGHT). Third-party components retain their own licenses and notices. Previously distributed MIT-licensed versions retain their original license rights.

The toolkit license does not cover Adobe Commerce or external AI services, or establish hosted-service terms or support commitments.
