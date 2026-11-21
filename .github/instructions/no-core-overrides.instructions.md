---
description: "NEVER edit, create, or delete any file under vendor/."
applyTo: "vendor/**"
---

# Guardrail: no-core-overrides

## Rule
NEVER edit, create, or delete any file under vendor/.
This is an absolute rule with no exceptions.

## Why
- vendor/ is managed by Composer and will be overwritten on every `composer install`
- Core edits are invisible to code review, UCA, and upgrade compatibility tools
- They cause upgrade failures and make the codebase unmaintainable

## The correct alternatives

| Desired outcome | Correct approach |
|----------------|-----------------|
| Change method behaviour | Plugin (before/around/after) in di.xml |
| Replace a class entirely | Preference in di.xml (last resort — flag it) |
| Add a constructor argument | VirtualType or new class extending the original |
| Change template output | Template override in app/design/ (not vendor/templates/) |
| Change layout | Layout override in app/design/ (not vendor/view/) |
| Change JS behaviour | RequireJS mixin declared in requirejs-config.js |
| Change CSS | CSS override in your theme, not vendor |
| Fix a core bug | Composer patch (cweagans/composer-patches) |

## Composer patches (for genuine core bugs)
```json
// composer.json
"extra": {
    "patches": {
        "magento/module-catalog": {
            "Fix product URL generation": "patches/MDVA-12345.patch"
        }
    }
}
```
Store patch files in patches/ directory at project root.
Document: issue URL, Magento bug report, why not waiting for official fix.

## Enforcement
- settings.json deny rule: Write(vendor/**) blocks any write to vendor/
- /review command checks git diff --name-only for vendor/ paths
- Any PR touching vendor/ must be rejected immediately
