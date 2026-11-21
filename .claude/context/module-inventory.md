# Module inventory

<!-- Keep this updated. Add new modules here when created with /module-create -->
<!-- Agents check this before creating new modules to avoid duplication -->
<!-- Before trusting ANY row below as real: verify against actual app/code/ and composer.json
     contents first (a Phase 0 step in /upgrade-hop does this automatically). This file is
     seeded with illustrative example rows at project setup time — a core-only project with
     zero custom modules should have all example rows deleted, not left in place looking
     like real inventory. -->

## Custom modules (app/code/)

| Module | Version | Owner | Purpose | PCI scope | Status |
|--------|---------|-------|---------|-----------|--------|
<!-- EXAMPLE ROWS — verify each against actual app/code/ before trusting, delete this whole
     block if this project has no custom modules (a real Adobe Commerce install with zero
     app/code/ customisation is common, not an error).
| Vendor_Base | 1.0.0 | Platform team | Shared utilities, base classes | No | Active |
| Vendor_CustomerAttr | 1.2.0 | Commerce team | Custom customer attributes | No | Active |
| Vendor_OrderWorkflow | 1.5.0 | Commerce team | Order status customisations | No | Active |
| Vendor_PaymentLogger | 1.0.1 | Commerce team | Payment event logging | YES | Active |
| Vendor_CdpConnector | 1.1.0 | Integration team | CDP observer wiring (e.g. Adobe AEP) | No | Active |
| Vendor_SsoAuth | 1.0.0 | Platform team | SSO for admin (e.g. Adobe IMS + Entra) | No | Active |
-->

## Third-party modules (composer require)

| Package | Version | Purpose | Notes |
|---------|---------|---------|-------|
| magento/data-migration-tool | [version] | Upgrade data migration | Dev dependency |
| magento/upgrade-compatibility-tool | [version] | UCA scans | Dev dependency |
| [add your packages here] | | | |

## Deprecated modules (do not add new dependencies)

| Module | Deprecated since | Replacement | Target removal |
|--------|-----------------|-------------|----------------|
<!-- EXAMPLE ROW — delete if this project has no custom modules.
| Vendor_LegacyImport | 2024-01 | Vendor_CdpConnector | Q3 2025 |
-->

## Module dependency graph (simplified)
<!-- EXAMPLE — replace with this project's actual custom-module dependency graph, or delete
     this section entirely if app/code/ has no custom modules.
```
Vendor_Base
    └── Vendor_CustomerAttr
    └── Vendor_OrderWorkflow
    └── Vendor_PaymentLogger (PCI)
    └── Vendor_CdpConnector
    └── Vendor_SsoAuth
```
-->
