# Changelog

Release history for `@adobe-commerce/commerce-upgrade-toolkit`.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.0.0]

Initial release of the Adobe Commerce Upgrade Toolkit for AI-guided, developer-approved Adobe Commerce PaaS upgrades.

### Added

- Commerce CLI setup through `aio commerce upgrade tools-setup`, with coding-agent selection, npm download, installation, and verification.
- GitHub Copilot and Claude Code upgrade workflows.
- Upgrade-hop planning and UCT compatibility analysis.
- Breaking-change, extension, and frontend impact assessment.
- Developer-approved remediation with validation and resumable execution.
- Read-only upgrade assessments, local HTML/Markdown reports, and deployment-preparation runbooks.
- Installer API v1, version tracking, and instruction-file integrity verification.
- Shared installation instructions for GitHub and npm.

### Requirements and limitations

- Setup requires a Linux development environment with `/proc`.
- Application changes require developer review and approval.
- Production deployment and encryption-key operations remain human-operated.

Licensed under Apache-2.0.
