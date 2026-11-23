# Adobe Commerce Upgrade Toolkit

AI-guided, developer-approved upgrades for Adobe Commerce on cloud infrastructure (PaaS).

Use GitHub Copilot or Claude Code to plan upgrade hops, assess compatibility, review fixes,
and prepare deployment. This toolkit is for version upgrades, not Adobe Commerce as a Cloud
Service (SaaS) extension development.

## Prerequisites

| Requirement | Details |
| --- | --- |
| Development environment | macOS or Linux host with Node.js 22+ and npm; on Windows, use WSL. You run setup on the host. Magento, Composer and UCT commands run in your project's existing development environment (Warden, Cloud Docker, Markshust, another Docker setup, or a plain Linux shell), which the agent detects. Native Windows is not supported. |
| Commerce project | An existing local/development checkout on the host with `composer.json` and `bin/magento`, writable by the normal development user, at a path without symbolic links. |
| Coding agent | [GitHub Copilot](https://github.com/features/copilot) or [Claude Code](https://claude.com/claude-code), installed and authenticated. |
| Documentation research | Python 3 with a trusted CA store and curl, available where the coding agent runs research. |
| Compatibility assessment | Working Upgrade Compatibility Tool (UCT), successful required scans and supported normalization. UCT is not required for toolkit installation or planning-only roadmaps. |

Use a local/development environment without production access or credentials. Do not run
setup as root.

## Installation

The toolkit plugin provides `aio commerce upgrade tools-setup`; no separate Commerce CLI
plugin is required.

Run every step in this section in your **host terminal**, not inside the Commerce container.
Nothing is installed in the container: setup only downloads the toolkit from npm and copies
its workflow files into your project folder. See the [setup guide](docs/setup-guide.md) for
where each part runs.

### 1. Check Node.js on the host

```bash
uname -s
node --version
npm --version
```

Confirm Node.js 22+ before continuing.

### 2. Install Adobe I/O CLI

Run each step separately.

**Set the PATH:**

```bash
export PATH="$HOME/.local/bin:$PATH"
```

**Install Adobe I/O CLI into your user's home:**

```bash
npm install --global --prefix "$HOME/.local" @adobe/aio-cli
```

**Verify the installation:**

```bash
aio --version
```

Persist the PATH line in your shell startup file. If `aio` is already installed for this
user, skip installation and verify it with `aio --version`. No `sudo` is needed.

### 3. Install the toolkit plugin

```bash
aio plugins:install @adobe/commerce-upgrade-toolkit
aio commerce upgrade tools-setup --help
```

If the toolkit plugin is already installed for this user, run `aio plugins:update` to get
the latest version, then check that the setup help is available.

### 4. Set up the Commerce project

From the project root on the host, run:

```bash
cd /path/to/commerce/project
ls composer.json bin/magento
aio commerce upgrade tools-setup
```

Skip `cd` if already at the project root. Choose **GitHub Copilot** or **Claude Code** when
prompted.

Setup downloads the toolkit from npm, installs the selected workflows, and verifies their
installed version and integrity. It does not install UCT or change your project's npm
dependencies and lock file.

| Agent | Installed files |
| --- | --- |
| GitHub Copilot | `.github/` instructions, agents, skills and helpers |
| Claude Code | `.claude/` workflows and helpers, plus `CLAUDE.md` |

Continue only after setup reports completion. If it fails, see the
[setup guide](docs/setup-guide.md#troubleshooting).

### 5. Open the project in your coding agent

Open the Commerce project on the host and restart or reload the agent session. The agent
detects your environment (Warden, Cloud Docker, Markshust, another Docker setup, or a plain
Linux shell) and runs `bin/magento`, Composer and UCT commands inside your existing
container, for example through `warden shell --`.

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
