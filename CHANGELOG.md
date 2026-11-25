# Changelog

Release history for `@adobe/commerce-upgrade-toolkit`.

## [Unreleased]

- Treat the credentials that local stacks mount into the PHP container (Warden's host `~/.composer`, its SSH volume and the forwarded SSH agent socket) as ambient developer credentials: they no longer pause or block assessment/hop execution, and the workflow never asks the user to remove them. The approval names them; agents still never read, list or print them, and "host credential exclusions" is clarified to cover the agent's own native tools only.
- Add `composer_probe.py` so the orchestrator can check newer versions of third-party extensions inside the verified container using the ambient Composer keys: fixed read-only `composer outdated|show` queries with `--no-plugins --no-scripts`, filtered environment, validated prefix/tokens, whitelisted escaped output, credential-shaped output withheld, and failures reported by kind only.
- Run UCT once with `--ignore-current-version-compatibility-issues` instead of a baseline plus target pair when the selected executable supports it. `assess_tools.mjs validate` accepts `scanMode: ignore-current-flag` with a null `baselineRun`; the baseline/target diff remains the fallback.
- Add an external PHP 8.4 UCT runner for projects whose own PHP is below UCT 3.x's requirement (for example 2.4.4 on PHP 8.1). `uct_runner.py` runs a standalone UCT in a separate container with no network, dropped capabilities, a read-only root filesystem, the project mounted read-only, only the capture context directory writable, no credential mounts or environment, and a fixed argument allowlist; it is the command argv for `capture_uct.py`. `uctInstallMode: external-runner` and `externalRunnerExitCode` are recognized by the prerequisite classifier. `--ignore-current-version-compatibility-issues` does not lift the PHP requirement; it only filters issues.
- Let the user choose the hop strategy in `/upgrade-hop`'s combined planning review: `risk-based` (the architect's recommendation, default), `single-hop` (one hop to the target, with every infrastructure/framework boundary kept as a prerequisite and a risk warning) or `every-minor`. The choice is saved as `hopStrategy` in `upgrade-state.md` (`~` until chosen, which keeps the plan provisional) and authorizes nothing by itself.
- Add guided next steps: `assess_tools.mjs next-steps` reads fixed non-secret project paths and prints an ordered checklist (stale state files and unfinished scan captures, unset project facts, hop strategy, UCT readiness, outstanding scan) with a single `Next:` action. `/upgrade-hop` and `/upgrade-assess` show it at the start and end of every run, including blocked and provisional runs. The checklist is a selection: the commands ask one structured multi-select question built from the helper's `options` (each marked agent-run, decision or human-run) and carry out the choice in dependency order. A selection is not approval, and human-run items such as stale-file cleanup are shown with exact commands but never executed by an agent. The helper itself only reads; it never runs commands or deletes files.
- Mount the project in the external UCT runner at its own host path (read-only) instead of `/app`, so UCT reports host file names that the normalizer accepts. Previously every finding was quarantined as outside the project root on external-runner scans.
- Give UCT 3.x quarantined records specific reasons (`path-outside-project-root`, `unsupported-code`, `message-does-not-match-template`, `invalid-line-number`, `unsupported-level-or-validation-type`) instead of one generic reason. All remain counted human-review blockers.
- Add `write-scope` "Required approval wording": one confirmation naming the instance, version pair, individual routine commands (now including the `next-steps` helper), ambient mounts, the local/dev attestation and files to write, run before any project command, with each command run on its own. Host permission reviewers deny calls whose approval lacks these.
- Make the `next-steps` helper flag a raw UCT report whose file names start with `/app` (from the old runner mount) as stale and offer the human-run commands to remove it before re-scanning.
- No change to approval, write-scope, encryption or sensitive-action gates; Composer install/update/config/auth, SSH and Cloud CLIs stay outside routine scope.

## [1.0.10]

- Normalize UCT 3.x reports (`{issues, stats}`): accept only `php` issues whose integer code and exact message match a single-symbol class, interface, constant, method or property template from UCT's own catalogue, mapping `CRITICAL`/`ERROR` to `error` and `WARNING` to `warning`. Trailing deprecation text is matched but never stored.
- Keep every other UCT 3.x record quarantined as a counted human-review blocker: DB schema, core-file, PHPCompatibility and multi-symbol codes, unknown fields, unsupported levels, invalid line numbers, conflicting or invalid target versions, and file names outside the project root or failing the source-path policy.
- Report `rawIssueCount` for UCT 3.x captures, and let the change-plan review helper validate UCT 3.x rows (`UCT3_PHP`) alongside the legacy MC-code rows.
- Let the raw-capture helper recognize UCT 3.x artifacts as a valid existing destination instead of rejecting them as unrecognized.
- Document the UCT 3.x format in the `upgrade-uca-scan` skill (Claude Code and GitHub Copilot flavours), including scanning git-checkout projects with `--ignore-current-version-compatibility-issues` so baseline noise from a branch newer than the release is not counted as findings.
- Add normalization, capture and review-helper tests for UCT 3.x accepted, quarantined and out-of-root cases.
- Update dependencies: `@oclif/core` 4.3.1 → 5.1.12 and `fs-extra` 11.3.6 → 11.4.1.
- Update CI and release workflow actions: `actions/checkout` v7, `actions/setup-node` v7, `actions/upload-artifact` v7.0.2, `actions/dependency-review-action` v5.0.1 and `JS-DevTools/npm-publish` v4.
- No change to approval, write-scope, encryption or sensitive-action gates. UCT 3.x diagnostics outside the accepted catalogue remain quarantined; an unrecognized format is never silently downgraded.

## [1.0.9]

- Run toolkit setup and updates natively on macOS hosts: the anchored file-write helper now addresses held directories through macOS volfs (`/.vol/<device>/<inode>`) as it does through `/proc/self/fd` on Linux, keeping the no-follow and held-directory protections and failing closed where the reference does not resolve.
- Document two ways to run setup with the same steps: from the host terminal (a plain `npm install --global @adobe/aio-cli`, nothing installed in the Commerce container) or inside the development container (user-home install). The agent still runs Magento, Composer and UCT commands inside the detected container.
- Keep the temporary Linux container as a documented fallback for projects whose path or filesystem cannot provide the protected writes.
- Check the host after download and report an actionable error for symlinked project paths or unsupported filesystems.
- Run the held-directory race, audit and ancestor-swap tests on macOS as well as Linux.
- macOS support has not had an independent security review; see the platform requirements note. Windows is supported through WSL only.

## [1.0.8]

- Add an experimental host-side setup path that installs or updates the workflows through a temporary Linux container, without entering the project's development container; documented in the setup guide with a feedback checklist.
- Discover allowlisted documentation links from verified official entry pages; distinguish wrong-path 404s from access denials and keep independently approved UCT work separate from documentation gaps.
- Group missing planning inputs and execution prerequisites into clearer checklists with explicit unknown/skip choices.
- Continue provisional in-chat roadmap planning when environment verification, answers or execution permissions are unavailable; keep blocked actions and evidence gaps visible.
- Remove environment/database bootstrapping from roadmap planning and defer unresolved storefront and encryption decisions without inventing defaults.
- Preserve live routine authorization, exact-action review, backups, UCT requirements and sensitive human-operated security gates. Provisional summaries are not production-readiness evidence.

## [1.0.7]

- Compare normalized UCT findings by code, file and strict symbol instead of diagnostic wording or type.
- Detect Composer UCT executables through the shared prerequisite and distinguish missing tools, execution failures and unsupported normalization.
- Require explicit incomplete-report consent after scan failures; retain null unavailable counts and existing blockers.
- Simplify the public README and move detailed setup, updates and troubleshooting into a linked guide.

Release verification is pending reviewed UCT 3.0.28 baseline/target fixtures and live
end-to-end scans. UCT 3.0.28 schema/diagnostic adapters have not been added; unknown formats
remain quarantined.

## [1.0.6]

- Verify UCT prerequisites before scan-dependent assessments and hop reports; keep roadmap planning unchanged.
- Offer human-run installation and explicitly incomplete reports when UCT is unavailable, declined, or fails verification.
- Preserve unavailable counts, quarantine blockers, and hop execution gates.
- Clarify workflow usage and installation, scanning, and report ownership.
- Standardize toolkit-owned report branding across HTML, print/PDF and Markdown while retaining visible evidence gaps and blockers; bundle no corporate assets or presentation dependencies.

## [1.0.5]

- Allow the approved parent to persist reviewed reports when the documentation agent lacks write tools.
- Require report read-back verification before reporting success, linking reports, or converting print HTML.
- Use the installed toolkit version in roadmap reports instead of a hardcoded value.
## [1.0.4]

- Automatically retry Python HTTP 403 documentation failures through controlled curl.
- Preserve TLS verification, URL and redirect checks, and response size limits; record the retrieval method, content hash, and original failure.
- Document research prerequisites and fallback troubleshooting.

## [1.0.3]

- Add explicit SDK read/write tools for the documentation agent while preserving document-only scope.
- Clarify report writing with the available host tool and require successful writes before reporting completion.
## [1.0.2]

- Use an available trusted CA store for documentation retrieval while retaining TLS verification.
- Report HTTP and TLS retrieval failures distinctly.
- Allow reviewed browser/manual-document evidence with official URLs, content hashes, and retrieval methods while preserving URL and redirect checks.

## [1.0.1]

- Add toolkit-owned `aio commerce upgrade tools-setup` with npm download, agent selection, setup/update, and integrity verification.
- Document installation through the toolkit plugin without a separate Commerce CLI release.

## [1.0.0]

- Initial Adobe Commerce PaaS upgrade toolkit for GitHub Copilot and Claude Code.
- Include bundled installers, upgrade planning, UCT analysis, developer-approved remediation, assessments, and deployment preparation.

Licensed under Apache-2.0.
