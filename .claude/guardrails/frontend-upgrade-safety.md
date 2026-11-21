# Guardrail: frontend-upgrade-safety

## Absolute rule
NEVER modify CSS, LESS, or JS files during an upgrade workflow.
This is a hard stop — no exceptions, regardless of what UCA flags.

## Why
CSS and LESS changes cause visual regressions on the live storefront.
A broken layout or missing style is immediately visible to every user.
Upgrade compatibility fixes are backend concerns — frontend presentation
is out of scope and must go through a separate design-reviewed PR.

## Files that must NOT be touched during upgrade

| Pattern | Examples |
|---------|---------|
| `**/*.css` | `view/frontend/web/css/source/*.css` |
| `**/*.less` | `view/frontend/web/css/source/_module.less` |
| `**/*.js` (non-breaking changes) | `view/frontend/web/js/*.js` |
| `view/*/web/css/**` | All CSS/LESS in any area |
| `app/design/**/web/css/**` | Theme-level CSS overrides |

## What to do instead

When UCA flags a TEMPLATE_OVERRIDE or LAYOUT_OVERRIDE finding:

1. **Flag it** — add a note in upgrade-state.md:
   ```
   status: manual-required
   note: frontend file — must be reviewed by a developer in a separate PR
   ```

2. **Document the delta** — show what changed in core, but do NOT apply the change:
   ```
   Core changed: vendor/magento/module-catalog/view/frontend/templates/product/view.phtml
   Diff: [show the relevant core diff]
   Action needed: developer must manually merge core changes into override
   ```

3. **Never auto-merge** template or layout changes from core into custom overrides.
   The developer must review each change and decide what to keep.

## Enforcement layers

This rule is enforced at two layers, not just as an instruction:
1. **Guardrail (this file)** — read by `commerce-upgrade-analyst.md` before categorization,
   provides the judgment/explanation and the manual-required workflow above.
2. **Permission-level (`.claude/settings.json` → `permissions.deny`)** — `Write(**/*.css)`,
   `Write(**/*.less)`, `Write(**/*.scss)`, `Write(view/*/web/**)`, and
   `Write(app/design/**/web/**)` are denied outright by the harness, regardless of what any
   agent or prompt attempts. This is the hard stop; the guardrail text is the reasoning
   behind it. `.js` files are intentionally not in the deny list — reading JS is required
   for RequireJS map/UI component drift analysis (`frontend-upgrade-analysis` skill), and
   JS *writes* are template-driven fixes gated by the `implementationType` headless check
   in `/upgrade-hop-execute` Chunk 5, not a styling concern.

## Scope of this guardrail

Applies during:
- `/upgrade` fix loop (Phase 5)
- Any commerce-developer task spawned by the upgrade workflow

Does NOT apply to:
- `/dev-feature` — new feature development can touch frontend files
- `/review` — reviewing frontend changes is in scope
- Explicit developer request outside the upgrade workflow

## Finding types this affects

| UCA Type | Action |
|----------|--------|
| TEMPLATE_OVERRIDE | Flag as manual-required, show core diff only |
| LAYOUT_OVERRIDE | Flag as manual-required, show core layout change only |
| JS_OVERRIDE | Flag as manual-required |
| CSS override (if UCA flags it) | Flag as manual-required — never auto-fix |
