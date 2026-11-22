# Adobe Commerce Upgrade Toolkit

AI-guided, developer-approved upgrades for Adobe Commerce on cloud infrastructure (PaaS).

Use GitHub Copilot or Claude Code to plan upgrade hops, assess compatibility, review fixes,
and prepare deployment. This toolkit is for version upgrades, not Adobe Commerce as a Cloud
Service (SaaS) extension development.

## Prerequisites

| Requirement | Details |
| --- | --- |
| Development environment | Linux with `/proc`, Node.js 22+ and npm. On macOS or Windows, run setup inside your project's Linux development container; native setup is not supported. |
| Commerce project | An existing local/development checkout with `composer.json` and `bin/magento`, writable by the normal development user. |
| Coding agent | [GitHub Copilot](https://github.com/features/copilot) or [Claude Code](https://claude.com/claude-code), installed and authenticated. |
| Documentation research | Python 3 with a trusted CA store and curl, available where the coding agent runs research. |
| Compatibility assessment | Working Upgrade Compatibility Tool (UCT), successful required scans and supported normalization. UCT is not required for toolkit installation or planning-only roadmaps. |

Use a local/development environment without production access or credentials. Do not run
setup as root.

## Installation

The toolkit plugin provides `aio commerce upgrade tools-setup`; no separate Commerce CLI
plugin is required.

### 1. Enter your Linux development shell

Start your project's development environment, then enter its Linux shell from the
**host terminal**. For Warden:

```bash
warden shell
```

For other environments, use the [setup guide](docs/setup-guide.md#enter-the-development-shell).
Installing tools on the host does not install them inside Docker.

### 2. Install the CLI and toolkit plugin

Run the following **inside the Linux shell**:

```bash
uname -s
node --version
npm --version
```

Confirm `Linux` and Node.js 22+. Install into the development user's home:

```bash
export PATH="$HOME/.local/bin:$PATH"
npm install --global --prefix "$HOME/.local" @adobe/aio-cli
aio plugins:install @adobe/commerce-upgrade-toolkit
aio commerce upgrade tools-setup --help
```

Persist the PATH line in your shell startup file. If the CLI and plugin are already
installed for this container user, skip their installation commands. No `sudo` is needed.

### 3. Set up the Commerce project

From the project root **inside Linux**, run:

```bash
cd /path/to/commerce/project/in/container
ls composer.json bin/magento
aio commerce upgrade tools-setup
```

Skip `cd` if already at the project root. Use the container's path, not a host path such
as `/Users/...`. Choose **GitHub Copilot** or **Claude Code** when prompted.

Setup downloads the toolkit from npm, installs the selected workflows, and verifies their
installed version and integrity. It does not install UCT or change your project's npm
dependencies and lock file.

| Agent | Installed files |
| --- | --- |
| GitHub Copilot | `.github/` instructions, agents, skills and helpers |
| Claude Code | `.claude/` workflows and helpers, plus `CLAUDE.md` |

Continue only after setup reports completion. If it fails, resolve the reported error
before starting a workflow.

### 4. Open the project in your coding agent

Open the same Commerce checkout and restart or reload the agent session. The agent can
remain on the host if the installed files are visible through the project's bind mount or
two-way synchronization.

In **agent chat, not the terminal**, run:

```text
/upgrade-hop
```

This generates a planning-only roadmap. See the commands below for compatibility analysis
and approved execution.

## Basic usage

Replace `<version>` with the target version you have reviewed. These commands are choices
for different tasks, not a script to paste as a mandatory sequence.

| Command | Purpose |
| --- | --- |
| `/upgrade-hop` | Discover the environment and plan the multi-hop roadmap; no UCT scan required. |
| `/upgrade-assess <version>` | Produce a read-only compatibility assessment with HTML/Markdown reports. |
| `/upgrade-hop <version>` | Analyze compatibility and blockers for the next approved hop. |
| `/upgrade-hop-execute <version>` | Apply approved changes for one hop, with validation and safety gates. |
| `/upgrade-deploy-prep` | Produce deployment-readiness checks and a human-operated runbook; does not deploy. |

Complete and validate each approved hop separately. The current agent session runs approved
scans and normalization; the documentation agent composes reports. See the
[workflow guide](docs/upgrade-workflow.md) for details.

## UCT assessment requirement

**A complete compatibility assessment requires working UCT, successful required captures,
and supported normalization.** `/upgrade-assess` requires both baseline and target scans.
A successful installation or version probe alone does not complete an assessment.

The shared prerequisite checks Magento, Composer and reviewed standalone executables before
offering setup. Installation and dependency repair are human-run outside the assessment;
the agent re-probes afterward. Missing tools, execution failures and unsupported normalization
require different recovery actions, not automatic reinstallation.

If UCT evidence is unavailable, explicitly choose **manual setup**, **continue incomplete**,
or **stop**. An incomplete report shows **UCT: Not assessed**, the reason and follow-up.
Unavailable counts remain null, not zero. Quarantined records remain visible human-review
blockers; a roadmap or incomplete report never authorizes remediation.

## Safety and limitations

- Approve the environment, hop plan and exact changes before applying fixes.
- Back up the database and `app/etc/env.php`, including the encryption key, before each hop.
- Core/vendor changes are flagged, not applied. Frontend analysis produces a review checklist.
- Production deployment, infrastructure changes and encryption-key operations remain human-controlled.
- Reports and successful scans are not proof of compatibility or production readiness.

Reports are self-contained local files in your Commerce project. Assessment PDF/DOCX
conversion is human-operated. Read the [security guidance](docs/security-migration.md)
before using the toolkit or resuming a preserved installation.

## Documentation and support

- [Detailed setup, updates and troubleshooting](docs/setup-guide.md)
- [Upgrade workflows and reports](docs/upgrade-workflow.md)
- [Commerce upgrade guide](https://experienceleague.adobe.com/en/docs/commerce-operations/upgrade-guide/overview)
- [Report an issue](https://github.com/adobe/commerce-upgrade-toolkit/issues)

Do not include customer code, credentials, personal data or confidential material in public
issues. Report suspected vulnerabilities through
[Adobe's security reporting channel](https://helpx.adobe.com/security/alertus.html).

## License

Copyright 2026 Adobe. Licensed under [Apache-2.0](LICENSE); see [COPYRIGHT](COPYRIGHT).
Third-party components retain their own licenses and notices. Previously distributed
MIT-licensed versions retain their original license rights.

The toolkit license does not cover Adobe Commerce or external AI services, or establish
hosted-service terms or support commitments.
