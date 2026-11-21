---
description: "NEVER run destructive SQL (DROP, TRUNCATE, DELETE without WHERE) against any environment without explicit developer confirmation showing the environment name"
applyTo: ".magento.env.yaml,.magento/services.yaml,app/etc/env.php,scripts/**"
---

# Guardrail: deployment-safety

## Absolute rules (never violate)
1. NEVER run destructive SQL (DROP, TRUNCATE, DELETE without WHERE) against any
   environment without explicit developer confirmation showing the environment name
2. NEVER write to app/etc/env.php — this file contains credentials
3. NEVER expose environment variables in output, logs, or generated code
4. NEVER run setup:upgrade against production without a maintenance window
5. NEVER commit .env files or any file containing real credentials
6. Agents NEVER execute `encryption:key:change` or `crypt:key:rotate` — human-operated
   only, with exact environment/action review. Auth/payment config edits require exact
   diff/environment approval and security review. Read @.github/instructions/untrusted-data.instructions.md.

## Secret-output deny-list
Never print, echo, quote or write to any file/report/transcript the value of:
`crypt/key`, `db/connection/*/password` (and host/user), `session/redis/password`,
`queue/amqp/password`, `system/default/payment/*/password`, OAuth consumer secrets, admin
integration tokens, or anything from `auth.json` / `.magento.env.yaml`.
Do not use `cat`, `grep`, `sed`, `awk` or `php -r` on `app/etc/env.php` in a way that prints
those fields; check presence only (e.g. `test -f`) or use file-name-only flags (`grep -l`, `-c`).
If a value appears in any output, replace it with `[REDACTED]` before reporting it.
`scripts/check-secret-safety.mjs` enforces this on the toolkit's own docs in CI.

## Scoped routine execution

Apply write-scope's automatic routine profile. After live instance/hop/routine-scope approval,
agents may run authorized discovery, scanning and validation in the local/dev non-production
host. DI compile may run automatically only after its generated-file effects and changed-code
security checks are covered by that approval. Database/schema/data, cache/reindex, package,
infrastructure and deployment actions are outside routine consent and need separate approval.
Production and secret/key operations remain human-only. Command patterns and container
wrappers are not isolation; verify effective host restrictions and never bypass host prompts.

## Environment identification
Before any destructive operation, confirm the environment:
```bash
bin/magento config:show web/unsecure/base_url
# or
echo $MAGENTO_CLOUD_ENVIRONMENT  # on Commerce Cloud
```
If the URL contains "prod", "production", or the live domain → STOP, do not proceed.

## Safe command patterns

READ-ONLY INTENT (still executes project code; approved routine scope required):
```bash
bin/magento config:show web/unsecure/base_url  # reviewed non-secret path only
bin/magento module:status
bin/magento indexer:status
bin/magento cache:status
bin/magento cron:status
```

SAFE WITH CARE (verify environment first):
```bash
bin/magento cache:flush                 # safe, but causes brief performance impact
bin/magento indexer:reindex             # may be slow on large catalogs
bin/magento setup:upgrade --dry-run     # always dry-run first
```

REQUIRE EXPLICIT CONFIRMATION:
```bash
bin/magento setup:upgrade               # runs patches, schema changes
bin/magento setup:di:compile            # may use explicit approved routine/generated-file scope
bin/magento deploy:mode:set production  # changes mode
```

PRODUCTION ONLY — never in automation:
```bash
bin/magento maintenance:enable          # manual step before deploy
bin/magento maintenance:disable         # manual step after deploy
```

## Credential handling
- SSO/IdP client credentials → app/etc/env.php (e.g. imsConfig for Adobe IMS) — never in code
- CDP/journey-orchestration credentials → that integration's own .env (e.g. App Builder
  .env for Adobe AEP/AJO), never in the Commerce codebase
- Database credentials → .magento.env.yaml RELATIONSHIPS (injected by platform)
- Redis/ES credentials → .magento.env.yaml (injected by platform)
- API keys in code → IMMEDIATE security flag, must be moved to env vars

Check @.github/context/integrations.md for which of these actually apply to this project.

## CI/CD safety
- `/upgrade-deploy-prep`'s Step 2 automated pre-deploy checks MUST pass before any production deploy
- Staging deploy must succeed before production deploy is allowed
- Rollback plan must exist before every production deploy
- Never auto-merge to main without passing CI

## Upgrade-specific safety
During upgrade workflow:
- One finding fixed per commit (upgrade-fix enforces this)
- DI compile after every fix (catches cascade failures early)
- No production deploy until /upgrade-validate passes completely
