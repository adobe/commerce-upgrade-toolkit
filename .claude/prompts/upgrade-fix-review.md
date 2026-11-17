# Prompt: upgrade-fix-review

## Purpose
Pre-merge checklist for **a single upgrade fix** produced during the FIX phase of
`/upgrade-hop-execute`. Verifies the fix addresses the root cause, follows the
one-finding-one-commit rule, and does not introduce cascading failures. Use with
commerce-developer or commerce-upgrade-analyst agents.

## Prompt template
```
Review this upgrade fix before merging.

Finding ID: {#n from upgrade-state.md}
Severity: {CRITICAL | HIGH | MEDIUM | LOW}
Type: {PLUGIN_INTERSECTION | API_CHANGES | DEPRECATED_CLASS | DB_SCHEMA_CHANGES | ...}
Module: {Vendor_Module}
File: {relative path}
Line: {n}
UCA message: {paste original UCA message}

Fix description: {brief description of what was changed}

--- DIFF ---
{paste git diff for this fix}
--- END DIFF ---

Review checklist:

ROOT CAUSE
- Does the fix address the UCA finding directly, not just suppress the symptom?
- For DEPRECATED_CLASS: is the replacement class the correct modern equivalent,
  not just a random workaround?
- For PLUGIN_INTERSECTION: is the plugin re-targeted to an equivalent method,
  or removed if the behaviour is no longer needed?
- For API_CHANGES: are all call sites updated, not just the one in the diff?
  (grep app/code/ for the old method name to confirm)
- For DB_SCHEMA_CHANGES: does db_schema.xml match the new core table structure
  without data loss risk?

CASCADE RISK
- Does this fix touch a method that other custom code also calls?
  (grep app/code/ for the class/method changed)
- Does it change a public interface in Api/ — if so, flag as potential breaking change
  for any modules that implement it.
- Did DI compile pass after this fix? (must be confirmed before merge)

COMMIT DISCIPLINE (from commerce-upgrade-analyst guardrail)
- Is this fix isolated to one finding? (no unrelated changes in the diff)
- Is the commit message in the format: fix(upgrade): #{id} {type} — {Vendor_Module}?
- Is the finding status updated to "fixed" in upgrade-state.md?

UNIT TEST
- Is there a unit test for the changed behaviour?
- If not: is there a documented reason (e.g. fix is pure wiring/DI change)?
- For CRITICAL findings: unit test is mandatory — no exceptions.

SECURITY (auto-escalate if yes)
- Does this fix touch auth, payment, session, or PII handling? → invoke commerce-security-reviewer
- Does it change a webapi.xml route or ACL resource? → invoke commerce-security-reviewer

Output:
MERGE-READY / REQUEST CHANGES
With: numbered list of issues. Any CRITICAL issue blocks merge.
```
