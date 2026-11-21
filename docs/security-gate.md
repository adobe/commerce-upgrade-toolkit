# Security gate for AI-generated upgrade code

Root cause: `upgrade-hop-execute` validated AI-generated changes only with functional checks
(DI compile, PHPCS, PHPUnit) and a PHP-token risk helper. Nothing ran SAST over the proposed
code, and no checkpoint tied security-critical changes to a human decision.

## What is implemented

| Control | Where |
|---|---|
| Per-chunk scan + threshold + fail-closed | `.claude/scripts/security_gate.py gate` |
| Human approval for sensitive changes | `security_gate.py approve` (interactive TTY only) |
| Re-check before validation / chunk completion | `security_gate.py verify <plan> --applied` |
| Post-upgrade scan across all hops | `security_gate.py final --plans ...` |
| CI scan of changed files | `security_gate.py changed-scan` in the `Security Scan` job |
| Policy (thresholds, sensitive paths) | `.claude/scripts/security-gate-policy.json` |
| Semgrep rules | `.claude/scripts/semgrep-magento-security.yml` |
| Agent rules | `.claude/guardrails/secure-code-generation.md` (generated to `.github/`) |
| Workflow integration | `.claude/commands/upgrade-hop-execute.md`, `upgrade-deploy-prep.md` |

`.github/*` copies are generated: edit `.claude/*`, then run `npm run generate:github`.

## Scanner

Semgrep (OSS), pinned to `1.97.0` in CI, with the custom rules above. Chosen because it is
open source, needs no credentials or network at scan time (`--config` is a local file, metrics
off), handles PHP, `.phtml` and XML (generic mode), and emits JSON. Morpheus is not assumed.
The scanner command is configurable in the policy (`{rules}` and `{target}` placeholders);
`--scanner-cmd '<JSON argv>'` overrides it for one run and is recorded in the report as
`scannerOverride`. Agents must never use it (see the guardrail).

Install: `python3 -m pip install semgrep==1.97.0`.

Magento Coding Standard security sniffs run in CI only (`.github/security/composer.json`,
`phpcs -e --standard=Magento2` is used to discover the actual `Magento2.Security.*` sniffs;
the job fails if none exist). The dependency is pinned (`magento-coding-standard ^41.0`, platform
PHP 8.3) by the committed `.github/security/composer.lock`; CI runs a lock-based `composer install`
and `phpcs --ignore-annotations`, so source comments cannot suppress sniffs.

Scanner hardening: the default command passes `--disable-nosem` (inline `nosemgrep` comments are
ignored), `--no-git-ignore` and `--max-target-bytes 2000001`, and the gate stages an empty
`.semgrepignore` so default directory exclusions do not apply. The scanner's JSON must include
`paths.scanned`/`paths.skipped`; a staged file reported as skipped (too big, ignored, parse failure)
blocks with `scanner-skipped-input`, missing inventory blocks with `scanner-coverage-unknown`, and any rule-targeted file (`ruleTargetPatterns` in the policy: PHP, PHTML, `webapi.xml`, `di.xml`, `csp_whitelist.xml`) absent from it with `scanner-coverage-empty`/`scanner-coverage-partial`. Files no rule targets (for example `composer.json` or YAML configuration) are scanned but not required in the inventory.
`policySha256` covers the policy **and** the rule pack, so editing either invalidates earlier gate
records and approvals. Removing security-sensitive code is treated as sensitive (before-state is
checked), and `final` requires every contributing record to be accepted with valid approval, every
planned file to exist (last change wins; only a final `after: null` is a deletion), and approved
sensitive files to be unchanged since approval.

## Per-chunk flow (separately approved non-production commands)

1. Plan `review` (existing `review_change_plan.py`), then:
   `python3 .claude/scripts/security_gate.py gate .ccua/review/<plan>.json --project-root .`
2. The gate scans the plan's exact `after` fixtures in an isolated temp copy. It never writes to
   the Commerce tree; it writes only `.ccua/review/security-gate-hop<H>-chunk<C>-<plan>.json`.
3. Exit codes: `0` accepted, `2` blocked, `3` pending human approval, `1` invalid request.
4. Apply the approved patch only after exit 0. Then `verify <plan> --applied` (exit 0 required)
   before `review_change_plan.py verify`, PHPCS, DI compile or tests. Existing functional
   checks are unchanged and still required.
5. A chunk cannot be gated if any earlier chunk of the same hop has a non-accepted latest record
   for any finding. A finding is identified by the plan's reviewed `issue` (`kind` and `id`, shared by
   every change) or, when absent, by its set of file paths; only a retry of the same finding supersedes
   its rejected record, so an unrelated accepted plan in the same chunk cannot hide a blocker.

Deleted paths (`after: null`) are listed, not scanned; a rename is a delete plus an add, so the
new path is scanned. Scannable extensions come from the policy.

## Thresholds

`blockAtOrAbove` in the policy defaults to `HIGH` (CRITICAL always blocks). It may be set to
`MEDIUM` or `LOW` (stricter) but the loader rejects anything weaker than `HIGH`. Severity comes
from rule metadata `ccua_severity` (`CRITICAL|HIGH|MEDIUM|LOW`), falling back to Semgrep
`ERROR→HIGH`, `WARNING→MEDIUM`, `INFO→LOW`. Findings below the threshold are shown, not blocking.

## When a scan fails

Blocking findings, scanner non-zero exit, timeout (`timeoutSeconds`, 300 by default; callers may
only shorten it with `--timeout-seconds`), non-JSON/mis-shaped output, scanner-reported `errors`,
unavailable scanner, or an unaccepted earlier chunk all produce `blocked` (exit 2). The report
includes recovery notes per path: `not-applied`, `applied-rejected` (revert only that file by
hand), or `diverged` (other edits present; do not overwrite). The gate never reverts anything
and never uses `git reset --hard`/`git clean`. A blocked record makes `verify` fail, so the
chunk cannot be marked complete; a corrected proposal needs a new plan.

## Human approval of sensitive changes

A change is sensitive if the plan marks it `sensitive: true`, its path matches the policy
(payment/vault, authentication/authorization, encryption, admin controllers, `acl.xml`,
`webapi.xml`, GraphQL schemas, `di.xml`/`config.xml`/`system.xml`, `app/etc`), or its content
matches (security-class overrides in XML; encryption keys/Vault/ACL references in PHP).

Sensitive + clean scan → `pending-approval` (exit 3). The operator reviews the exact diffs, then in
an interactive terminal runs:
`python3 .claude/scripts/security_gate.py approve <plan> --expected-plan-sha256 <hash>`
and types `APPROVE <first 12 hex of plan hash>`. The command re-scans, refuses to approve a
blocked scan, requires stdin/stdout to be a TTY, and writes
`security-approval-*.json` bound to the plan hash, policy hash and each file hash. Then re-run
`gate`. Missing, piped, cancelled, mistyped or forged records are treated as rejection, and a
clean scan never substitutes for approval. `authorizedOperators` in the policy can restrict
who may approve (matched to the OS user).

## Post-upgrade scan

After the final hop: `security_gate.py final --plans <every hop's plan> --project-root .` re-scans
the current tree for the union of all files in all plans (not stored results), requires every
chunk record to be accepted, writes `.ccua/review/security-final-report.json`, and exits non-zero
if High/Critical findings remain. `/upgrade-deploy-prep` refuses to proceed without an
`accepted` final report.

## CI

Job `Security Scan` in `.github/workflows/ci.yml` (PRs and pushes to `main`, not the nightly
schedule). Read-only token, no `pull_request_target`, pinned action SHAs, base SHA passed through
`env`. It runs Magento2 PHPCS security sniffs on changed PHP/PHTML, then `changed-scan` (Semgrep via
the same policy), fails on High/Critical or any scanner/configuration error, and uploads
`security-report.json` as the `security-report` artifact.

Local run: `python3 .claude/scripts/security_gate.py changed-scan --base origin/main --head HEAD`.

Manual repository step (not done by this change): in GitHub → Settings → Branches (or Rulesets),
add the required status check named **`Security Scan`** to `main`.

## Reading reports

Each finding shows severity, `file:line`, rule id, and remediation. JSON reports contain
`status`, `blockers`, `counts`, `findings`, `sensitive`, `paths`, `deleted` and (on blocks)
`recovery`. Statuses: `accepted`, `blocked`, `pending-approval`.

## Known limitations

- No Psalm taint analysis is configured; none is claimed.
- Rules cover: SQL concatenation/interpolation in query calls, unsafe `unserialize`, code/command
  execution, dynamic and direct `ObjectManager` use, unescaped request data and (medium) unescaped
  getters in `.phtml`, hardcoded credential literals, `_isAllowed(){return true;}`, anonymous
  `webapi.xml` routes, security-class DI preferences/plugins (medium, approval-gated), wildcard CSP
  hosts, inline scripts in templates (medium). Semgrep matching is syntactic: no cross-file taint,
  and ACL on GraphQL, SOAP-only declarations and missing `ADMIN_RESOURCE` are not detected.
- Security-class DI findings are MEDIUM by design: the human approval gate is the control.
- Approval records live in `.ccua/review/`; an agent with write access could forge a file. The
  gate rejects records lacking the plan/policy/file hashes and `interactive: true`, but cannot
  prove a human typed it. Keep agents' write scope away from `security-*.json` and withhold shell.
- The scan sees the proposed files, not the surrounding project; cross-file flows are missed.
- Authenticated scanner adapters: the gate runs the scanner with a filtered environment
  (PATH, HOME, LANG and similar only), so credential variables are **not** forwarded. An adapter
  needing credentials requires a reviewed credential-passing mechanism first.

## Morpheus

Not integrated (no API access assumed). To add it: provide an adapter that accepts the staged
directory and prints Semgrep-shaped JSON (`results`, `errors`; per result `check_id`, `path`,
`start.line`, `extra.severity`, `extra.message`, `extra.metadata.ccua_severity`), then point
`scanner.command` at it. It must also emit `paths.scanned`/`paths.skipped`. Credential passing is not
supported yet (see Known limitations) and must be added and reviewed before an authenticated adapter works. The gate's fail-closed handling then applies unchanged.
