Review deployment-readiness and prepare the deploy runbook for a completed Commerce upgrade.

Read @.claude/guardrails/untrusted-data.md
Read @.claude/guardrails/write-scope.md

## Session orchestration

Run this workflow directly in the current Copilot/Claude session as `orchestrator`.
No custom-agent selection or CLI agent flag is required. Do not stop or request a restart
merely because `commerce-upgrade-analyst` is not selected. This session owns preconditions,
authorized checks, scoped metadata updates and documentation/security specialist dispatch.
`commerce-upgrade-analyst` is optional, not an entry-point prerequisite.
Retain effective host permissions and all non-production, scope and sensitive-action gates.

Assess only the approved local/dev non-production environment. Authorized routine checks run
automatically; outside-scope actions need separate approval. Reports need scoped write approval. Never deploy production
or treat a successful check as deployment permission.

Read @.claude/skills/pci-checklist.md
Read @.claude/guardrails/deployment-safety.md

You are producing the **deploy prep runbook** for a completed upgrade — the final step
after all hops finish, before the developer executes an actual deployment. This command
never runs deploy commands itself; per `deployment-safety.md`'s "PRODUCTION ONLY — never in
automation" rule, deploy actions are explicitly human-owned. This command produces the plan
for the user to execute, not an executed action.

---

## Step 1: Preconditions

Read `context/upgrade-state.md`:
- Confirm every row in `## Hop progress` has `Status = complete`. If any hop is not
  complete: "⚠️ Hop {n} ({from}→{to}) is not complete. Run `/upgrade-hop-execute {to}` to
  finish it before deploy prep." Stop.
- Confirm every row in `## Deferred items` has `status` of `restored`, `replaced`, or
  `signed-off` — none `pending`. If any remain `pending`: "⚠️ {n} deferred item(s) still
  pending — see upgrade-state.md. These must be resolved before deploy." Stop.
- Note `roadmapReportPath` and `hopVersionReports` for linking in Step 4.

## Step 2: Automated Pre-Deploy Checks

Before executing changed project code, obtain separately approved review/verify evidence
from `review_change_plan.py` and the changed-PHP tokenizer. Discover the installed
`Magento2.Security.` sniff family with separately approved `vendor/bin/phpcs -e --standard=Magento2`,
then run the reviewed Magento2 standard including that family. Missing tools/family or
unresolved findings are blocking validation gaps, not a pass. Restricted fixes require
developer effect signoff and security review BEFORE WRITE.

This is a self-contained checklist — earlier drafts of this command deferred to a
`/deploy-check` command that was never carried over from the source repo this toolkit was
extracted from (same class of gap as `no-git-operations`, see `CLAUDE.md`'s Known gap
section). Run these checks directly rather than assuming a `/deploy-check` command exists:

```bash
bin/magento setup:upgrade --dry-run
bin/magento module:status
bin/magento setup:di:compile
git status app/etc/config.php composer.lock
grep -rn "ObjectManager::getInstance" app/code/
grep -rln "password\s*=\s*['\"]" app/code/
```

The password scan uses `-l` (file names only) on purpose: never print, quote or record the
matched line or value. Report only file paths and remediation guidance.

Categorise each result BLOCKING (fails the check outright, e.g. a non-zero exit code, a
dirty `config.php`/`composer.lock`, any `ObjectManager::getInstance` or hardcoded password
match) or ADVISORY (a warning that doesn't itself block deploy, e.g. `module:status` showing
disabled modules that were already signed off in `## Deferred items`).

**Environment identity check:** apply the `environment-detection` skill's Step 4 (or re-read
its cached output if it was run this session) to confirm `cloudRuntimeDetected`,
`cloudEnvironmentName`/`cloudEnvironmentType`, and `envMismatches`. If `envDetectionStatus` (or
the skill's `status`) is `incomplete` — an unresolved field or a non-empty `envMismatches` —
this is BLOCKING: "⚠️ Environment could not be reliably identified: {envMismatches / unknown
fields}. Do not report deploy-readiness against an environment that isn't confirmed." Do not
proceed past this check with a guessed or stale environment identity.

**Patch verification (reuse the `ece-tools-config` skill's procedure, do not re-derive it
here):** apply its Patch Verification section against the current `vendor/` tree. This is
always BLOCKING, never ADVISORY, when it fails — a `vendor/bin/ece-tools`/`composer install`
exit code of 0 during the build hook is not evidence every declared patch actually applied
(see the skill for why). If any patch comes back `missing` or
`partially-applied-or-conflicted`, report it in the same BLOCKING list with package name,
patch title, and reason, and do not proceed to Step 3 until resolved.

## Step 2b: Deploy-Readiness Verdict

State explicitly, before building anything: this project is **deployment-ready** only if both
hold — (1) the environment identity check above resolved with no `unknown` fields and no
`envMismatches`, and (2) every patch in the patch-verification table came back `applied`. If
either is false, print "❌ NOT deployment-ready" with the specific blocking reasons and stop —
do not build a runbook for an environment or patch state that hasn't been confirmed. If both
pass, print "✅ Deployment-ready" and continue to Step 3.

## Step 3: Build the Runbook

Apply `deployment-safety` and `pci-checklist` to produce a **numbered runbook** (not an
executable script — every production step here requires the developer to run it manually):

```
Deploy Runbook — {fromVersion} → {finalToVersion}

1. Schedule a maintenance window. Confirm date/time with stakeholders.
2. [MANUAL] bin/magento maintenance:enable
3. Deploy to staging: {environment-specific deploy command, e.g. magento-cloud push staging}
4. Run staging smoke test checklist (see below). Confirm all pass before continuing.
5. Deploy to production: {environment-specific deploy command}
6. Post-deploy commands (run in order):
   composer install --no-dev
   bin/magento setup:upgrade
   bin/magento setup:di:compile
   bin/magento setup:static-content:deploy -f
   bin/magento indexer:reindex
   bin/magento cache:flush
7. [MANUAL] bin/magento maintenance:disable
8. Run production smoke test checklist (see below).
9. Monitor var/log/exception.log and APM for 30 minutes post-deploy.

Rollback plan (if smoke tests fail after step 8):
- Revert to git tag/branch: {last known-good tag, from git describe --tags --abbrev=0 before hop 1}
- Restore database from the backup taken at Gate 2 of hop 1's `/upgrade-hop-execute` run (see
  upgrade-state.md session notes for backup location/timestamp)
- Re-run bin/magento maintenance:enable during rollback, disable once verified

Smoke test checklist:
{build directly from the final hop's context/upgrade-smoketest-{finalToVersion}.md or
context/upgrade-apitest-{finalToVersion}.md per implementationType — reuse that file's
checklist items as-is, in the same checkbox format the runbook itself uses (see Step 4)}
```

## Step 4: Write Report

Dispatch the `commerce-documentation-engineer` agent to compose the report. Include the
**Document report persistence handoff** from `write-scope`; this session may persist only
the reviewed proposal if the child lacks write tools. Give it the runbook and Step 2 check results; it prepares
`.claude/reports/upgrade-deploy-plan-{date}.html` using the same self-contained HTML
conventions as the `upgrade-hop-report` skill (inline CSS/JS, no CDN dependencies,
checkbox-style checklist for each runbook step, print-friendly). The report must never
contain credential values, matched source lines, or secrets from `env.php`/`auth.json`/
`.magento.env.yaml` — only file paths and remediation guidance.

Verify the saved report by read-back before reporting success or creating links.
If `roadmapReportPath` exists in upgrade-state.md, update its report to add a "Deploy Prep"
link pointing to the newly written deploy plan. This roadmap update can be done directly in
this session.

Print: "Deploy plan saved to .claude/reports/upgrade-deploy-plan-{date}.html — review and
execute manually. This command does not perform any deploy action."
