# Toolkit setup guide

Follow the [README installation steps](../README.md#installation) for the normal setup path.
This guide covers environment-specific setup, updating and troubleshooting.

## Enter the development shell

Start the existing development environment. Run the shell command from the host terminal
at the Commerce project root:

| Environment | Shell command |
| --- | --- |
| Warden | `warden shell` |
| Cloud Docker for Commerce | `./bin/magento-docker bash` if the project provides it; otherwise `docker compose run --rm deploy bash`. |
| Markshust Docker Magento | `bin/bash` |
| Other Docker Compose setups | Use `docker compose ps` to identify the development service, then `docker compose exec <service> bash`. |
| Other Docker setups | Use `docker ps` to identify the development container, then `docker exec -it <container> bash`. |
| Linux without Docker | Use the normal terminal at the Commerce project root. |

Replace placeholders with the actual service/container name. Use `sh` when Bash is
unavailable. Choose a service mounting Commerce source, not a database or cache container.
Project shell helpers can differ; follow your environment's documentation.

Inside that shell, `uname -s` must report `Linux`. Starting Docker or source synchronization
does not itself enter the container. Use the container's project path, not the host path.

## Set up from the host with a temporary Linux container (experimental)

Use this on macOS, or on Windows inside WSL, when Docker is available and you do not want to
enter the project's development container, install Node.js 22 or `aio` there, or persist its
home directory. A temporary Linux container installs the toolkit into your project folder and
is then removed. Your Commerce container is not changed.

Requirements: Docker running, access to the npm registry, and a POSIX shell (macOS Terminal
or WSL). Run from the **host project root**, which contains `composer.json` and `bin/magento`.

```bash
AGENT="GitHub Copilot"   # or "Claude Code"
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  --mount type=bind,source="$PWD",target=/project -w /project node:22-bookworm \
  sh -c 'npm install --prefix /tmp/ccua --no-audit --no-fund --ignore-scripts @adobe/commerce-upgrade-toolkit && node /tmp/ccua/node_modules/@adobe/commerce-upgrade-toolkit/scripts/run-tools-setup.js --agent "$0" --project /project' "$AGENT"
```

It performs the same install or update, version check and integrity verification as
`aio commerce upgrade tools-setup`. Success ends with `Commerce Upgrade Tools setup complete`;
the marker is `.github/context/.ccua-version` (Copilot) or `.claude/context/.ccua-version`
(Claude Code). Then restart your coding agent on the host and run `/upgrade-hop`. To update,
run the same command again.

To pin a release, replace `@adobe/commerce-upgrade-toolkit` in the `npm install` with
`@adobe/commerce-upgrade-toolkit@<version>` and append `--tools-version <version>` to the
setup arguments. Both must match; otherwise the downloaded runner and the installed workflows
can differ.

What the container can reach: only your project folder, mounted read-write, and the network
to download the package. It does not run as root, mounts no home directory or Docker socket,
and downloads with `--ignore-scripts`. Review [security guidance](security-migration.md)
before upgrading.

Scope and limits:

- This covers installing and updating the workflows only. Magento, Composer and UCT commands
  still run in the project's development environment through the container prefix the
  workflow detects.
- The optional encryption-change checker (`check-encryption-changes.mjs`) is Linux-only and
  needs a Linux shell.
- Verified so far on a fixture project; not yet on real Warden, Cloud Docker or Markshust
  projects, nor native Windows PowerShell.
- Linux hosts do not need this: run the normal setup directly.

Feedback is welcome. Report, without credentials or customer code: host OS, Docker version,
environment type (Warden, Markshust, Cloud Docker or other), the setup command you ran, and
the last error lines. Typical issues: file ownership on the mounted folder, a corporate
proxy or CA for npm, or Docker file sharing that excludes the project folder.

## Node.js and user permissions

Check `node --version` and `npm --version` inside the Linux shell. Node.js must be 22+.
Changing Node.js on the host does not change the container runtime.

For Warden, set `NODE_VERSION=22` in the project's `.env` configuration. Exit the container,
run `warden env up -d` from the host, then re-enter with `warden shell` and recheck Node.js.
For Cloud Docker, Markshust or custom images, follow their image-customization instructions.

Use the normal development user with a writable home and Commerce project. Install the CLI
with `npm install --global --prefix "$HOME/.local" @adobe/aio-cli` and add
`export PATH="$HOME/.local/bin:$PATH"` to the user's shell startup file, such as `~/.bashrc`.
Do not use root, `sudo` or system-directory permission changes.

The CLI and plugin live in the container user's home, separately from Commerce source.
Persist that home using the environment's supported configuration or include the tools in
the development image. Otherwise, reinstall after container recreation.
`docker compose run --rm deploy bash` uses a temporary container: keep that shell open through
setup and expect reinstallation next time unless the tools/home are persisted.

## Setup options and verification

Run setup from the Commerce project root inside Linux:

```bash
aio commerce upgrade tools-setup --agent "GitHub Copilot"
```

| Flag | Purpose |
| --- | --- |
| `--agent`, `-a` | `GitHub Copilot` or `Claude Code`; prompts if omitted. |
| `--project`, `-p` | Existing Commerce project; defaults to the current directory. |
| `--tools-version`, `-v` | Exact toolkit version or npm tag; defaults to `latest`. |

Setup verifies the installed version and managed-file integrity before reporting completion.
The installed marker is `.github/context/.ccua-version` for Copilot or
`.claude/context/.ccua-version` for Claude Code. A downloaded package or marker alone is not
proof that setup completed successfully.

For a host-based coding agent, wait until the installed files are visible in the same
bind-mounted or two-way-synchronized checkout, then restart/reload the agent.

## Updating

Re-enter the same Linux development shell as the same user. From the Commerce project root,
rerun setup and select the same agent:

```bash
aio commerce upgrade tools-setup
```

Setup preserves project-owned instructions/state, reports changes to managed files and
rejects downgrades. Restart the coding agent afterward.

To update the CLI plugin itself, run `aio plugins:update` inside that Linux shell. This is
separate from updating the project's installed workflows; rerun setup for those.

## Troubleshooting

| Symptom | Recovery |
| --- | --- |
| `aio: command not found` inside Docker | Install for the container user and put `$HOME/.local/bin` on PATH. Reinstall if the home was not persisted. |
| npm `EACCES` | Use the user-owned installation prefix. Have the environment maintainer resolve incorrect home/cache ownership; do not run setup as root. |
| Node.js is missing or below 22 | Update the development image, recreate/re-enter the container and check the runtime there. |
| Setup command is unrecognized | Install or update the toolkit plugin for the same container user, then check `aio commerce upgrade tools-setup --help`. No separate Commerce CLI plugin is needed. |
| npm download returns `403` or `404` | Check registry/package availability. A private package needs authenticated npm access and the appropriate organization/team permissions. Never commit credentials. |
| Linux `/proc` requirement fails | Enter the Linux development shell. See the [platform requirements](security-linux-publication.md). |
| `composer.json` or `bin/magento` is missing | Select the mounted Commerce project root and the correct development service, not host paths or a database container. |
| UCT is reported missing | Check registered Magento, Composer and reviewed standalone executables before choosing human-run installation. |
| UCT probe/scan/capture fails | Resolve the reported PHP/environment/access/configuration error and rerun approved commands. Installed tooling does not prove successful capture. Do not consume a stale scan. |
| Normalization rejects a UCT schema/diagnostic | Preserve the capture as audit-only evidence. Supply human-sanitized, reviewed fixtures for adapter support; reinstallation is not the remedy. |
| PHP or UCT is not assessed | Review the reason and human-run follow-up. Explicitly incomplete reports retain unavailable counts and do not authorize remediation. |
| Official documentation fetch returns HTTP `403` | Controlled curl fallback verifies TLS and redirects. If it also fails, use the installed reviewed browser/manual-document fallback; never disable TLS verification. |
| A preserved installation cannot be updated | Back up project-owned files and follow the [existing-install guidance](security-migration.md). |

Full compatibility assessment requires successful captures and supported normalization,
including baseline and target UCT evidence for `/upgrade-assess`. Unknown schemas and
quarantined records remain blockers. See the [workflow guide](upgrade-workflow.md).
