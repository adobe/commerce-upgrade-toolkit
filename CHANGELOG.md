# Changelog

Release history for `@adobe/commerce-upgrade-toolkit`.

## [1.0.8] (unreleased)

- Add an experimental host-side setup path that installs or updates the workflows through a temporary Linux container, without entering the project's development container; documented in the setup guide with a feedback checklist.
- Discover allowlisted documentation links from verified official entry pages; distinguish wrong-path 404s from access denials and keep independently approved UCT work separate from documentation gaps.
- Group missing planning inputs and execution prerequisites into clearer checklists with explicit unknown/skip choices.
- Continue provisional in-chat roadmap planning when environment verification, answers or execution permissions are unavailable; keep blocked actions and evidence gaps visible.
- Remove environment/database bootstrapping from roadmap planning and defer unresolved storefront and encryption decisions without inventing defaults.
- Preserve live routine authorization, exact-action review, backups, UCT requirements and sensitive human-operated security gates. Provisional summaries are not production-readiness evidence.

## [1.0.7] (unreleased)

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
