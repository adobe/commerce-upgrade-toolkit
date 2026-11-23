# Adobe Commerce Upgrade Toolkit

AI-guided, developer-approved upgrades for Adobe Commerce on cloud infrastructure (PaaS).

Use GitHub Copilot or Claude Code to plan upgrade hops, assess compatibility, review fixes,
and prepare deployment. This toolkit is for version upgrades, not Adobe Commerce as a Cloud
Service (SaaS) extension development.

## Prerequisites

| Requirement | Details |
| --- | --- |
| Development environment | Node.js 22+ and npm, either on your host (macOS, Linux, or Windows through WSL) or inside the project's Linux development container. Setup on the host keeps your Commerce container as it is. Magento, Composer and UCT commands run in your project's existing development environment (Warden, Cloud Docker, Markshust, another Docker setup, or a plain Linux shell), which the agent detects. Windows runs through WSL. |
| Commerce project | An existing local/development checkout with `composer.json` and `bin/magento`, writable by the normal development user. If you run setup on the host (Option A), its path must not contain symbolic links. |
| Coding agent | [GitHub Copilot](https://github.com/features/copilot) or [Claude Code](https://claude.com/claude-code), installed and authenticated. |
| Documentation research | Python 3 with a trusted CA store and curl, available where the coding agent runs research. |
| Compatibility assessment | Working Upgrade Compatibility Tool (UCT), successful required scans and supported normalization. Toolkit installation and planning-only roadmaps work without UCT. |

Use a local/development environment without production access or credentials. Run setup
as your normal user.

## Installation

The toolkit plugin provides `aio commerce upgrade tools-setup`; it is the only plugin you
need.

Choose where to run setup. Both options give the same result: setup only downloads the
toolkit from npm and copies its workflow files into your project folder. Use **Option A**
(the host) if you work on macOS or your development container cannot reach npm; use
**Option B** if you prefer to work inside the container. See the
[setup guide](docs/setup-guide.md) for where each part runs.

### Option A: From your host terminal (macOS, Linux or WSL)

Run these in your host terminal. Your Commerce container stays as it is.

**1. Check Node.js**

```bash
node --version
npm --version
```

Confirm Node.js 22+ before continuing.

**2. Install Adobe I/O CLI**

```bash
npm install --global @adobe/aio-cli
aio --version
```

If `aio` is already installed, skip the install and verify it with `aio --version`. If the
install fails with `EACCES`, use the user-home install in Option B step 2 instead of `sudo`.

**3. Install the toolkit plugin**

```bash
aio plugins:install @adobe/commerce-upgrade-toolkit
aio commerce upgrade tools-setup --help
```

If the plugin is already installed, run `aio plugins:update` to get the latest version
first. Plugin versions before 1.0.9 refuse macOS hosts.

**4. Set up the Commerce project**

```bash
cd /path/to/commerce/project
ls composer.json bin/magento
aio commerce upgrade tools-setup
```

Use the project's path on your host, which must not contain symbolic links. Choose
**GitHub Copilot** or **Claude Code** when prompted.

### Option B: Inside the Linux development container

Start your project's development environment, then enter its Linux shell from the host
terminal with your environment's documented command (see the
[setup guide](docs/setup-guide.md#development-shell-commands-for-human-run-steps)).
Run the following **inside that shell**:

**1. Check the shell and Node.js**

```bash
uname -s
node --version
npm --version
```

Confirm `Linux` and Node.js 22+. The container must be able to reach the npm registry.

**2. Install Adobe I/O CLI into your user's home**

```bash
export PATH="$HOME/.local/bin:$PATH"
npm install --global --prefix "$HOME/.local" @adobe/aio-cli
aio --version
```

Persist the PATH line in the user's shell startup file. If `aio` is already installed for
this user, skip installation. No `sudo` is needed.

**3. Install the toolkit plugin**

```bash
aio plugins:install @adobe/commerce-upgrade-toolkit
aio commerce upgrade tools-setup --help
```

**4. Set up the Commerce project**

```bash
cd /path/to/commerce/project/in/container
ls composer.json bin/magento
aio commerce upgrade tools-setup
```

Use the container's path, not a host path such as `/Users/...`. Choose **GitHub Copilot** or
**Claude Code** when prompted. The `aio` home directory often is not persisted across
container rebuilds, so expect to repeat steps 2 and 3 after one.

### What setup does

Setup downloads the toolkit from npm, installs the selected workflows, and verifies their
installed version and integrity. Your project's npm dependencies and lock file stay as they
are, and UCT is set up separately when you need it.

| Agent | Installed files |
| --- | --- |
| GitHub Copilot | `.github/` instructions, agents, skills and helpers |
| Claude Code | `.claude/` workflows and helpers, plus `CLAUDE.md` |

Continue only after setup reports completion. If it fails, see the
[setup guide](docs/setup-guide.md#troubleshooting).

### Open the project in your coding agent

Open the Commerce project and restart or reload the agent session. The agent can run on the
host as long as the installed files are visible in the same checkout. It detects your
environment (Warden, Cloud Docker, Markshust, another Docker setup, or a plain Linux shell)
and runs `bin/magento`, Composer and UCT commands inside your existing container, for
example through `warden shell --`.

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
