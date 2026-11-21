# Changelog

Release history for `@adobe/commerce-upgrade-toolkit`.

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
