# Skill: upgrade-hop-report

Applied by the `commerce-documentation-engineer` agent, dispatched from `/upgrade-hop`
(pre-hop), `/upgrade-hop-execute` (post-hop), and `/upgrade-deploy-prep` (runbook report,
same HTML conventions). Not applied directly by the driving command or by
`commerce-upgrade-analyst` — those hand off their data once analysis/fixes/validation are
done and let the documentation agent own the HTML build.

Generate a self-contained interactive HTML report for a **single hop version** — the
detailed counterpart to the overall roadmap report written by `/upgrade-hop` planning mode.
The roadmap report shows the multi-hop plan at a glance; this report shows everything about
*one* hop: findings by domain, infrastructure, marketplace extensions, hotfix/deferred-item
decisions, and validation outcomes. Two files per hop — pre (plan) and post (result). Write
both using the Write tool.

**Output paths:**
- Pre:  `.claude/reports/hop-{n}-{fromVersion}-{toVersion}-plan.html`
- Post: `.claude/reports/hop-{n}-{fromVersion}-{toVersion}-result.html`

No cost or token-dollar figures appear anywhere in this report. If a metric would require
a $ estimate, omit it — report scope, findings, and decisions instead.

---

## PRE-HOP REPORT

Generate before the fix loop begins for a hop (after `/upgrade-hop {version}` analysis mode).

**Data to collect before generating:**
- Hop number and version transition, plus the boundary reasoning from `hopPlan` in upgrade-state.md
- Raw UCT error/warning counts (`rawErrorCount`, `rawWarningCount`) from the orchestrator's escaped normalizer-produced numeric summary; null means unavailable, never zero. Do not read raw UCT JSON, private scan logs or quarantine-evidence files.
- All findings scoped to this hop, split by domain (Backend, API Contract, Schema, Frontend, Services, Module Decommission) from context/upgrade-findings.md; accepted UCT IDs and `ucaCode` must be corroborated by freshly normalized accepted records (`code`), not raw messages. Include fixed quarantine reasons/counts as unresolved human-review blockers.
- Infrastructure changes required for this hop (services matrix)
- Marketplace/third-party extension compatibility status for this hop
- Deferred items due this hop (`restoreInHop` matches), including any `superseded-by-core` flags awaiting a human decision
- Planned task list (ordered backlog items for this hop)
- Effort tier (no hour or dollar figures)

**HTML structure — pre-hop:**

```
Header bar        — "Hop {n}: {fromVersion} → {toVersion}  |  PRE-HOP PLAN  |  {date}"
Status pill        — PLANNED (blue)
Boundary reason     — one line: why this hop stops here (from hopPlan.reason)

[Summary cards row]
  CRITICAL: {n}  |  HIGH: {n}  |  MEDIUM: {n}  |  LOW: {n}  |  Effort tier: {tier}

[Methodology note — directly under the summary cards, small text]
  "Severity (CRITICAL/HIGH/MEDIUM/LOW) is the analyst's risk classification, not the raw
  UCT tool output. {rawErrorCount} raw UCT errors and {rawWarningCount} raw UCT warnings
  were classified into these buckets — see Tab 2 for the mapping of each finding back to
  its UCT code.
  Counts include unresolved quarantined records; missing counts are shown as unavailable,
  and quarantined findings remain human-review blockers rather than classified safe findings.
  Project commands require approved routine scope in the local/dev non-production host."

[Tabs]
  Tab 1: Planned Tasks         (default active)
  Tab 2: Findings Detail
  Tab 3: Infrastructure
  Tab 4: Marketplace Extensions
  Tab 5: Deferred Items & Decisions
  Tab 6: Risk Flags

Tab 1 — Planned Tasks
  Ordered checklist — one row per backlog item, unchecked:
  [ ] #1  CRITICAL  DEPRECATED_CLASS  Vendor_Payment/Plugin/Pay.php:8  Backend  (M)
  [ ] #2  HIGH      PLUGIN_INTERSECTION  Vendor_Catalog/Plugin/Cat.php:14  Backend  (S)
  ...
  Rows are interactive — click to expand fix approach description.

Tab 2 — Findings Detail
  Filterable table with two independent filter rows:
    Severity filter: ALL / CRITICAL / HIGH / MEDIUM / LOW
    Domain filter:   ALL / Backend / API Contract / Schema / Frontend / Services / Module Decommission
  Columns: # | Severity | UCT Code | Domain | Type | Module | File:Line | Effort | Fix Approach
  UCT Code column traces each classified finding to its freshly normalized accepted ID/code
  and rawSha256 audit reference, without consuming raw diagnostics or quarantine evidence.
  Include unresolved quarantine counts/reasons separately; never omit them or imply a pass.
  Severity column uses colour badge: CRITICAL=red, HIGH=orange, MEDIUM=amber, LOW=blue

Tab 3 — Infrastructure
  Table: Service | Current Version | Required Version | Action
  Highlight rows where action is required (background: light yellow)

Tab 4 — Marketplace Extensions
  One row per third-party composer package assessed by the `marketplace-extension-analysis` skill:

  | # | Package | Current Version | Compatible with {toVersion}? | Status | Marketplace Alternatives (supported thru {toVersion}) | Notes |
  |---|---------|-----------------|-------------------------------|--------|--------------------------------------------------------|-------|

  Status values: COMPATIBLE (green) | NEEDS-UPDATE (amber) | NO-RELEASE (red) | DECISION-PENDING (purple)
  Marketplace Alternatives column lists any packages found by the skill's Step 3
  marketplace query, blank if none found. Populated for NEEDS-UPDATE, NO-RELEASE, and
  ABANDONED rows in particular — this is what a human needs to make the Chunk 6 decision.
  Rows with DECISION-PENDING expand to show the same options presented to the human during
  Chunk 6 of `/upgrade-hop-execute` (remove / replace / fork-and-patch / defer).
  If no third-party packages are affected this hop: green banner "No marketplace extension impact this hop."

Tab 5 — Deferred Items & Decisions (carry-over from previous hops)
  Table of deferred items from prior hops where restoreInHop = this hop:

  | # | Business Function | Type | File | Removed In | Restore Approach | Flag |
  |---|------------------|------|------|-----------|-----------------|------|

  Flag column: blank for a normal restore, or a purple "⚡ SUPERSEDED?" badge when the
  finding analysis suspects targetVersion's core now natively covers what the hotfix
  addressed. This is the exact case where an older-version hotfix may be redundant once
  core absorbs it — flag it for the human, never auto-resolve it.

  If no items due this hop: show green banner "No deferred items due this hop."
  If items exist: show amber banner "N deferred item(s) must be reconciled this hop
  before the test gate will pass — see Step 3b of /upgrade-hop-execute."
  Each row expandable to show the full TODO marker text from code.

Tab 6 — Risk Flags
  List any: needs-security-review findings, manual-required (frontend) findings,
  framework migration required, infra floor changes, encryption key rotation required
  Each flag as a dismissible alert card (visual only — not actually dismissible in static HTML)
```

---

## POST-HOP REPORT

Generate after hop validation passes (after `/upgrade-hop-execute` finishes chunk 6 / post-hop checklist).

**Data to collect before generating:**
- Git log since hop start: `git log --oneline {hopStartSha}..HEAD`
- Files changed: `git diff --stat {hopStartSha}..HEAD`, classified per file into Frontend
  or Backend per the Layer rule in Tab 1 below, to derive the Frontend/Backend files
  changed summary counters
- Findings fixed vs skipped vs manual-required vs superseded-by-core (from upgrade-state.md / upgrade-findings.md)
- Validation results: setup:upgrade, di:compile, PHPCS, PHPUnit, smoke test checklist outcomes
- Every decision made during Step 3b deferred-item reconciliation and Chunk 6 marketplace decisions
- Any session notes added during the hop (from upgrade-state.md)

**HTML structure — post-hop:**

```
Header bar        — "Hop {n}: {fromVersion} → {toVersion}  |  HOP RESULT  |  {date}"
Status pill        — VALIDATED (green) | BLOCKED (red) | PARTIAL (amber)

[Summary cards row]
  Fixed: {n}  |  Skipped: {n}  |  Manual: {n}  |  Superseded: {n}  |  Commits: {n}  |  Files changed: {n}
  Frontend files changed: {n}  |  Backend files changed: {n}

[Tabs]
  Tab 1: Change Log             (default active)
  Tab 2: Findings Status
  Tab 3: Validation
  Tab 4: Deferred Items & Decisions
  Tab 5: Marketplace Extensions
  Tab 6: Test Results
  Tab 7: Notes

Tab 1 — Change Log
  Git commit list (from git log output):
    {sha}  {commit message}  {author}  {date}
  Each commit row expandable to show files changed in that commit.
  Below commit list: aggregated diff stat table, with a Layer column classifying each file
  path so frontend and backend changes are visually distinguishable at a glance:
    File path | +lines | -lines | change type (modified/added/deleted) | Layer

  Layer classification (apply to every row): paths matching `view/**`, `*/web/**`,
  `*/templates/**`, or `app/design/**` → **Frontend**; everything else under `app/code/`
  → **Backend**. Frontend rows get a light-blue row background, Backend rows unstyled —
  makes the split visible without needing to filter.

Tab 2 — Findings Status
  Table showing every finding that was in scope for this hop:
  # | Severity | Domain | Type | Module | File | Status (badge)
  Status badges: FIXED (green) | SKIPPED (grey) | MANUAL-REQUIRED (amber) | SUPERSEDED-BY-CORE (purple) | BLOCKED (red)

Tab 3 — Validation
  Checklist of validation steps with pass/fail status:
  [✓] setup:upgrade completed
  [✓] setup:di:compile — 0 errors
  [✓] PHPCS — 0 errors
  [✓] PHPUnit — 0 failures
  [✓] cache:flush
  [✓] indexer:reindex
  [✓] Storefront loads
  [✓] Admin login succeeds
  [✗] Payment gateway test — {reason if failed}
  ...

Tab 4 — Deferred Items & Decisions
  Two sections:

  Section A — Reconciled this hop (Step 3b decisions):
  | # | Business Function | Flag | Decision | Rationale | Resolution |
  |---|------------------|------|----------|-----------|------------|
  Decision values: confirmed-superseded | still-needed | needs-verification
  Show with purple badge if confirmed-superseded (hotfix removed, core now covers it),
  green badge if restored/replaced, amber if still pending verification.
  If empty: "No deferred items were due this hop."

  Section B — Newly deferred this hop (removals made during fixes):
  | # | Business Function | Type | File | Reason (Finding #) | Restore In Hop | Approach |
  |---|------------------|------|------|--------------------|---------------|----------|
  Show with amber badge per row. If empty: "No business logic deferred this hop."

  Footer alert if any items remain pending across ALL hops:
  ⚠ "{n} deferred item(s) still pending across remaining hops — see upgrade-state.md"

Tab 5 — Marketplace Extensions
  Table of Chunk 6 decisions made this hop:
  | # | Package | Decision | Rationale | Replacement (if any) |
  |---|---------|----------|-----------|----------------------|
  Decision values: removed | replaced | forked-and-patched | deferred-as-tech-debt
  If no decommission decisions were needed this hop: green banner "No marketplace
  extension decisions required this hop."

Tab 6 — Test Results
  Test gate summary with individual result rows:

  | Test              | Status  | Detail                         |
  |-------------------|---------|--------------------------------|
  | PHPCS             | PASS    |                                |
  | PHPStan           | FAIL    | 3 type errors in Vendor_Module |
  | Unit Tests        | PASS    | 47 tests, 0 failures           |
  | DI Compile        | PASS    |                                |
  | UCA Re-scan       | PASS    | 0 new findings                 |
  | API Test          | PASS    | 5 endpoints/queries verified   |
  | Smoke Tests       | PASS    | All 7 core items verified      |
  | Exception Log     | CLEAR   | 0 new CRITICAL entries         |

  API Test row present only when `implementationType` includes `headless` (from
  context/upgrade-state.md `## Project Information`); Smoke Tests row present only when
  `implementationType` includes `luma`/`hyva`. For `implementationType: both`, both rows
  appear.

  Overall gate badge: PASS (green) | BLOCKED (red)
  If BLOCKED: highlight failing rows in red, show detail in expandable section.
  Link to JUnit XML if generated: `.claude/reports/hop-{n}-unit-results.xml`

Tab 7 — Notes
  Session notes from upgrade-state.md for this hop.
  Any decisions made, deferred items, manual actions taken.
```

---

## ASSESSMENT REPORT (`/upgrade-assess`)

Source: `context/upgrade-assessment.json` (must have passed `assess_tools.mjs validate`).
Outputs (same HTML requirements below, plus a Markdown twin with identical chapters):
`.claude/reports/upgrade-assessment-{date}.html` and `.md`. One tab per chapter:
1 Introduction · 2 Code compatibility · 3 Platform and cloud services · 4 Core upgrade ·
5 Third-party modules · 6 Custom modules · 7 Patches · 8 Composer and dependencies ·
9 Complexity and delivery outline (includes risks and branching strategy) ·
10 Open items and client inputs. Show complexity as High/Medium/Small/UNKNOWN badges with
the recorded reason, a summary line under each table, the data-source retrieval table and
the `gaps` list. Never render effort points, hours, durations or costs.

**Print CSS (required for PDF export):** do not set `break-inside: avoid` on whole chapters
(long chapters then jump to a new page and leave blank pages). Use
`section.chapter { border:none; box-shadow:none; }`,
`h2, h3 { break-after: avoid; }`, `table tr, .card, pre { break-inside: avoid; }`,
`thead { display: table-header-group; }` and `@page { size: A4; margin: 14mm; }`.

## HTML REQUIREMENTS (apply to both reports)

- **Self-contained** — no external CDN, fonts, or scripts. All CSS and JS inline.
- **Responsive** — readable at 1280px and on tablet.
- **Print-friendly** — `@media print` hides tab controls, shows all tab content stacked.
- **Colour palette:**
  - CRITICAL: `#dc2626` (red-600)
  - HIGH: `#ea580c` (orange-600)
  - MEDIUM: `#d97706` (amber-600)
  - LOW: `#2563eb` (blue-600)
  - PASS/FIXED: `#16a34a` (green-600)
  - MANUAL / SUPERSEDED-BY-CORE / DECISION-PENDING: `#9333ea` (purple-600)
  - Background: `#f9fafb`, Header: `#1e293b`
- **Tab switching** — vanilla JS `onclick`, no frameworks.
- **Expandable rows** — click row to show/hide detail. Toggle `▶` / `▼` icon.
- **Severity and domain filter buttons** — on findings tables, filter rows client-side via JS; both filters combine (AND).
- **Footer** — "Generated by Adobe Commerce AI Toolkit · /upgrade · {datetime}". On the
  post-hop report only, add a second footer line: "Guardrails applied: deployment-safety ·
  frontend-upgrade-safety · no-core-overrides · websearch-scope · pii-protection" — list
  only the guardrails actually referenced during this hop's execution (per the explicit
  `Apply the ... guardrail` instructions in `upgrade-hop-execute.md` and
  `commerce-upgrade-analyst.md`), making enforcement auditable per hop instead of implicit.

---

## GENERATION INSTRUCTIONS

The `commerce-documentation-engineer` agent follows these steps when generating either report:

1. Collect all required data first (git commands, upgrade-state.md and upgrade-findings.md reads).
2. Build the full HTML string — header, styles, body, script — as one complete document.
3. Write the file using the Write tool to the correct path under `.claude/reports/`.
4. Confirm: "Report written to .claude/reports/hop-{n}-{from}-{to}-{plan|result}.html"

Do NOT stream the HTML to the terminal — write it directly to the file.
Do NOT truncate or summarise the HTML — write the complete document.
Do NOT include any dollar-cost or token-spend figures in either report.
