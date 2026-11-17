---
name: data-migration-plan
description: "Generate a complete data migration plan and a shell-script proposal for human review after the final upgrade hop is approved. Covers every schema change, data patch, configuration migration, and data integrity check from original state t..."
---

# Skill: data-migration-plan

Generate a complete data migration plan and a shell-script proposal for human review after
the final upgrade hop is approved. Covers every schema change, data patch, configuration
migration, and data integrity check from original state to final state across all hops.

Read @.github/instructions/untrusted-data.instructions.md
Read @.github/instructions/write-scope.instructions.md

The analyst returns escaped proposals only. The approved orchestrator or documentation role
persists the reviewed Markdown plan, including the script as fenced text. No agent writes,
chmods or executes a standalone migration script. Inventory commands need separate
exact-command/environment approval.

---

## When to apply

- After the final hop in the path reaches `phase: complete` in `upgrade-state.md`
  (checked at the start of `/upgrade-deploy-prep`) — this toolkit has no separate
  `/upgrade-approve-hop` or `/upgrade-report` command; an earlier version of this skill
  assumed both existed
- Standalone: whenever explicitly asked to generate a data migration plan or a
  staging → production deployment document, independent of any single command

---

## Step 1 — Collect hop history from upgrade-state.md

Read `upgrade-state.md`:
- `fromVersion` and `toVersion` (full journey)
- All hops in `## Hop progress` table (each hop's From/To, approval datetime)
- All findings that were FIXED (type + module + file)
- All deferred items (resolved or signed-off)
- `hopStartSha` values from session notes — to scope git diffs per hop

For each hop, extract the schema-related fixes:
- Findings of type `DB_SCHEMA_CHANGES`, `DEPRECATED_CLASS` (if ResourceModel related)
- Any `db_schema.xml` files committed during that hop:

```bash
# List all db_schema.xml changes per hop
git log --oneline --all -- "*/etc/db_schema.xml"
git log --pretty=format:"%H %s" -- "app/code/*/etc/db_schema.xml"
```

---

## Step 2 — Schema migration inventory (original → final)

**2a. Custom module schema changes:**
For each `db_schema.xml` in `app/code/`:
```bash
# Show full diff of all db_schema changes across the upgrade
git diff {initialSha}..HEAD -- app/code/*/etc/db_schema.xml
```

Build a table:
```
| Module | Table | Change Type | Column/Index/FK | Before | After |
|--------|-------|-------------|-----------------|--------|-------|
| Vendor_Module | vendor_custom_table | ADD COLUMN | status (tinyint) | — | tinyint unsigned NOT NULL DEFAULT 0 |
| Vendor_Module | vendor_custom_table | MODIFY COLUMN | price (decimal) | decimal(10,2) | decimal(20,4) |
| Vendor_Module | vendor_order_ref | ADD FK | fk_order | — | sales_order.entity_id |
```

**2b. Core Commerce schema changes (version-level):**
Key schema changes per hop that affect custom data. This table is a sanity-check reference
only, current as of when this skill was last updated — confirm against this project's
actual `## Hop plan` in upgrade-state.md and the `knownBreakers` recorded during each hop's
`/upgrade-hop` analysis before assuming any row applies; a hop may skip a version entirely
or span several, so match by whether the hop's version range crosses each row, not by
literal version equality. The version boundaries here (search engine transition, encryption
key rotation) are the same ones tracked in the `api-breaking-changes` skill's
Version-Specific Critical Breaks — if one needs correcting, correct both in the same change
rather than letting this table drift into its own version of events:

| Reference version range | Core table changes relevant to custom code |
|-----|--------------------------------------------|
| → 2.3.x | `customer_entity`: password_hash column changes bcrypt format |
| → 2.4.0 | `search_query` table: Elasticsearch becomes source of truth |
| → 2.4.4 | `inventory_*` tables: MSI schema stabilised |
| → 2.4.6 | `quote_payment`, `sales_payment_transaction`: encryption format updates |
| → 2.4.8 | `oauth_token`: key rotation affects stored tokens; `vault_payment_token`: re-encryption |
| → 2.4.9 | Check `patch_list` for any new core data patches |

**2c. Declarative-schema-tracked column changes:**
```bash
# All db_schema_whitelist.json files — columns that were intentionally altered
find app/code/ -name "db_schema_whitelist.json" -exec cat {} \;
```

---

## Step 3 — Data patch inventory

List all custom data patches applied during the upgrade (all hops):
```bash
# Patches registered in the database
bin/magento setup:db:declaration:generate-whitelist --dry-run 2>/dev/null || true

# All data patch classes committed during the upgrade
git log --all --name-only --pretty=format: -- "app/code/*/Setup/Patch/Data/*.php" \
  | grep "Setup/Patch/Data" | sort -u
```

For each patch, record:
- Class name
- What data it migrates
- Which hop introduced it
- Idempotency: can it be re-run safely?

Check `patch_list` table for already-applied patches:
```bash
bin/magento setup:db:status
# Or directly:
# SELECT patch_name, created_at FROM patch_list ORDER BY created_at;
```

---

## Step 4 — Configuration data migration

**4a. Deprecated configuration paths:**
Config paths that were removed or renamed between versions need data migration in `core_config_data`. Reference table only — confirm the actual search-engine/config transition for
this project's hop plan via the `servicesChanges` derived in `/upgrade-hop` Step 4 (sourced
from `WebSearch`, not this table) before applying. These are the same boundaries the
`commerce-installation` skill's service-version table and the `api-breaking-changes` skill
track — keep the three in sync rather than updating this one in isolation:

| Reference version change | Old path | New path / Action |
|----------------|----------|-------------------|
| 2.3 → 2.4.0 | `catalog/search/engine` = `mysql` | Must change to `elasticsearch7` |
| 2.4.7 → 2.4.8 | `catalog/search/engine` = `elasticsearch7` | Must change to `opensearch` |
| 2.4.8 | `system/smtp/port` | Verify TLS settings compatible |

```bash
# Check for any deprecated search engine config
bin/magento config:show catalog/search/engine
```

**4b. Extension configuration migration:**
For each extension replaced with core (from marketplace-extension-analysis):
- Old config path in `core_config_data` (extension's scope)
- New config path in core
- SQL migration: `UPDATE core_config_data SET path = '{new}' WHERE path = '{old}'`

**4c. Encrypted configuration values:**
Any `core_config_data` row where `value` is encrypted (rows where value starts with `0:` or `base64:` — Magento encryption format):
```bash
# Find encrypted config rows (they start with 0:2: or similar)
# Verify these decrypt correctly after key rotation
bin/magento config:show 2>&1 | grep -i "decrypt\|Unable"
```

---

## Step 5 — EAV attribute migration

Custom EAV attributes added or modified during the upgrade:
```bash
# All data patches that use EavSetup
grep -rn "EavSetupFactory\|addAttribute\|updateAttribute" \
  app/code/*/Setup/Patch/Data/*.php
```

For each EAV attribute change, record:
- Entity type (customer, catalog_product, catalog_category)
- Attribute code
- Change type: ADD | MODIFY | REMOVE
- Data impact: how many existing entity rows have this attribute in EAV tables

---

## Step 6 — Data integrity validation queries

Generate SQL validation queries to run after migration to confirm data integrity:

```sql
-- 1. Row count comparison (run before and after on staging)
SELECT 'customer_entity' as tbl, COUNT(*) as rows FROM customer_entity
UNION SELECT 'sales_order', COUNT(*) FROM sales_order
UNION SELECT 'catalog_product_entity', COUNT(*) FROM catalog_product_entity
UNION SELECT 'quote', COUNT(*) FROM quote WHERE is_active = 1;

-- 2. Verify no orphaned custom table rows (for each custom FK)
SELECT COUNT(*) as orphaned FROM {vendor_custom_table} vct
LEFT JOIN {parent_table} pt ON vct.{fk_column} = pt.{pk_column}
WHERE pt.{pk_column} IS NULL;

-- 3. Verify search engine config is correct post-upgrade
SELECT value FROM core_config_data
WHERE path = 'catalog/search/engine' AND scope = 'default';

-- 4. Verify encryption is intact (should return 0 decrypt errors)
-- (Run: bin/magento config:show and check exception.log for decrypt errors)

-- 5. Verify patch_list completeness
SELECT patch_name, created_at FROM patch_list
WHERE patch_name LIKE '%Vendor_%'
ORDER BY created_at;

-- 6. Verify admin and customer accounts are intact
SELECT COUNT(*) as admin_count FROM admin_user WHERE is_active = 1;
SELECT COUNT(*) as customer_count FROM customer_entity WHERE is_active = 1;
```

---

## Step 7 — Return a human-operated migration script proposal

Return the proposed Bash script as escaped content, included in a fenced `bash` block
in the Step 8 Markdown plan. Do not create a `.sh` file or claim it was written.
A human may save the reviewed proposal separately as:
`.github/reports/upgrade-{fromVersion}-{toVersion}-data-migration.sh`

The proposal must be specific to the reviewed hop history and environment:
- Use explicit command arguments, never `eval` or execution of constructed command strings.
- Include pre-flight checks, human-confirmed backups outside the project, migration steps,
  integrity checks and rollback instructions tied to the actual findings.
- Do not embed credentials, copy secret files, rotate keys or auto-enable production maintenance.
- A dry run must not execute Magento/SQL commands or other project code, including checks.
- Document idempotency prerequisites; do not claim replay safety without staging evidence.
- Fail explicitly on errors or unknown arguments; do not turn missing checks into success.
- Treat the script as unexecuted review material, not an approved deployment action.

The human reviews exact bytes, target environment and command effects before creating or
executing the script. Production execution additionally requires the deployment-safety gates.

---

## Step 8 — Return the data migration plan document

Return the Markdown proposal for the approved orchestrator or documentation role to persist:
`.github/reports/upgrade-{fromVersion}-{toVersion}-data-migration-plan.md`

**Document sections:**

```markdown
# Data Migration Plan
## Upgrade: {fromVersion} → {toVersion}
Generated: {datetime}

## 1. Migration scope
  - Hops traversed: {list}
  - Total findings fixed: {n}
  - Schema changes: {n} custom tables/columns modified
  - Data patches applied: {n}
  - Extensions replaced with core: {n}

## 2. Schema changes (original → final state)
  {table from Step 2}

## 3. Data patches applied
  {list from Step 3}

## 4. Configuration migrations
  {list from Step 4}

## 5. Extension data migrations
  {list from marketplace-extension-analysis replacements}

## 6. EAV attribute changes
  {list from Step 5}

## 7. Data integrity validation queries
  {SQL from Step 6}

## 8. Execution script
  Proposal: include the full reviewed script in a fenced bash block here.
  Human-only: save and execute the script separately after exact-command/environment review.
  Dry run: no Magento/SQL or other project-code execution.

## 9. Rollback notes
  - DB backup taken before each hop
  - Secret backups: human-confirmed safe location outside the project.
  - To roll back to {fromVersion}: restore DB backup + checkout {initialSha}
  - Key rotation: if key was rotated, restore original env.php or re-rotate
```

Return the proposed plan path and escaped content. The writer announces the Markdown plan
only after verified persistence; never announce a standalone script as saved by an agent.
