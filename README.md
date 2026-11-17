# Adobe Commerce Upgrade Toolkit

AI-assisted upgrade planning, compatibility analysis, and interactive hop reports for Adobe Commerce and Magento Open Source projects.

Turn a complex version upgrade into a sequence of reviewable steps. The toolkit helps teams understand upgrade impact, identify compatibility blockers, review remediation, and share self-contained HTML reports throughout the upgrade lifecycle.

## What the toolkit covers

| Capability | What it provides |
| --- | --- |
| Upgrade planning | Identifies the current and target versions and proposes intermediate upgrade hops for review. |
| Compatibility analysis | Uses Upgrade Compatibility Tool (UCT/UCA) findings to identify and classify upgrade issues for each hop. |
| Breaking-change assessment | Reviews affected APIs and replacement patterns against version-specific Commerce references. |
| Extension compatibility | Assesses third-party extension readiness and highlights blockers or compatibility gaps. |
| Frontend impact analysis | Reviews theme overrides and template compatibility, producing a developer review checklist rather than automatically changing frontend assets. |
| Guided remediation | Organizes approved fixes into reviewable work, with validation and resumable execution. |
| Deployment preparation | Produces a readiness assessment and deployment runbook after the upgrade hops are complete. |
| Interactive reporting | Generates standalone HTML documents for the roadmap, individual hops, and deployment preparation. |

## How hop reports are generated

1. **Define the upgrade.** Confirm the Commerce project, current version, target version, and local/development environment.
2. **Review the roadmap.** The toolkit proposes the upgrade sequence and generates an HTML roadmap report.
3. **Analyze a hop.** For the next approved destination version, run compatibility analysis and review upgrade findings, blockers, and recommended work. The toolkit generates a pre-hop report.
4. **Execute approved work.** Review exact changes before applying them. The workflow tracks remediation and validation, then generates a post-hop report recording the outcome and unresolved items.
5. **Repeat and prepare.** Complete the remaining hops, then generate the deployment-preparation runbook. Deferred work must be resolved or explicitly signed off.

Report generation reflects the analysis and validation actually completed. Unknown compatibility, blocked checks, and unresolved findings must remain visible; a generated report is not proof that an upgrade is production-ready.

## Reports you can save and share

| Report | Purpose |
| --- | --- |
| Upgrade roadmap | Review the proposed multi-hop path before starting implementation. |
| Pre-hop report | Understand a hop's compatibility findings, risks, and planned remediation. |
| Post-hop report | Review completed work, validation outcomes, and remaining blockers. |
| Deployment runbook | Review deployment readiness and the human-operated deployment plan. |

Reports are self-contained HTML files with embedded styles and scripts, interactive navigation, collapsible sections, and copyable code blocks. No external CDN dependencies are required to view them.

**Current delivery model:** reports are generated as files in the Commerce project. You can open them in a browser, save a copy, or distribute them through your own approved download channel. This repository does not itself provide a hosted reporting service or public download endpoint.

## Safety and scope

The toolkit supports version upgrades; it is not a general-purpose application builder or an autonomous production deployment service. AI-generated recommendations require developer review.

Run upgrade work only in an approved local/development environment without production access or credentials. Application changes require explicit review and approval. Dependency, database, infrastructure, and other sensitive operations require separate authorization. Production deployment and secret/key operations remain human-operated.

Compatibility analysis and automated validation help identify risk but do not replace project-specific testing, secure backups, or release approval. See the [security guidance](docs/security-migration.md).

## License

Copyright 2026 Adobe. Licensed under [Apache-2.0](LICENSE); see [COPYRIGHT](COPYRIGHT). Third-party components retain their own licenses and notices. Previously distributed MIT-licensed versions retain their original license rights.

The toolkit license does not cover Adobe Commerce or external AI services, grant general Adobe trademark rights, or establish hosted-service terms or support commitments.
