# Skill: remediation-order

## Fix sequencing — enforce strictly in this order

### Tier 1: CRITICAL — fix before anything else
1. DB_SCHEMA_CHANGES
   Reason: schema conflicts block bin/magento setup:upgrade for the entire team.
   No code fixes matter until the database can upgrade.

2. API_CHANGES on interfaces in Api/ or service contracts
   Reason: other custom modules may depend on these interfaces.
   Fix the interface before fixing the implementations that use it.

3. DEPRECATED_CLASS removals (classes that no longer exist)
   Reason: removed classes cause fatal autoload errors at DI compile time.
   Must be resolved before running setup:di:compile in the next step.

### Tier 2: HIGH — fix after all CRITICAL resolved
4. PREFERENCE_CONFLICT (wrong constructor args)
   Reason: preferences with wrong constructor signatures fail at first instantiation.
   Fix after class removals (step 3) since some preferences target removed classes.

5. PLUGIN_INTERSECTION (plugins on removed/renamed methods)
   Reason: DI compile may succeed but plugins silently stop working or throw errors.
   Fix after API changes are resolved (step 2) since some methods were just renamed.

6. Observer/event changes (removed events)
   Reason: removed events mean observer never fires — silent data loss.
   No fatal error but high business impact (orders not processed, etc.).

### Tier 3: MEDIUM — fix after CRITICAL and HIGH complete
7. Template overrides (templates with significant core changes)
   Reason: visual regressions, no fatal. Fix after all blocking issues resolved.

8. Layout handle changes
   Reason: missing blocks cause visual gaps, not crashes.

### Tier 4: LOW — clean up last
9. Deprecation warnings (methods still present, just deprecated)
   Reason: no immediate failure — these become issues in the next major version.

## Module dependency ordering within each tier

Within each severity tier, fix modules in this sequence:
a. Framework-level shared modules (modules that other custom modules depend on)
   → Check: bin/magento info:dependencies:show-modules Vendor_SharedModule
b. Integration modules (external connectors — e.g. serverless/App Builder actions,
   CDP connector, journey-orchestration config, ERP/PIM/OMS sync)
   → These break external data flows if wrong
c. Core business modules (catalog customisations, checkout, order processing)
   → High-traffic, high-impact
d. UI/frontend modules (Hyva components, template overrides, layout XML)
   → Visual regressions, lower urgency
e. Admin modules (grids, forms, reports)
   → Internal-only, lowest urgency for customer-facing impact

## Backlog output format
```
#1  [CRITICAL] DB_SCHEMA        — Vendor_Orders  — db_schema.xml:14             — S
#2  [CRITICAL] API_CHANGES      — Vendor_Catalog — Api/ProductServiceInterface.php:8  — M
#3  [CRITICAL] DEPRECATED_CLASS — Vendor_Payment — Plugin/PaymentPlugin.php:22   — M
#4  [HIGH]     PREFERENCE_CONFLICT — Vendor_Auth — Model/AuthProvider.php:15     — S
#5  [HIGH]     PLUGIN_INTERSECTION — Vendor_Catalog — Plugin/ProductPlugin.php:40 — S
#6  [MEDIUM]   TEMPLATE_OVERRIDE — Vendor_Theme — view/frontend/templates/p.phtml — L
#7  [LOW]      DEPRECATED_CLASS  — Vendor_Misc  — Model/LegacyHelper.php:5       — S
```

Fields: #n, [SEVERITY], type, module, file:line, effort (S/M/L)

## Effort estimates
S (Small, under 1hr): single class swap, minor signature update, one-line config change
M (Medium, half day): constructor refactor, template merge, plugin restructure
L (Large, over half day): new service contract needed, major template rewrite, schema redesign
