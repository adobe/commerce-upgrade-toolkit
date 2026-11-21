---
name: frontend-upgrade-analysis
description: "Systematic analysis of Magento 2 theme override conflicts during an upgrade hop. Produces a prioritised developer review checklist — does NOT auto-apply any changes."
---

# Skill: frontend-upgrade-analysis

Systematic analysis of Magento 2 theme override conflicts during an upgrade hop.
Produces a prioritised developer review checklist — does NOT auto-apply any changes.

---

## When to apply

- Any UCA finding with type: TEMPLATE_OVERRIDE, LAYOUT_OVERRIDE, JS_OVERRIDE
- Any file path under `app/design/` or `app/code/*/view/` flagged by UCA
- At the start of each hop's frontend analysis pass

---

## Step 1 — Collect all frontend findings for this hop

Read `upgrade-state.md` findings table. Select all rows where:
- `type` is one of: `TEMPLATE_OVERRIDE`, `LAYOUT_OVERRIDE`, `JS_OVERRIDE`
- OR `file` path matches `**/view/**`, `app/design/**`
- `status` = `pending` or `manual-required`

Group by category:
- **Template overrides**: `*.phtml` files in `app/design/` or `app/code/*/view/`
- **Layout overrides**: `*.xml` files in `view/*/layout/`
- **RequireJS configs**: `requirejs-config.js` in `view/*/`
- **UI components**: `*.xml` in `view/*/ui_component/`
- **Web assets**: `*.less`, `*.css`, `*.js` in `view/*/web/`

---

## Step 2 — Find corresponding vendor files

For each custom override, locate the vendor file it shadows:

**Theme overrides** (`app/design/frontend/Vendor/theme/`):
```bash
# Custom file: app/design/frontend/Acme/custom/Magento_Catalog/templates/product/view.phtml
# Maps to vendor: vendor/magento/module-catalog/view/frontend/templates/product/view.phtml

# General pattern — strip area + module prefix from design path:
find vendor/magento/ -name "{filename}" -path "*/{module_path}/*" 2>/dev/null
```

**Module view overrides** (`app/code/Vendor/Module/view/`):
```bash
# Custom file: app/code/Acme/Catalog/view/frontend/templates/product/custom.phtml
# These are new files, not overrides — skip vendor lookup, mark as MODULE-OWNED
```

Build a mapping table:
```
custom_file → vendor_file | status
```

---

## Step 3 — Diff custom override vs current vendor

For each template/layout override, run a visual diff:

```bash
diff -u {vendor_file} {custom_override_file}
```

Read both files and produce a structured diff summary:

**Template diff analysis:**
1. Check if the custom file has changed at all from the UCA-flagged version
2. Identify lines in vendor that are functionally new (PHP logic, new variables, new blocks)
3. Identify lines in custom that may now be stale (references to removed classes/methods)
4. Flag any references to classes, methods, or variables that changed in this hop's UCA findings

**Classify each diff:**

| Risk | Condition |
|------|-----------|
| HIGH | Custom override calls a PHP class/method that was removed or renamed in this hop |
| HIGH | Custom override uses a block/viewModel that no longer exists |
| HIGH | Layout override references a container or block removed in toVersion |
| MEDIUM | Template structure changed in vendor — custom may miss new functionality |
| MEDIUM | JS component reference in template points to a module that was changed |
| LOW | Whitespace, comment, or minor string difference |
| INFO | No meaningful difference — override can be reviewed for removal |

---

## Step 4 — Theme inheritance chain validation

Read the custom theme's `theme.xml`:
```bash
find app/design/ -name "theme.xml" | xargs grep -l "parent"
```

For each theme:
```bash
cat app/design/frontend/{Vendor}/{theme}/theme.xml
```

Extract `<parent>` value (e.g. `Magento/luma` or `Magento/blank`).

Verify parent theme still exists and is compatible with `toVersion`:
```bash
ls vendor/magento/theme-frontend-{parent-slug}/
```

Known parent theme changes by version — sanity-check reference only, current as of when
this skill was last updated. Confirm against this hop's actual `knownBreakers` (recorded
during `/upgrade-hop` analysis via `WebSearch`, per the `websearch-scope` guardrail) rather
than assuming these apply; if `toVersion` is newer than the last row below, query
`WebSearch` with
`"Adobe Commerce {toVersion} Luma theme breaking changes"` instead of relying on this list:
- **2.4.4**: Luma still primary; Blank recommended for new projects
- **2.4.6**: No breaking Luma changes
- **2.4.7**: No breaking Luma changes
- **2.4.8**: jQuery upgraded — check for deprecated jQuery methods in custom JS
- **2.4.9**: Check Laminas MVC removal impact on any frontend module controllers

**BLOCKING if:** parent theme package no longer exists in vendor after composer update.
**HIGH if:** parent theme version jumped a major release — re-test inheritance.

---

## Step 5 — RequireJS map and paths scan

Scan all `requirejs-config.js` in vendor for changes that might conflict with custom RequireJS configs:

```bash
# Find all custom requirejs-config.js files
find app/design app/code -name "requirejs-config.js"

# Find all vendor requirejs-config.js for modules that have custom overrides
find vendor/magento -name "requirejs-config.js" -path "*{affected_module}*"
```

For each custom `requirejs-config.js`, read both vendor and custom versions.
Check for:
1. **Aliased modules renamed**: `'Magento_Checkout/js/model/payment'` moved or renamed
2. **Mixins still pointing to valid targets**: mixin targets that no longer exist
3. **Paths pointing to removed files**: any `paths` entry where the target file was deleted

```bash
# Verify each mixin target still exists
for target in {mixin_targets}; do
  find vendor/magento/ app/ -name "{target}.js" 2>/dev/null | head -1
done
```

---

## Step 6 — UI component (KnockoutJS) changes

For each custom `view/*/ui_component/*.xml` override, find the vendor version:
```bash
find vendor/magento -name "{component_name}.xml" -path "*/ui_component/*"
```

Check for:
1. New `<item>` or `<argument>` nodes in vendor not present in custom override
2. `<component>` references that changed JS module paths
3. `sortOrder` conflicts with new vendor components inserted in same position

---

## Step 7 — JS asset scan (web/js/)

Do NOT auto-fix JS files. For each custom `view/*/web/js/*.js`:

```bash
# Check if the corresponding vendor JS file changed (file still exists?)
find vendor/magento/ -name "{filename}.js" 2>/dev/null
```

Flag any custom JS that:
- Calls a JS module that was removed in `toVersion` (check requirejs map)
- Uses jQuery APIs deprecated in `toVersion` (e.g. `.live()`, `.die()`, `.size()` removed in jQuery 3)
- Uses `mage/utils/wrapper` or `mage/storage` APIs that changed

jQuery version by Commerce version — reference only, confirm the actual bundled jQuery
version for `toVersion` via `WebSearch`
(`"Adobe Commerce {toVersion} jQuery version"`) before relying on the deprecated-API list:
| Commerce | jQuery |
|----------|--------|
| 2.4.4–2.4.7 | 3.6.x |
| 2.4.8 | 3.7.x — `jQuery.expr[':']` removed, use `jQuery.expr.pseudos` |
| 2.4.9 | 3.7.x / check changelog |

---

## Step 8 — Generate frontend review package

Produce a structured markdown review package for the developer:

```
## FRONTEND UPGRADE REVIEW — Hop {n}: {fromVersion} → {toVersion}
Generated: {datetime}

### Summary
  Template overrides: {n}   HIGH: {n}   MEDIUM: {n}   LOW: {n}   INFO: {n}
  Layout overrides:   {n}
  RequireJS conflicts: {n}
  UI component diffs: {n}
  JS asset warnings:  {n}

### HIGH — Requires immediate action before hop can be approved
  #{id} TEMPLATE_OVERRIDE — {file}
    Vendor file:   {vendor_path}
    Issue:         {e.g. "calls ProductRepository::getById() — method signature changed in 2.4.6"}
    Action:        {specific fix — e.g. "update argument order on line 42"}
    Core diff:     [diff block]

### MEDIUM — Review before next hop
  #{id} LAYOUT_OVERRIDE — {file}
    Issue:         {e.g. "vendor added new block 'product.info.details.extra' — may need to include in custom layout"}
    Action:        {review and decide whether to include the new block}

### LOW / INFO
  #{id} TEMPLATE_OVERRIDE — {file} — no functional change, consider removing override

### RequireJS
  {list conflicts with before/after}

### Theme Inheritance
  {PASS | BLOCKING | HIGH — with details}

### Manual PR checklist
  [ ] Review all HIGH findings and apply fixes
  [ ] Re-test affected storefront flows after each fix
  [ ] Run static deploy: bin/magento setup:static-content:deploy -f
  [ ] Clear browser cache and test in incognito
  [ ] Check browser console for JS errors on: homepage, category, PDP, cart, checkout
  [ ] Test on mobile viewport (375px)
```

---

## Step 9 — Return proposed state updates and confirm report persistence

For each frontend finding, propose these updates for the approved orchestrator:
- `analysis-complete` — diff produced, developer action required
- Add `frontendRisk: HIGH | MEDIUM | LOW | INFO` column annotation

The read-only frontend persona returns escaped review data and proposed statuses; it never
writes files or claims persistence. The proposed report destination is:
`.github/reports/hop-{n}-{fromVersion}-{toVersion}-frontend-review.md`

Announce on return: "Frontend review package prepared; persistence pending."

The orchestrator obtains separate live approval for the exact report/state diff and destination,
writes only the approved content, and verifies the persisted file matches that content through
the approved source-read gate. Only after a successful write and read-back verification may
the orchestrator announce: "Frontend review package written: {verifiedReportPath}".
A proposed path, returned package, agent claim or stored status is not persistence confirmation.
If approval is missing or writing/verification fails, report persistence as pending or blocked;
do not announce "written", update completion state or mark the report delivered.
