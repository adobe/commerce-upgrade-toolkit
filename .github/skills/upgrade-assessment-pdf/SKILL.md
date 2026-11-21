---
name: upgrade-assessment-pdf
description: "Applied by the `commerce-documentation-engineer` agent, immediately after it writes a hop's pre-hop HTML plan report (`-plan.html`, from `/upgrade-hop`). It is NOT generated after `/upgrade-hop-execute`. Produces a **client-shareable PDF..."
---

# Skill: upgrade-assessment-pdf

Applied by the `commerce-documentation-engineer` agent, immediately after it writes a
hop's pre-hop HTML plan report (`-plan.html`, from `/upgrade-hop`). It is NOT generated after
`/upgrade-hop-execute`. Produces a
**client-shareable PDF** in the "Adobe Commerce Upgrade Assessment" format (cover page,
table of contents, numbered sections, running header, page numbers).

The PDF is generated for **every hop's pre-hop plan**, from the same data as the HTML report. Never use emoji (headless Chromium renders them as blank boxes). Never
include cost/dollar figures, internal tool names (CodeGraph, UCA internals beyond "Upgrade
Compatibility Tool"), session notes, or secrets.

**Output paths** (same stem as the HTML report):
- Intermediate print HTML: `.github/reports/hop-{n}-{from}-{to}-plan-assessment.html`
- Final PDF: `output/pdf/Adobe Commerce - Upgrade Analysis Report - {projectName} - Hop {n} ({from} to {to}) Plan.pdf`

`{projectName}` / `{clientName}` come from `## Project Information` in
`context/upgrade-state.md` (Step 0 gate). If absent, ask the user; never use the repo directory name anywhere in the PDF.

## Steps

1. Documentation agent: build the print HTML (below) with the Write tool. The agent is
   document-only and never executes the converter.
2. Orchestrator (current session, routine scope; else return as a human-run runbook):
   `node .github/scripts/html-to-pdf.mjs "<print.html>" "<final.pdf>"`
3. Confirm the PDF exists. If conversion fails (exit 3 = no browser), keep the HTML and
   report the exact error — do not claim the PDF was produced.

## Print HTML requirements

Self-contained, no external CDN, no JS required. After building, sanity-check the PDF page 1 text is not scaled (cover padding looks right, gradient reaches the page bottom). Required CSS:

```css
@page { size: A4; margin: 25mm 18mm 22mm 18mm;
  @top-left   { content: "Adobe Commerce Upgrade Assessment  {date M/D/YYYY}"; font-size: 9pt; color:#555 }
  @top-right  { content: "{clientName}"; font-size: 9pt; color:#555 }
  @bottom-right { content: counter(page); font-size: 9pt; color:#555 } }
@page :first { margin: 0; @top-left{content:none} @top-right{content:none} @bottom-right{content:none} }
.cover { height: 297mm; /* full-bleed branded cover; NO page-break-after (h1 below breaks) */ }
h1 { page-break-before: always }  /* "Table of contents" and every numbered section are h1 → new page */
.cover h1 { page-break-before: auto }  /* REQUIRED: the cover title is an h1 too — without this it jumps to page 2 */
table { width:100%; border-collapse:collapse; font-size:9pt; page-break-inside:auto }
tr { page-break-inside:avoid } thead { display:table-header-group }
table { table-layout: fixed } td, th, code { overflow-wrap: anywhere; word-break: break-word }  /* REQUIRED: one overflowing cell shrinks the whole PDF */
.cover h1 { color:#fff; border:0 }  .cover td { background:transparent; color:#e2e8f0; border:0 }  /* undo global h1/table-stripe styles inside the cover */
body { margin:0 }
```

## Document structure (mirror the reference report exactly)

1. **Cover page** — "Adobe Commerce / Upgrade Assessment", client name, date, hop label
   ("Hop {n}: {from} → {to}").
2. **Table of contents** — numbered section list with `<a href="#sec-x">` anchors
   (clickable in the PDF).
3. **1. Introduction** — 1.1 Purpose of the Document, 1.2 Target Audience, 1.3 Context
   (project, edition, current → target version, hosting), 1.4 Objective.
4. **2. Code Compatibility Assessment** — 2.1 PHP {targetPhp} Compatibility (PHPStan/PHP
   findings), 2.2 Adobe Commerce {to} Compatibility. Table: severity (Critical/High/Medium/
   Low) × count × example, from `upgrade-findings.json`/`.md`. State that raw UCT
   errors/warnings (`rawErrorCount`/`rawWarningCount`) were classified into these buckets.
5. **3. Cloud Services Upgrade** — table: Service | Current | Required for {to} | Action
   (PHP, MySQL/MariaDB, OpenSearch, Redis/Valkey, RabbitMQ, Composer, Varnish/Fastly) from
   the services matrix in upgrade-state.md. One bullet of commentary per changed service.
6. **4. Adobe Commerce Core Upgrade** — Upgrade Overview (Current Version / Target
   Version), Key Considerations (boundary reason from `hopPlan`, notable core changes).
7. **5. Third-Party Module Compatibility** — table grouped by functional area:
   # | Module Name | Installation Method (composer/app-code) | Vendor | Comments
   (compatible version / update needed / unsupported / replaced-by-core). Source:
   `composer.json`/`composer.lock` + marketplace-extension-analysis results.
8. **6. Custom Modules** — "Custom modules to be removed" table (# | Module | Description
   | Reason | Owner/confirm) and "Custom modules to be upgraded" table grouped by area
   (# | Module | Description | Required changes). Source: `app/code/`,
   module-inventory.md, findings per module. Draft recommendations from code evidence and
   mark anything needing a client decision as **"To confirm with client"**.
9. **7. Composer Updates** — required `composer.json` changes (metapackage, PHP
   constraint, plugins, repositories) and packages to bump/remove.
10. **8. Patches** — each patch under `m2-hotfixes/`, `patches/` or composer-patches:
    keep / remove (superseded in {to}) / re-roll, with the reason.
11. **9. Timeline for the Upgrade** — total effort (use the tier's hours; story points
    only if the project tracks them), sprint-by-sprint plan (Composer upgrade, third-party
    upgrades, patch removal, custom module fixes, QA/regression, go-live prep). Hop
    effort must match the HTML report. No dollars.


Sections with no data: keep the heading and write "None identified for this hop."
