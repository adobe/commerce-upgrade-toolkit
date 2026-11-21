# Adobe Commerce Upgrade Toolkit

AI-guided, developer-approved upgrades for Adobe Commerce on cloud infrastructure (PaaS).

Install upgrade workflows in a local or development checkout of your Adobe Commerce PaaS project, then use GitHub Copilot or Claude Code to plan upgrade hops, analyze compatibility, review fixes, and prepare deployment. This toolkit is for PaaS version upgrades, not Adobe Commerce as a Cloud Service (SaaS) extension development.

The toolkit helps you:

- Plan the upgrade path from your current Commerce version to a target version.
- Analyze UCT findings, breaking changes, extensions, and frontend impact.
- Apply approved fixes in reviewable steps with validation.
- Generate upgrade assessments, HTML reports, and deployment runbooks.

## Prerequisites

| Requirement | Details |
| --- | --- |
| Node.js and npm | Node.js 22 or later for the Commerce CLI. |
| Adobe I/O CLI | `aio` with the Commerce plugin containing `commerce upgrade tools-setup`. |
| Commerce project | A local or development checkout of an installed Adobe Commerce PaaS project with `composer.json` and `bin/magento`. |
| Coding agent | [GitHub Copilot](https://github.com/features/copilot) or [Claude Code](https://claude.com/claude-code), installed and authenticated. |
| Linux development environment | Linux with `/proc`, using Warden, Cloud Docker, Markshust Docker Magento, or bare-metal. On macOS or Windows, run setup in a Linux development container; native setup is not supported. |

Use a local or development environment only, without production access or production credentials.

## Installation

> **Release status:** `@adobe/commerce-upgrade-toolkit@1.0.0` and the new Commerce CLI command are not yet published. The instructions below require both releases. The previous `@adobe-thillai/aio-cli-plugin-ccua` package is not the download target for this setup flow.

The Commerce CLI provides the setup command and downloads the toolkit from npm. No separate upgrade-toolkit plugin installation is needed.

<details>
<summary>First time using the Adobe I/O CLI?</summary>

Install the CLI and Commerce plugin once in your Linux development environment:

```bash
npm install -g @adobe/aio-cli
aio plugins:install https://github.com/adobe-commerce/aio-cli-plugin-commerce
```

The installed Commerce plugin must include the new upgrade command.

</details>

### 1. Run setup

From the Commerce project root:

```bash
cd /path/to/commerce/project
aio commerce upgrade tools-setup
```

### 2. Choose your coding agent

Follow the prompt:

```text
Which coding agent would you like to install the upgrade toolkit for?
> GitHub Copilot
  Claude Code
```

Setup downloads [`@adobe/commerce-upgrade-toolkit`](https://www.npmjs.com/package/@adobe/commerce-upgrade-toolkit) from npm, installs the selected agent's workflows in the working directory, and verifies the installation. It does not clone a starter kit, configure Adobe Developer Console credentials, or change your project's npm dependencies or lock file.

| Agent | Files installed |
| --- | --- |
| GitHub Copilot | `.github/` instructions, agents, skills, and helper files |
| Claude Code | `.claude/` workflows and helper files, plus `CLAUDE.md` |

### 3. Start your upgrade

Open the Commerce project in your coding agent, restart or reload its session, and run:

```text
/upgrade-hop
```

Review the proposed environment and upgrade roadmap before proceeding.

### Optional setup flags

```bash
aio commerce upgrade tools-setup --agent "GitHub Copilot"
aio commerce upgrade tools-setup --agent "Claude Code" --tools-version 1.0.0
aio commerce upgrade tools-setup --project /path/to/commerce/project
```

| Flag | Purpose |
| --- | --- |
| `--agent`, `-a` | `GitHub Copilot` or `Claude Code`; prompts if omitted. |
| `--project`, `-p` | Existing Commerce project; defaults to the working directory. |
| `--tools-version`, `-v` | Exact toolkit version or npm tag; defaults to `latest`. |

## Updating

From the same Commerce project, rerun:

```bash
aio commerce upgrade tools-setup
```

Select the same agent to download and apply the latest compatible toolkit release. Project-owned instructions and state are preserved; changes to toolkit-managed files are reported before replacement. Downgrades are rejected. Restart your coding agent after updating.

The new package starts a separate version line at `1.0.0`. Existing installations from the previous package with `2.x` version markers are not automatically migrated; the updater rejects them as downgrades. Back up project-owned instructions and state, then review the old toolkit-managed files before a fresh installation.

## Upgrade workflows

Run these commands in your coding agent, not in the terminal:

| Command | Purpose |
| --- | --- |
| `/upgrade-hop` | Detect the environment and versions, then generate the multi-hop roadmap. |
| `/upgrade-hop <version>` | Analyze compatibility and blockers for one upgrade hop. |
| `/upgrade-hop-execute <version>` | Execute approved changes for that hop, with validation. |
| `/upgrade-deploy-prep` | Generate deployment-readiness checks and a human-operated runbook. |
| `/upgrade-assess <version>` | Generate a read-only assessment with complexity ratings and HTML/Markdown reports. |

For example, analyze a proposed hop with `/upgrade-hop 2.4.7-p3`, then execute it after approval with `/upgrade-hop-execute 2.4.7-p3`. Resume an interrupted execution with `/upgrade-hop-execute <version> --chunk=N`.

Complete and validate each approved hop separately. Review the [workflow guide](docs/upgrade-workflow.md) for the assessment, execution, and reporting stages.

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
| `commerce upgrade tools-setup` is not recognized | Check that your Commerce CLI release includes the new command. It is not yet published. |
| `installer API v1 is required` | Choose an official toolkit release that includes installer API v1. |
| Setup requires Linux `/proc` | Run setup in a Linux development container or host. See the [platform limitation](docs/security-linux-publication.md). |
| PHP or UCT checks are not assessed | Install the required project tools in your development environment, then rerun the checks. The toolkit does not install Commerce analysis dependencies automatically. |
| An older installation cannot be updated | If its version marker is missing, review and remove only its old toolkit-managed files before running setup again. |

## Documentation and feedback

- [Workflow and reports](docs/upgrade-workflow.md)
- [Security guidance](docs/security-migration.md)
- [Commerce upgrade guide on Experience League](https://experienceleague.adobe.com/en/docs/commerce-operations/upgrade-guide/overview)
- [GitHub releases](https://github.com/adobe/commerce-upgrade-toolkit/releases)
- [Report an installation or upgrade-workflow issue](https://github.com/adobe/commerce-upgrade-toolkit/issues)

This README provides the installation instructions for GitHub and the npm package. Experience League toolkit documentation will reflect the same setup flow when published.

Do not include customer code, credentials, personal data, or other confidential material in public issues. Report suspected vulnerabilities through [Adobe's security reporting channel](https://helpx.adobe.com/security/alertus.html), not public GitHub issues.

## License

Copyright 2026 Adobe. Licensed under [Apache-2.0](LICENSE); see [COPYRIGHT](COPYRIGHT). Third-party components retain their own licenses and notices. Previously distributed MIT-licensed versions retain their original license rights.

The toolkit license does not cover Adobe Commerce or external AI services, or establish hosted-service terms or support commitments.
