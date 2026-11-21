# Adobe Commerce Upgrade Toolkit

AI-guided, developer-approved upgrades for Adobe Commerce on cloud infrastructure (PaaS).

Use GitHub Copilot or Claude Code to plan upgrade hops, analyze compatibility, review fixes, and prepare deployment. This toolkit is for PaaS upgrades, not Adobe Commerce as a Cloud Service (SaaS) extension development.

## Prerequisites

| Requirement | Details |
| --- | --- |
| Node.js and npm | Node.js 22 or later and npm inside the Linux environment where setup runs. |
| Adobe I/O CLI | `aio` with `@adobe/commerce-upgrade-toolkit` version 1.0.1 or later installed as a plugin in that same environment. |
| Commerce project | A local or development checkout of an installed Adobe Commerce PaaS project with `composer.json` and `bin/magento`. |
| Coding agent | [GitHub Copilot](https://github.com/features/copilot) or [Claude Code](https://claude.com/claude-code), installed and authenticated. |
| Linux development environment | Linux with `/proc`, using Warden, Cloud Docker, Markshust Docker Magento, or bare-metal. On macOS or Windows, run setup in a Linux development container; native setup is not supported. |
| Documentation research | Python 3 with a trusted CA store, plus curl for the automatic HTTP 403 fallback, in the environment where your coding agent runs research (which can be the host). |

Use a local or development environment only, without production access or production credentials.

## Installation

The setup command is provided by this toolkit plugin in version 1.0.1 or later.
No separate Commerce CLI plugin is required.

**For Docker-based projects, install and run the CLI inside the Linux container.**
Installing `aio` on your Mac or Windows host does not install it in the container.
Use the project's normal development user, with a writable home directory and
permission to write to the mounted Commerce project; do not run setup as root.

### 1. Enter your development container

Start your existing development environment, then run the appropriate command
**from your host terminal at the project root**:

| Environment | Enter the Linux shell |
| --- | --- |
| Warden | `warden shell` |
| Cloud Docker for Commerce | `./bin/magento-docker bash`, if the project provides this wrapper; otherwise `docker compose run --rm deploy bash`. |
| Markshust Docker Magento | `bin/bash` |
| Other Docker Compose setups | Run `docker compose ps` to identify the development service, then `docker compose exec <service> bash`. Replace `<service>` with the actual service name; use `sh` if Bash is unavailable. |
| Other Docker setups | Run `docker ps` to identify the development container, then `docker exec -it <container> bash`. Replace `<container>` with the actual container name; use `sh` if Bash is unavailable. |
| Linux host without Docker | Use your normal terminal at the Commerce project root. |

Choose a development container that mounts the Commerce source, not a database
or cache container. Shell helpers and service names can vary by project; use
your environment's documented shell command when it differs from these examples.

**Run the remaining installation and setup commands inside this Linux shell.**

```bash
uname -s
node --version
npm --version
```

Expect `Linux` and Node.js `v22.x` or later. If Node.js is missing or older,
configure your development image with Node.js 22+ before continuing.

For Warden, set `NODE_VERSION=22` in the project's `.env` configuration.
Exit the container, run `warden env up -d` from the host terminal, then enter
again with `warden shell` and recheck `node --version`.
For Cloud Docker, Markshust, or custom images, follow that environment's
Node.js/image customization instructions; do not assume the host's Node.js
version is available inside Docker.

### 2. Install the CLI without root permissions

Container users such as Warden's `www-data` often cannot write to npm's default
global directory (for example, `/usr/local/lib/node_modules`). Install into a
user-owned directory instead:

```bash
export PATH="$HOME/.local/bin:$PATH"
npm install --global --prefix "$HOME/.local" @adobe/aio-cli
aio --version
aio plugins:install @adobe/commerce-upgrade-toolkit
```

No `sudo`, root shell, or changes to system-directory permissions are needed.
Add the same `export PATH="$HOME/.local/bin:$PATH"` line to your container user's
shell startup file (for example, `~/.bashrc` for interactive Bash) so `aio` is
available in future shells. If the correct CLI and toolkit plugin are already
installed for this container user, skip reinstalling them.

The CLI and plugin are stored in the container user's home, separately from the
Commerce project. Persist that home through your development environment's
supported configuration if you want installations to survive container
recreation. Otherwise, repeat this step after recreation. Cloud Docker's
`docker compose run --rm deploy bash` creates a temporary container: keep the
same shell open through setup, and expect to reinstall the CLI next time unless
its home is persisted or the tools are included in your development image.

### 3. Set up your Commerce project

```bash
cd /path/to/commerce/project/in/container
ls composer.json bin/magento
aio commerce upgrade tools-setup
```

Use the **container's project path**, not a host path such as `/Users/...`.
If the shell already starts at the Commerce project root, no `cd` is needed.
Both files must exist, and the project must be writable by the container user.

Choose **Claude Code** or **GitHub Copilot** when prompted. Setup downloads the latest toolkit from npm, installs the selected workflows, and verifies the installed version and file integrity. Your project's npm dependencies and lock file are unchanged.

| Agent | Files installed |
| --- | --- |
| GitHub Copilot | `.github/` instructions, agents, skills, and helper files |
| Claude Code | `.claude/` workflows and helper files, plus `CLAUDE.md` |

### 4. Start your upgrade

The toolkit files are written to the mounted Commerce project. With a bind mount
or two-way source synchronization, they are also visible in the host checkout.
Wait for synchronization to finish if your environment uses it.

Your coding agent can remain on the host; it does not need to be installed in
the container just to run setup. Open the same Commerce project in your coding
agent, restart or reload its session, and run:

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

Re-enter the same Linux development environment using the same container user.
Ensure `aio` is on PATH (and reinstall it if the container was recreated without
a persisted home). From the Commerce project root inside that environment,
rerun setup and select the same agent:

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
| Official documentation fetch returns HTTP 403 | The helper automatically retries through controlled curl with TLS verification and validated redirects. Ensure curl is available where research runs. If both clients fail, use the reviewed browser/manual-document fallback in the installed websearch-scope guardrail; never disable TLS verification. |
| `aio: command not found` inside Docker | The host installation is separate. Follow step 2 inside the container and ensure `$HOME/.local/bin` is on PATH. Reinstall if the container home was not persisted. |
| npm reports `EACCES` when installing `aio` | Use the user-owned `--prefix "$HOME/.local"` in step 2, not the system global directory. If the error names your home or npm cache, have your environment maintainer correct that user's home/cache ownership; do not run toolkit setup as root. |
| Node.js is missing or below version 22 | Configure Node.js 22+ in the development container, then recreate/re-enter it and check again. Changing Node.js on the host alone does not change Docker. |
| `commerce upgrade tools-setup` is not recognized | Install or update the toolkit plugin to version 1.0.1 or later for the same container user running `aio`. Version 1.0.0 does not include this command. |
| Setup requires Linux `/proc` | Enter the Linux development shell in step 1; starting Docker or waiting for synchronization does not move your host terminal into it. See the [platform limitation](docs/security-linux-publication.md). |
| `composer.json` or `bin/magento` is missing | Use the container's mounted Commerce project root, not the host filesystem path or a service without the project mounted. |
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
