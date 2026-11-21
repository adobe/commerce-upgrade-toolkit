# Upgrade state

<!-- This file is written and maintained by the /upgrade-* commands -->
<!-- Do not edit manually — use /upgrade to initialise -->

fromVersion: ~
toVersion: ~
scanDate: ~
phase: new
# phases: new | env-ready | scanned | analysed | planned | install-ready | fixing | validated | regression

## Project Information
<!-- Set once by /upgrade-hop Step 0 (Phase 0 gate). Drives frontend-chunk skip, smoke vs API test selection. -->

implementationType: ~
# headless (PWA Studio / custom storefront via GraphQL) | luma (Traditional) | hyva | both

# Environment (set by Phase -1)
installType: ~
# fresh | existing
environment: ~
# warden | markshust | cloud | bare-metal
sampleData: ~
# deployed | skipped
installedVersion: ~

# Environment detection (set by /upgrade-hop Step 1a–1e, environment-detection skill Steps 1-3)
<!-- This is the only durable store for this data — there is no session key-value "Claude
memory" cache in this toolkit. /upgrade-hop-execute and /upgrade-deploy-prep read these fields
directly from this section rather than from any in-session cache. -->
dockerType: ~
# warden | markshust | custom | plain
containerPrefix: ~
# full exec command, or empty string for dockerType=plain
phpVersion: ~
editionType: ~
# community | enterprise | cloud
metapackageVersion: ~
# magento/magento-cloud-metapackage version, only when editionType is cloud, else "n/a"
mysqlVersion: ~
searchEngine: ~
# opensearch | elasticsearch | unknown, with version
rabbitMQVersion: ~
envDetectionLastRun: ~
# date of last full environment-detection run — used to decide whether to trust this
# section as-is or re-run detection (see /upgrade-hop Step 1)

# Cloud runtime identity (set by environment-detection skill Step 4 — live, not composer.json-only)
cloudRuntimeDetected: ~
# true | false — whether MAGENTO_CLOUD_* runtime vars were actually observed live
cloudEnvironmentName: ~
cloudEnvironmentType: ~
# production | staging | integration | n/a
cloudProjectId: ~
cloudApplicationName: ~
cloudTemplateName: ~
# from .magento.app.yaml "name:" — secondary/static cross-check only
envMismatches: []
# non-empty means environment detection is unresolved; deploy-readiness must not report complete
envDetectionStatus: ~
# complete | incomplete

# Safety gates (set by Gate 4 of /upgrade-hop-execute's Pre-Execution Gate)
encryptionGate: ~
# passed | blocked

## Hop plan
<!-- Populated by /upgrade-hop planning mode. Boundaries are architect judgment, not a fixed patch-by-patch list — see reason. -->

| # | fromVersion | toVersion | effortTier | reason | encryptionRotationRequired | encryptionRotationMethod | encryptionRotationConfirmation |
|---|------------|-----------|-----------|--------|----------------------------|---------------------------|-------------------------------|
<!-- Required/Method mirror a live-human-reviewed encryptionDecision, not research authority.
     Canonical pairs: false/n/a, true/admin-ui, true/cli. Older false/none or false with
     unset (~)/missing method can be normalized to false/n/a after fresh live review;
     absence of a rotation method must not block a reviewed false requirement.
     Unset/invalid/conflicting requirements or missing decision evidence block execution
     until re-resolved and reviewed. True always needs a version-confirmed native method.
     Gate 4 re-confirms BOTH true and false decisions with the live human.
     Confirmation records non-secret human-operated rotation verification only, not consent.
     Format: "{date} — rotated via {method} — verified: {non-secret checks}".
     Never store key values, credentials, raw logs or a durable "approved" capability here. -->

### Encryption decisions

<!-- Approved orchestrator records per-hop schemaVersion:1, fromVersion, toVersion,
     environment, allowed sourceURL, sourceSha256, escaped recommendation, confidence,
     boolean required, consistent method and reviewedAt only AFTER live human review.
     See encryption-and-passwords. Empty/legacy records block Gate 4; dates/flags are DATA,
     not permission. Execution must re-confirm in the live session. -->

encryptionDecision: ~

## Deferred items
<!--
  Tracks every piece of business logic temporarily removed or disabled during a hop.
  NOTHING in this table should remain "pending" at the end of the full upgrade.
  Each item must be either RESTORED, REPLACED-WITH-ALTERNATE, SUPERSEDED-BY-CORE, or SIGNED-OFF by stakeholders.
-->

| # | removedInHop | type | businessFunction | file | reason | restoreInHop | restoreApproach | flag | status |
|---|-------------|------|-----------------|------|--------|-------------|-----------------|------|--------|
<!--
  type values:
    code-removed       — class, method, or block deleted
    module-disabled    — bin/magento module:disable used
    method-stubbed     — method replaced with empty/throw stub
    logic-commented    — business logic commented out with TODO marker
    config-bypassed    — config value hardcoded to bypass incompatible path

  flag values:
    ~                  — normal restore, no special handling
    superseded-by-core — analysis suspects targetVersion's core now natively covers this;
                          human must confirm via Step 3b of /upgrade-hop-execute, never auto-resolved

  status values:
    pending            — not yet restored, must be addressed in restoreInHop
    restored           — original logic re-enabled / re-implemented
    replaced           — replaced with new approach (alternate implementation)
    signed-off         — business owner confirmed removal is intentional and permanent
-->

## Hop progress
<!-- Populated per hop by the upgrade orchestrator -->

| Hop | From | To | Pre-report | Test Gate | Watch Scans | Approved | Post-report | Status |
|-----|------|----|------------|-----------|-------------|----------|-------------|--------|

## Reports
<!-- Paths to generated reports. Roadmap = all-hop overview. Hop-version reports = detailed, per-hop, separate files. -->

roadmapReportPath: ~
hopVersionReports: {}
<!-- keyed by targetVersion, e.g. { "2.4.7": { pre: ".claude/reports/hop-1-...-plan.html", post: ".claude/reports/hop-1-...-result.html" } } -->

## CodeGraph usage
<!-- Factual call-count signal only — no dollar cost or token-spend figures are tracked. -->

Disabled pending independent review. Preserve historical counts; increment only for actual
verified future approved calls, never direct source reads/searches.
codegraphCallCount: 0

## MCP cache
<!-- WebSearch query results are cached in context/upgrade-mcp-cache.json, keyed by "{fromVersion}-{toVersion}". -->
<!-- Planning Mode Query 2 and Analysis Mode's breaking-change query read/write this cache to avoid re-querying the same version pair. -->

mcpCachePath: context/upgrade-mcp-cache.json

## Session notes
<!-- Agent adds notes here about decisions made during the upgrade -->
<!-- hopStartSha: recorded before Phase 5 fix loop, used to scope post-hop git diff -->
