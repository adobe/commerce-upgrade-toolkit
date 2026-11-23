# Toolkit setup guide

Follow the [README installation steps](../README.md#installation) for the normal setup path.
Everything in them runs from your **host terminal**. This guide explains where things run
and covers requirements, updating, a fallback and troubleshooting.

## Where things run

| Component | Runs in |
| --- | --- |
| Adobe I/O CLI, the toolkit plugin and setup | The host (macOS, Linux, or Windows through WSL). |
| Coding agent and its upgrade workflows | The host, on the Commerce project folder. |
| Magento, Composer and UCT commands | Your existing development container, through the command wrapper the workflow detects (for example `warden shell --`). |

Nothing is installed in the development container. Setup only downloads an npm package and
copies workflow files into the project folder, so it does not need that container's Node.js,
network access or home directory. The workflow's environment detection identifies Warden,
Markshust, Cloud Docker or a custom Docker setup from `docker ps`, or a plain Linux shell,
and runs `bin/magento`, Composer and UCT commands through the matching wrapper. It asks
for the container only when detection cannot resolve it.

## Host requirements

- macOS or Linux with Node.js 22+ and npm. On Windows, use WSL (native Windows is not
  supported).
- The Commerce project folder on the host's filesystem, with `composer.json` and
  `bin/magento`, writable by your normal user. Do not run setup as root.
- A project path **without symbolic links** in any parent directory. Setup refuses such
  paths so a swapped link cannot redirect writes. On macOS this means `/var`, `/tmp` and
  `/etc` (system links) and any folder you linked yourself. Use the real path, for example
  `cd -P /path/to/project`, or pass `--project "$(cd -P /path/to/project && pwd)"`.
- On macOS the protected writes use the system's inode-based `/.vol` paths. If your project
  is on a filesystem where they do not resolve (some network or external volumes), setup
  fails closed with an explanatory error; use the [fallback](#fallback-temporary-linux-container)
  or move the project to a local volume.

## Development shell commands (for human-run steps)

The setup steps do not need these. Use them when a workflow asks you to run a command in
the development container yourself, such as installing UCT. Run from the host terminal at the
Commerce project root:

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
Project shell helpers can differ; follow your environment's documentation. Use the
container's project path, not the host path, for commands run inside it.

## Fallback: temporary Linux container

Use this only if host setup fails because your project's filesystem or path cannot provide
the protected writes (see Host requirements) and you cannot change it. A temporary Linux
container installs the toolkit into your project folder and is then removed. Your Commerce
container is not changed.

Requirements: Docker running, access to the npm registry, and a POSIX shell. Run from the
**host project root**, which contains `composer.json` and `bin/magento`.

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

- This covers installing and updating the workflows only.
- The temporary container is Linux, so it avoids the macOS `/.vol` requirement entirely.
- Verified so far on a fixture project; not yet on real Warden, Cloud Docker or Markshust
  projects.

Feedback is welcome. Report, without credentials or customer code: host OS, Docker version,
environment type (Warden, Markshust, Cloud Docker or other), the setup command you ran, and
the last error lines. Typical issues: file ownership on the mounted folder, a corporate
proxy or CA for npm, or Docker file sharing that excludes the project folder.

## Node.js and user permissions

Check `node --version` and `npm --version` on the host. Node.js must be 22+; install it with
your usual manager (nvm, Homebrew, or your Linux package source).

Use your normal user with a writable home and Commerce project. Install the CLI into your
home without `sudo`:

```bash
export PATH="$HOME/.local/bin:$PATH"
npm install --global --prefix "$HOME/.local" @adobe/aio-cli
```

Add the `export PATH=...` line to your shell startup file, such as `~/.zshrc` or `~/.bashrc`.
Do not use root, `sudo` or system-directory permission changes. The CLI and plugin live in
your host home directory, separately from Commerce source.

## Setup options and verification

Run setup from the Commerce project root on the host:

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

The agent runs on the host, so it sees the installed files immediately. Restart or reload
the agent session after setup.

## Updating

Update the CLI plugin first. Plugin versions before 1.0.9 refuse macOS hosts and cannot
install a newer toolkit there:

```bash
aio plugins:update
```

Then, from the Commerce project root on the host, rerun setup and select the same agent:

```bash
aio commerce upgrade tools-setup
```

Setup preserves project-owned instructions/state, reports changes to managed files and
rejects downgrades. Restart the coding agent afterward. Updating the plugin is separate
from updating the project's installed workflows; rerun setup for those.

## Troubleshooting

| Symptom | Recovery |
| --- | --- |
| `getaddrinfo ENOTFOUND registry.npmjs.org` or another network error | Setup runs on the host, so check the host's network, proxy and npm configuration. A development container that cannot reach npm no longer matters for setup. |
| `aio: command not found` | Put `$HOME/.local/bin` on PATH and open a new shell, or reinstall the CLI as described above. |
| npm `EACCES` | Use the user-owned installation prefix. Fix incorrect home/cache ownership; do not run setup as root. |
| Node.js is missing or below 22 | Install Node.js 22+ on the host and recheck `node --version`. |
| Setup command is unrecognized, or macOS is reported unsupported | Update the plugin with `aio plugins:update`, then check `aio commerce upgrade tools-setup --help`. No separate Commerce CLI plugin is needed. |
| npm download returns `403` or `404` | Check registry/package availability. A private package needs authenticated npm access and the appropriate organization/team permissions. Never commit credentials. |
| `cannot provide the protected file writes setup requires` | The project path contains a symbolic link, or its filesystem does not support the protected writes. Use the real path (`cd -P`), move the project to a local volume, or use the [fallback](#fallback-temporary-linux-container). See the [platform requirements](security-linux-publication.md). |
| `composer.json` or `bin/magento` is missing | Run from the Commerce project root on the host, not a parent folder or a database container. |
| UCT is reported missing | Check registered Magento, Composer and reviewed standalone executables before choosing human-run installation. |
| UCT probe/scan/capture fails | Resolve the reported PHP/environment/access/configuration error and rerun approved commands. Installed tooling does not prove successful capture. Do not consume a stale scan. |
| Normalization rejects a UCT schema/diagnostic | Preserve the capture as audit-only evidence. Supply human-sanitized, reviewed fixtures for adapter support; reinstallation is not the remedy. |
| PHP or UCT is not assessed | Review the reason and human-run follow-up. Explicitly incomplete reports retain unavailable counts and do not authorize remediation. |
| Official documentation fetch returns HTTP `403` | Controlled curl fallback verifies TLS and redirects. If it also fails, use the installed reviewed browser/manual-document fallback; never disable TLS verification. |
| A preserved installation cannot be updated | Back up project-owned files and follow the [existing-install guidance](security-migration.md). |

Full compatibility assessment requires successful captures and supported normalization,
including baseline and target UCT evidence for `/upgrade-assess`. Unknown schemas and
quarantined records remain blockers. See the [workflow guide](upgrade-workflow.md).
