# Toolkit setup guide

Follow the [README installation steps](../README.md#installation) for the normal setup path:
**Option A** runs from your host terminal, **Option B** from inside the development
container. This guide explains where things run and covers requirements, updating, a
fallback and troubleshooting.

## Where things run

| Component | Runs in |
| --- | --- |
| Adobe I/O CLI, the toolkit plugin and setup | The host (macOS, Linux, or Windows through WSL) for Option A, or the development container for Option B. |
| Coding agent and its upgrade workflows | The host, on the Commerce project folder. |
| Magento, Composer and UCT commands | Your existing development container, through the command wrapper the workflow detects (for example `warden shell --`). |

With Option A your development container stays as it is. Setup downloads an npm package and
copies workflow files into the project folder, so it uses only the host's Node.js, network
access and home directory. The workflow's environment detection
identifies Warden, Markshust, Cloud Docker or a custom Docker setup from `docker ps`, or a
plain Linux shell, and runs `bin/magento`, Composer and UCT commands through the matching
wrapper. It asks for the container only when detection cannot resolve it.

## Host requirements (Option A)

- macOS or Linux with Node.js 22+ and npm. On Windows, use WSL (native Windows is not
  supported).
- The Commerce project folder on the host's filesystem, with `composer.json` and
  `bin/magento`, writable by your normal user. Run setup as that user.
- A project path **without symbolic links** in any parent directory. Setup refuses such
  paths so a swapped link cannot redirect writes. On macOS this means `/var`, `/tmp` and
  `/etc` (system links) and any folder you linked yourself. Use the real path, for example
  `cd -P /path/to/project`, or pass `--project "$(cd -P /path/to/project && pwd)"`.
- On macOS the protected writes use the system's inode-based `/.vol` paths. If your project
  is on a filesystem where they do not resolve (some network or external volumes), setup
  fails closed with an explanatory error; use the [fallback](#fallback-temporary-linux-container)
  or move the project to a local volume.

## Development shell commands (for human-run steps)

Use these for Option B, to enter the container before running
setup, and whenever a workflow asks you to run a command in the development container
yourself, such as installing UCT. Run from the host terminal at the Commerce project root:

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

Check `node --version` and `npm --version` where you run setup (the host for Option A, the
container for Option B). Node.js must be 22+. On the host, install it with your usual
manager (nvm, Homebrew, or your Linux package source). In a container, changing the host's
Node.js does not change the container's runtime; for Warden set `NODE_VERSION=22` in the
project's `.env`, run `warden env up -d`, then re-enter with `warden shell` and recheck. For
Cloud Docker, Markshust or custom images, follow their image-customization instructions.

On the host, a normal global install is enough when your Node.js manager owns the global
directory (nvm, Homebrew, fnm):

```bash
npm install --global @adobe/aio-cli
```

If that fails with `EACCES`, or inside a container, install into your user home instead,
which keeps system directories and permissions untouched:

```bash
export PATH="$HOME/.local/bin:$PATH"
npm install --global --prefix "$HOME/.local" @adobe/aio-cli
```

Add the `export PATH=...` line to your shell startup file, such as `~/.zshrc` or `~/.bashrc`.
Use your normal user with a writable home and Commerce project, and run setup as that user.
In a container the CLI and plugin live in the container user's home, separately from Commerce
source. Persist that home using the environment's supported configuration or include the
tools in the development image; otherwise reinstall after the container is recreated.
`docker compose run --rm deploy bash` uses a temporary container, so keep that shell open
through setup.

## Setup options and verification

Run setup from the Commerce project root, on the host (Option A) or inside the container
(Option B):

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

Update the CLI plugin first, in the same place you ran setup (host or container). Plugin
versions before 1.0.9 refuse macOS hosts and cannot install a newer toolkit there:

```bash
aio plugins:update
```

Then, from the Commerce project root, rerun setup and select the same agent:

```bash
aio commerce upgrade tools-setup
```

Setup preserves project-owned instructions/state, reports changes to managed files and
rejects downgrades. Restart the coding agent afterward. Updating the plugin is separate
from updating the project's installed workflows; rerun setup for those.

## Troubleshooting

| Symptom | Recovery |
| --- | --- |
| `getaddrinfo ENOTFOUND registry.npmjs.org` or another network error | The place where you run setup needs access to npm. If this is the development container (Option B), run setup from the host instead (Option A), which uses the host's network. Otherwise check the host's network, proxy and npm configuration. |
| `aio: command not found` | Open a new shell so the npm global directory or `$HOME/.local/bin` is on PATH, or reinstall the CLI as described above. Inside a container, reinstall if its home was not persisted. |
| npm `EACCES` | Install into your user home with `--prefix "$HOME/.local"` as described above. Fix incorrect home/cache ownership and run setup as your normal user. |
| Node.js is missing or below 22 | Install Node.js 22+ where you run setup and recheck `node --version`. For a container, update its image, recreate it and recheck there. |
| Setup command is unrecognized, or macOS is reported unsupported | Update the plugin with `aio plugins:update`, then check `aio commerce upgrade tools-setup --help`. The toolkit plugin is the only plugin you need. |
| npm download returns `403` or `404` | Check registry/package availability. A private package needs authenticated npm access and the appropriate organization/team permissions. Never commit credentials. |
| `cannot provide the protected file writes setup requires` | The project path contains a symbolic link, or its filesystem does not support the protected writes. Use the real path (`cd -P`), move the project to a local volume, or use the [fallback](#fallback-temporary-linux-container). See the [platform requirements](security-linux-publication.md). |
| `composer.json` or `bin/magento` is missing | Run from the Commerce project root (the host path for Option A, the container path for Option B), not a parent folder or a database container. |
| UCT is reported missing | Check registered Magento, Composer and reviewed standalone executables before choosing human-run installation. |
| UCT probe/scan/capture fails | Resolve the reported PHP/environment/access/configuration error and rerun approved commands. Installed tooling does not prove successful capture. Do not consume a stale scan. |
| Normalization rejects a UCT schema/diagnostic | Preserve the capture as audit-only evidence. Supply human-sanitized, reviewed fixtures for adapter support; reinstallation is not the remedy. |
| PHP or UCT is not assessed | Review the reason and human-run follow-up. Explicitly incomplete reports retain unavailable counts and do not authorize remediation. |
| Official documentation fetch returns HTTP `403` | Controlled curl fallback verifies TLS and redirects. If it also fails, use the installed reviewed browser/manual-document fallback; never disable TLS verification. |
| A preserved installation cannot be updated | Back up project-owned files and follow the [existing-install guidance](security-migration.md). |

Full compatibility assessment requires successful captures and supported normalization,
including baseline and target UCT evidence for `/upgrade-assess`. Unknown schemas and
quarantined records remain blockers. See the [workflow guide](upgrade-workflow.md).
