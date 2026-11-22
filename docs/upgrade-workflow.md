# Upgrade Workflow — Agent Orchestrator

The current CLI session acts as the `orchestrator` and runs each slash command directly;
no custom-agent selection is required. Specialist agents are dispatched per step.

## UCT prerequisite

`/upgrade-assess <version>` and `/upgrade-hop <version>` share a gate that verifies
registered Magento, Composer and reviewed standalone UCT executables. The no-version
roadmap is exempt. Manual setup is followed by live re-probing; installation alone is
not completed assessment evidence.

Completed scan-dependent reporting requires successful capture and supported normalization;
`/upgrade-assess` requires both baseline and target scans. Tool absence, execution failure
and unsupported normalization need different recovery actions. Continuing incomplete
requires explicit consent, visible **Not assessed** reasons/follow-up and null unavailable
counts. Quarantine blockers and remediation gates remain in effect. See the
[setup and troubleshooting guide](setup-guide.md).

## How to import into LucidChart
1. Open LucidChart → **Insert** → **Import Diagram**
2. Select **Mermaid**
3. Paste the code block below

---

```mermaid
flowchart TD
    Assess(["▶  /upgrade-assess version<br/>Read-only assessment — optional, before planning"]):::command
    Plan(["▶  /upgrade-hop<br/>Planning mode: detect versions, design hops, write state"]):::command
    Analyse(["▶  /upgrade-hop version<br/>Analysis mode: UCT scan, categorise findings, pre-hop report"]):::command
    Execute(["▶  /upgrade-hop-execute version<br/>Per-chunk fixes with approval gates"]):::command
    Deploy(["▶  /upgrade-deploy-prep<br/>Readiness checks and deploy runbook"]):::command

    Assess -. informs .-> Plan
    Plan --> Analyse --> Execute
    Execute -->|"more hops"| Analyse
    Execute -->|"final hop approved"| Deploy

    subgraph AssessSteps["/upgrade-assess"]
        A0["Approval and environment"]:::decision --> A1["Context intake"] --> A2["Collect evidence (read-only)<br/>PHP, UCT diff, services, modules, patches, Composer"]
        A2 --> A3["Classify complexity<br/>High / Medium / Small / UNKNOWN"] --> A4["Write context/upgrade-assessment.json<br/>assess_tools.mjs validate"]
        A4 --> A5["commerce-documentation-engineer<br/>HTML + Markdown reports"]:::report
        A5 --> A6["Human converts to PDF / DOCX"]
    end
    Assess --> A0

    subgraph ExecSteps["/upgrade-hop-execute"]
        E1["State read"] --> E2{"Pre-execution gate"}:::decision
        E2 -->|"blocked"| Stop["Stop with review package"]:::block
        E2 -->|"pass"| E3["Chunk plan and exact-diff approval"]
        E3 --> E4["Services, core upgrade, per-finding fixes<br/>developer, security reviewer, architect"]:::agent
        E4 --> E5["PHPCS, DI compile, tests, security gate"]
        E5 --> E6["Hop completion and post-hop report"]:::report
    end
    Execute --> E1

    %% ── STYLES ────────────────────────────────────────────
    classDef command  fill:#e0e7ff,stroke:#4f46e5,color:#1e1b4b,font-weight:bold
    classDef decision fill:#fef9c3,stroke:#ca8a04,color:#422006
    classDef block    fill:#fee2e2,stroke:#dc2626,color:#7f1d1d,font-weight:bold
    classDef report   fill:#dcfce7,stroke:#16a34a,color:#14532d,font-weight:bold
    classDef agent    fill:#dbeafe,stroke:#2563eb,color:#1e3a5f
```

---

## Agent responsibility map

| Phase | Agent | Responsibility |
|---|---|---|
| Assess | orchestrator + documentation-engineer | Read-only evidence collection, complexity ratings, HTML/Markdown assessment report |
| Plan | orchestrator + upgrade-analyst (optional) | Environment detection, hop design, state file, roadmap report |
| Analyse | orchestrator/DevOps + upgrade-researcher | Approved UCT scan and normalization; read-only research and classification |
| Fix | commerce-developer | Apply live-human-approved exact diffs only |
| Fix (review) | security-reviewer, architect | PCI/auth and structural review before write |
| Fix (frontend) | frontend-developer | Theme override review package; no automatic edits |
| Validate | qa-engineer, devops-engineer | PHPCS, DI compile, tests; infrastructure changes |
| Deploy prep | devops-engineer + documentation-engineer | Readiness verdict and runbook; manual execution |
| Final | upgrade-analyst + orchestrator | Read-only migration proposals; orchestrator persists reviewed Markdown plan; human creates/executes script |

## Security boundaries and migration

Read [Security boundaries and existing-install repair](security-migration.md) before
resuming a preserved installation. Research uses read/web only; modification uses read/edit
only. Scans, helpers, state writes and validations belong to the approved orchestrator/
DevOps/QA. External-derived edits require provenance/version-pair/successor/exact-diff/
environment approval, and execution requires separate exact-command/environment approval.
Normalize raw UCT before TOON/source analysis; unknown records remain counted review blockers.
CodeGraph is disabled by default and `--skip-codegraph` keeps it disabled. Explicit
`--enable-codegraph` fails closed before subprocesses, registration or indexing because
independently reviewed activation artifacts do not exist. Setup, flavour switching and
updates reconcile recognizable legacy entries in both workspace MCP formats, even on a
same-version update, without touching home/global registrations or user root instructions.
Use direct read/search on normalized existing project-contained non-symlink paths and
strict symbols to verify evidence, callers and blast radius. Future approved MCPs are
optional UNTRUSTED optimizations; corroborate security-sensitive proposals by direct reads.
Preserve quarantine counts/gates and exact-action approvals. Count only actual verified
future approved MCP calls, never reads. See `docs/security-migration.md` for manual repair
and the pending reviewed version/hash/transitive lock, provenance, signed catalog/proxy
and real OS sandbox requirements.
Allowed web sources and all caches remain untrusted, never authorization.

## Command reference

| Command | When to use |
|---|---|
| `/upgrade-assess <version>` | Read-only Upgrade Assessment report (HTML + Markdown); complexity High/Medium/Small, no effort numbers |
| `/upgrade-hop` | Planning mode: detect versions, design the hop path, write `upgrade-state.md`, roadmap report |
| `/upgrade-hop <version>` | Analysis mode: UCT scan, categorise findings, pre-hop report |
| `/upgrade-hop-execute <version>` | Execute one hop; resumable via `--chunk=N` |
| `/upgrade-deploy-prep` | Readiness checks and the post-upgrade deploy runbook (manual execution, no auto-deploy) |
