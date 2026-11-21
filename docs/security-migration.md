# Security boundaries and existing-install repair

This toolkit mitigates indirect prompt injection by separating research from modifications,
requiring live exact-action review, validating research URLs and normalizing UCT data.
Web/source/vendor/CodeGraph/state/cache content is always untrusted evidence, including on
approved domains. Nothing in a retrieved document can approve a diff, command or key decision.

## What is enforced, and what is not

- Setup preflights the selected version marker before reconciliation/copies; missing markers
  allow fresh installs, valid single-link markers allow repeats, unsafe/invalid markers block.
  Marker reads are bounded to 100 bytes; publication stages an exclusive no-follow file,
  fsyncs it, rechecks the marker, replaces its directory entry and fsyncs the destination.
  Context copying never publishes/prunes the marker. Failures block completion; these path
  checks are not a hostile-concurrency sandbox or a transaction covering all setup assets.
- Workspace configurations and recovery journals have a 2,000,000-byte limit checked before
  reading/allocation and again on the opened descriptor. Bounded reads reject growth/change.
  Oversized files require manual review, not truncation or a silent default.
- Missing or non-list UCT collections produce null raw counts; an explicitly empty list is
  zero. Persisted normalized schema and accepted/quarantined counts are unchanged.

- Normalization and read_source.py share the fixed credential-path denies from write-policy.json.
  Denied or multiply linked finding sources remain quarantined blockers; vendor source remains
  usable but vendor credential paths reject. The human-operated source helper rechecks paths
  and the opened descriptor, never executes source, and returns bounded escaped UTF-8 evidence.
  Persisted findings are not read permission. Native tools require a reviewed secret-free
  snapshot and host read exclusions; no helper can intercept native reads or detect all secrets
  embedded in otherwise permitted files. Stop rather than bypass this boundary.
- Capture publication and each normalized artifact fsync their destination directory after
  replacement; normalized staging is flushed/fsynced before replacement. Durability failures
  block completion, including failures after a rename. This is not a multi-artifact transaction;
  do not consume mixed/stale reports after failure. Directory fsync/no-follow needs a supported
  POSIX filesystem; unsupported environments must use a reviewed supported host or stop.

- `capture_uct.py` routes both UCT modes through a new private capture directory instead of
  opening the final raw report for writing. It uses POSIX no-follow/exclusive creation and
  directory-descriptor publication; pre-existing symlinks, hardlinks, directories and
  unrelated raw destinations reject before scan launch. Recognized previous raw UCT JSON
  can be replaced for repeat scans; unsupported prior artifacts require human archival.
  Only approved argv is executed, without a shell. Docker file capture requires the same
  verified project-root bind mount; unsupported environments stop. Failed private captures
  and logs are human-audit-only, not prompts; no stale-report fallback. This is not a sandbox,
  native approval enforcement or protection from malicious code with the same user's rights.
- Report agents consume normalized accepted records, fixed quarantine reasons/counts and
  the normalizer's numeric raw-count summary, never raw UCT JSON or quarantine evidence.
  Unavailable counts remain null/unavailable and quarantine remains blocking. Persisted
  normalized schemas and target/edition resolution are unchanged.
- `normalize_uct.py` deterministically validates the repository-documented UCT schema and
  exact code/type/diagnostic pairs before TOON/CodeGraph. It rejects traversal and symlinks,
  extracts strict identifiers, and preserves unknown findings as counted review blockers.
  Current adapters cover MC-43 method removal and W-083 class deprecation only; other actual
  tool schemas/codes require human review and a fixture-backed adapter change. Quarantine
  is deliberately not a clean scan. Raw JSON and escaped quarantine evidence are audit-only.
  Normalizer output arguments are not arbitrary project files. Use
  upgrade-findings.normalized.json and upgrade-findings.quarantine.json under the selected
  flavour's context directory or .ccua/review/. Existing destinations must be recognizable
  normalizer artifacts; unrelated files and symlink/hardlink aliases reject before writing.
  Repeat scans replace designated artifacts. File replacement is atomic individually, not
  a two-file transaction or a race-proof sandbox. If a write fails, stop rather than consume
  mixed or stale outputs.
- The changed-PHP tokenizer routes newly introduced `include`, `include_once`, `require`
  and `require_once` constructs to security review independently of function-call syntax.
  Existing baseline loading is reported, not declared safe; this remains token inspection,
  not proof of safe code or a sandbox.
- Legacy workspace configuration reconciliation rejects multiply linked files before any
  cleanup writes and stages replacements in private directories instead of truncating
  existing inodes. Ownership and permission bits are preserved or publication stops.
  Replacement is atomic per file, not a multi-file transaction or race-proof sandbox.
  A cooperating-process exclusive lock and durable hash-only journal record all four fixed
  configurations before publication. Late failures retain the journal; setup/update refuse
  completion until explicit verified roll-forward cleanup. Missing/changed/aliased or malformed
  recovery inputs block. No original settings payloads or secrets are stored in the journal.
  POSIX directory fsync/no-follow support is required; unsupported platforms stop before changes.
- Audit append validates the opened descriptor as a regular, single-link file before writing,
  including rejected-input records. Nonblocking open prevents FIFO waits where supported.
  Unsafe destinations block completion; no unguarded fallback logging occurs. These checks
  do not provide a same-user hostile-concurrency sandbox or tamper-proof attribution.
- `research_url.py fetch` restricts exact HTTPS hosts/paths and validates each redirect before
  following it. Native WebSearch/WebFetch may access/follow sources internally; Markdown
  cannot intercept those requests. The workflow uses the controlled helper through the
  separately approved orchestrator or stops retrieval if that control is unavailable.
- Agent frontmatter removes edit/execute from research personas and web from modification/
  execution personas. Actual isolation depends on framework support and effective user
  settings. Copilot maps any Bash grant to broad `execute`, not per-command restrictions.
- Escaped JSON and delimiters reduce content confusion; they are not immutable system
  instructions. Exact-action approvals are live workflow checks, not cryptographic tokens,
  persistent capabilities or a tamper-proof external audit service.
- Tests and Magento/Composer tools execute checkout/vendor code. A proposed diff and a
  application/config/test diff needs exact files/diff/environment approval; routine validation
  commands need the live-approved routine command/environment scope.
  Static analysis does not prove absence of injection. Stop on gaps/failures; do not silently
  roll back user changes. AMES and Morpheus integrations are not implemented or claimed.

## Repair an existing installation before resuming upgrades

Stop existing agent sessions before applying the automatic routine non-production profile.
Setup/update restore managed safety assets but preserve root instructions and settings.
Compare preserved `CLAUDE.md`/`.claude/settings.json` or `.github/copilot-instructions.md`
against the toolkit templates, then manually merge the reviewed profile. Replace older
blanket human-only/read-only primary-agent rules only with the full scoped routine/isolation contract,
not by deleting safety requirements. Do not retain broad execution allows or automatic hooks.

Verify the actual host grants only reviewed routine commands/paths for the live-approved
instance/hop scope, including delegated agents, in a local/dev non-production instance (confirmed by one user
attestation) without production credentials/access. Terminal visibility is not execution permission.
The normal session running the skill is the execution-capable orchestrator; the separate
researcher remains read-only. Agent selection is not an execution gate.
Application/config/test diffs and outside-scope/sensitive actions retain separate live approvals.
Secret/key operations remain human-only. If the user does not attest to a local/dev instance or scoped permissions cannot be
granted, return human-run commands and non-secret results for blocked steps.
Repository frontmatter and path denies cannot constrain arbitrary shell code.

For Copilot CLI, run `copilot config defaultPermissionMode manual` and
`copilot config disableAllHooks true` before starting (user-wide settings).
Start `copilot` normally (no agent flag), use `/reset-allowed-tools` before approval,
grant only reviewed routine commands/metadata paths for this run, and clear grants after it.
Inspect local/global overrides and execution-capable
MCP servers. Do not use allow-all or assisted auto-approval. See the README for local setup.

Claude updates do not add SessionStart command hooks or overwrite customer hook settings.
Previously installed version-check hooks are not removed automatically. With sessions stopped,
the human must review and remove the toolkit-owned command
`node .claude/hooks/check-toolkit-version.mjs` from the effective SessionStart configuration,
preserving unrelated customer settings and entries. Review all remaining local/global hooks
against the scoped routine profile before restarting; an update alone is not host revocation.

After updating an existing installation, rerun setup for its active agent to refresh the
managed `.gitignore` block. Asset updates alone preserve existing ignore rules. Both
flavors exclude private `.uct-capture-*` directories and reconciliation staging. Ignore
rules do not remove already tracked files or prevent forced additions: human-review any
previously staged/tracked captures without feeding their contents to agents.

### Interrupted legacy cleanup

Stop all agent/setup/update sessions and independently disable execution before recovery.
Review `.ccua/legacy-reconciliation.json` (fixed paths and before/cleaned SHA-256 hashes only).
If `.ccua/legacy-reconciliation.lock` remains after an abrupt stop, a human must verify no
reconciliation process is active and separately approve removal of that exact empty directory.
Never infer permission from a PID, lock age or journal. The toolkit does not remove stale locks.
After reviewing the exact project/environment/effects, the human runs:

```bash
node scripts/recover-legacy-codegraph.mjs --project /absolute/reviewed/project
```

Recovery accepts only recorded before/after bytes and recomputes recognizable legacy cleanup;
it never restores old grants or applies arbitrary journal content. Unknown drift requires manual
review. Completion requires expected hashes and absence of legacy registrations/grants in all
four configurations before the journal is cleared. Interrupted recovery remains blocked and
can be retried after human lock review. Private staging directories from abrupt termination
remain ignored and require separately reviewed human cleanup. This is cooperative recovery,
not an atomic cross-file transaction, native permission revocation or hostile-concurrency sandbox.

### Scoped change review and hash-only audit

Read the refreshed `write-scope` guardrail and fixed versioned
`scripts/write-policy.json` in your selected flavour. Manually merge its always-on reference
into preserved root instructions. All eight agent definitions reference it. Existing settings
are preserved, not silently tightened. The helper/policy/tokenizer install and update through
the existing scripts directory; Copilot assets are generated from canonical `.claude`.

Initial discovery/state initialization and review-fixture preparation do not have UCT
finding IDs yet. Use the guardrail's bounded metadata-bootstrap procedure: separately
review exact non-secret metadata files/content/diffs within the orchestrator/docs allowlist.
Do not invent a finding or require a plan to create its own evidence. This does not permit
application/config/package/test edits. Once versions/evidence exist, use the helper for
finding-derived changes and their completion/report updates.

Present a global human-review plan grouped by agent/hop/chunk, then one helper plan per
finding/source (multiple files for that finding are allowed). Use only **non-secret** reviewed
source fixtures. No secret payload fields, approval booleans, arbitrary policy path, command
string or free-text instructions exist in the schema. Every object below has exactly the
listed keys; duplicate keys, extra fields, wrong types and symlink/traversal paths reject.

Plan, e.g. `.ccua/review/finding.json`:

```json
{
  "schemaVersion": 1,
  "agent": "commerce-developer",
  "kind": "patch",
  "environment": "local-review",
  "fromVersion": "2.4.7",
  "toVersion": "2.4.8",
  "hop": 1,
  "chunk": 3,
  "evidence": ".ccua/review/sources.json",
  "evidenceSha256": "<SHA256 of exact ledger bytes>",
  "changes": [{
    "path": "app/code/Example/Module/Model/Example.php",
    "issue": {"kind": "uct", "id": 1},
    "before": ".ccua/review/example.before",
    "after": ".ccua/review/example.after",
    "beforeSha256": "<SHA256 of exact before bytes>",
    "afterSha256": "<SHA256 of exact after bytes>",
    "diffSha256": "<SHA256 of exact UTF-8 unified diff>",
    "sensitive": false
  }]
}
```

Hashes above are explanatory placeholders; use lowercase 64-digit SHA-256 hex. Fixture names
are project-contained, non-symlink single files under `.ccua/review/`. For create/delete use
`null` for the missing side's fixture and hash; an empty existing file has SHA-256 of empty
bytes, not null. No-op changes reject. Diff bytes are Python `difflib.unified_diff` on decoded
UTF-8 `splitlines(keepends=True)`, filenames `a/<path>`/`b/<path>`, defaults (3 context lines),
joined without extra newline. The helper emits that exact diff for live review; it never
applies it. Do not include credentials found in otherwise allowlisted source in fixtures.

Evidence ledger:

```json
{
  "schemaVersion": 1,
  "fromVersion": "2.4.7",
  "toVersion": "2.4.8",
  "normalized": ".ccua/review/normalized.json",
  "normalizedSha256": "<SHA256 of refreshed normalized output>",
  "sources": []
}
```

Re-normalize the raw report with the existing approved normalizer command first. The helper
checks accepted IDs, version/counts, structured diagnostic types/symbols and unresolved
quarantine. It does not broaden supported UCT adapters or manufacture new finding IDs.
For a separately human-reviewed breaking-change source, use issue
`{"kind":"source","id":"BC-reviewed-change"}`, set normalized/hash to null if no UCT report,
and add `{"id":"BC-reviewed-change","reference":"vendor/magento/<reviewed-file>",
"sha256":"<exact OOTB file hash>"}` to sources. An allowed HTTPS official provenance URL
with its reviewed content hash also works; local references are rehashed, URL content is
NOT fetched by this helper. A ledger/source ID is **evidence, not authorization**: the live
human reviews its provenance, mapping and connection to the actual issue. Sources cannot
self-designate as reviewed. Ledger byte hashes bind the plan, not authenticity or consent.

After separately approving artifact preparation and each exact command/root/environment,
the orchestrator runs (Copilot uses `.github/scripts/`):

```bash
python3 .claude/scripts/review_change_plan.py review .ccua/review/finding.json --project-root .
```

Review the escaped output's exact diff, `group`, plan/policy hashes and required live review.
Restricted flags are a floor, not an exhaustive payment/PCI/auth classifier. Developer
signoff of effects and read-only security review occur **before writing** restricted files.
Draft PRs are optional review channels, never consent. Separately approve the exact patch.
Revised files/bytes/environment require new review; retain the reviewed plan hash outside the
untrusted plan. After applying, independently compare against the pre-write snapshot to form
`.ccua/review/changed.json` (a JSON array of all changed paths, including create/delete and
ignored/untracked effects). This inventory is not cryptographically authenticated.

Before running DI compile/tests or other changed project code, separately approve actual
installed `vendor/bin/phpcs -e --standard=Magento2` and capture its non-secret listing to
`.ccua/review/sniffs.txt`. Do not install assumed scanners/sniffs. Verify the actual
`Magento2.Security.` family, then run approved Magento2 PHPCS INCLUDING Security before
DI compile/tests. The helper verifies listing content, not that PHPCS really ran.

```bash
python3 .claude/scripts/review_change_plan.py verify .ccua/review/finding.json --project-root . --changed .ccua/review/changed.json --sniffs .ccua/review/sniffs.txt --expected-plan-sha256 <live-reviewed-plan-hash>
python3 .claude/scripts/review_change_plan.py audit .ccua/review/finding.json --project-root . --changed .ccua/review/changed.json --sniffs .ccua/review/sniffs.txt --expected-plan-sha256 <live-reviewed-plan-hash>
```

Replace the angle-bracket placeholder with the reviewed literal hash, not shell input copied
from untrusted descriptions. Commands need their own live review, not just diff approval.
Exit 0 is deterministic evidence, never consent; 2 is blockers; 1 is rejection/failure.
Missing PHP/tokenizer or Security family fails closed. The trusted PHP helper uses
`php -n -d extension=tokenizer` and `token_get_all` on stdin text, not project includes/eval.
Introduced dangerous/indirect/reflection/backtick behavior and external/dynamic URL reads
require security disposition. Comment/string words do not become calls. Unchanged baseline
risky expressions are counted, not cleared as safe; altered expressions are flagged.
This is conservative token inspection, not full PHP semantics/vulnerability analysis;
obfuscation, arbitrary method calls and framework behavior can evade it. Any specific live
gap/risk disposition must be recorded as such, never a fabricated passed scan.

`audit` verifies again and appends `.ccua/audit-log.jsonl` with claimed agent attribution,
environment/version/hop/chunk, issue/path metadata and before/after/diff/plan/policy hashes.
Rejections log only action and plan hash; no raw invalid input, source/diffs/prompts/logs or
secrets. Audit failure blocks completion; no silent fallback or automatic rollback. `.ccua/`
is ignored by new installs; add that rule manually to existing projects on update. No secret
data belongs there even though ignored. Audit hashes are evidence, NOT proof of agent
identity, live approval or a complete inventory. Audit is local/mutable, not an external
tamper-proof service. Review/success stdout has scoped diffs; audit stdout/log is metadata-only.

Direct vendor/core/secret writes remain prohibited even with approval. Platform Composer/
config.php effects use a separate orchestrator `command-effects` plan, exact approved command,
environment and package/output effects, never an arbitrary developer patch. Prepare a
reproducible exact diff separately on non-production when resolution is not predictable.
The helper writes only its constrained local audit artifact, never targets/fixtures or rollback.
It cannot intercept native writes/commands. Roles/identity are model claims, the checkout's
maintainer-controlled policy is mutable, and filesystem checks are not race-proof against
concurrent hostile mutation/hardlinks. Real isolation needs runtime/OS least privilege and
human workflow; AMES/Morpheus remain pending. No "immutable system" enforcement is claimed.

Official Commerce development reference (no new remote retrieval for this artifact change):
https://developer.adobe.com/commerce/php/tutorials/

The updater preserves user root instructions, unrelated settings, project state and caches. Updating
assets alone **does not repair** broad user permissions or stale research/key decisions.

1. Stop active upgrade sessions and keep protected copies of non-secret state/audit records.
   Update the selected flavour and reload its agent runtime. Do not run both flavours together.
2. Manually merge the new always-on **Untrusted content and exact-action approval** section
   from the toolkit `CLAUDE.md` into the project's preserved `CLAUDE.md`, or from generated
   `.github/copilot-instructions.md` into the preserved Copilot instructions. Retain user
   customizations but remove any unrestricted-domain fallback and conflicting auto-fix rules.
   Read the refreshed `untrusted-data` and `websearch-scope` guardrails.
3. Review effective tool grants in the runtime, `.claude/settings.json`, IDE settings and
   permission bypass modes. Remove broad auto-allow rules for Magento/Composer, Docker/warden
   execution, Python/Node helpers, tests and web retrieval if they bypass action review.
   Research analyst must have read/web/delegation only; developer read/edit
   only. DevOps/QA have no web. No native-tool redirect confinement is implied by prompt rules.
4. Invalidate old `context/upgrade-mcp-cache.json` entries: archive them as audit-only or mark
   them `trust: untrusted-candidate` with revalidation required. Do not copy previously
   auto-promoted rows into new shipped knowledge. Review any locally retained mutated
   `known-breaking-changes` skill against the clean maintainer-reviewed version.
5. In every pending hop, unset old `encryptionRotationRequired`, `encryptionRotationMethod`,
   `encryptionDecision` and approval claims. Preserve non-secret historical rotation evidence
   as audit-only. Rebuild a source/hash/recommendation/confidence/version-pair/environment
   proposal and review **both true and false** with the live human. Gate 4 fails closed on
   missing/invalid/conflicting/legacy metadata and does not trust persisted approvals.
6. Re-normalize every cached raw `context/upgrade-findings.json` with the refreshed
   normalizer before converting the **normalized** JSON to TOON; never convert raw reports.
   Rebuild derived reports from accepted fields, retaining quarantine counts and blockers.
   Review unsupported schema/code diagnostics manually; they are not silently discarded.
7. Re-present each remediation's provenance, version pair, successor and exact diff/files/
   environment for live approval, then separately review execution/validation commands.
   Prior start/chunk approval is insufficient. If unattended, leave a review package and stop.

The updater removes only exact legacy CodeGraph grants/enablement after config preflight;
it must not otherwise silently overwrite user settings or clear state. Repair requires the
developer's review; these steps cannot be satisfied by a cached `approved: true`.

## CodeGraph containment and migration

CodeGraph is **disabled**, with no mandatory MCP, default grant, npm provisioning, PATH probe,
indexing or server launch. Setup, agent selection, the shell wrapper and both flavour functions
default to disabled; `--skip-codegraph` is an explicit disabled choice. `--enable-codegraph`
fails clearly/nonzero before subprocesses/network/registration/indexing or project changes:
no independently reviewed approved profile exists. Conflicting flags and unknown CLI flags
are errors. The compatibility `setupCodegraph` export only validates options/reconciles legacy
workspace configuration, never activates a server. Do not manually install a global latest.

Setup, flavour switching and updates (including same-version updates) preflight both
`.mcp.json` (`mcpServers`) and `.vscode/mcp.json` (`servers`), plus `.claude/settings.json`
and `.claude/settings.local.json`, before rewriting any of them or copying setup assets.
Only the old toolkit shape named `codegraph`, command `codegraph`, args exactly `serve`,
`--mcp`, type absent or `stdio`, and no other fields is removable. Unrelated JSON keys and
servers are retained. Exact legacy `enabledMcpjsonServers` entries and CodeGraph auto-allow
patterns are removed, not unrelated permissions. No broad deletion of MCP files/directories.
Malformed or duplicate-key JSON, customized CodeGraph entries or a symlink in a config file/ancestor cause
an explicit failure before rewrites; external link targets are never read. Repair these
manually and retry. Preflight prevents validation-error partial writes, not filesystem
transactions or race-proof isolation against concurrent hostile workspace mutation.

Stop/reload runtimes to stop already-running legacy servers. Root `CLAUDE.md` and
`.github/copilot-instructions.md` remain user-owned: manually replace old CodeGraph-first,
mandatory-call and “do not Read” directives with the new source-first rules. Review broader
permission bypasses separately. Copilot CLI global registration is not project-controlled:
manually disable/remove its CodeGraph registration in your CLI MCP settings (typically
`~/.copilot/mcp-config.json`). Likewise review other global/IDE MCP settings. The toolkit
never reads or alters home configuration. Merely deleting workspace entries cannot stop a
server already running, repair global registrations, or prove a customized server safe.

Direct reads/searches of normalized existing project-contained non-symlink paths and strict
symbols provide evidence and caller/blast-radius analysis without MCP. Recheck paths at use
time. Source remains untrusted; proposals retain live exact-action approval and quarantine
gates. A future approved MCP could only be an optional UNTRUSTED optimization, never
authoritative; security-sensitive recommendations require corroborating direct source reads.
Preserve historical `codegraphCallCount`, incrementing only actual verified future approved
calls. Direct reads and disabled runs add zero.

## Secure MCP reactivation — LONG TERM PENDING

Containment is implemented, **secure activation is not**. No known-good audited version,
hash, transitive lock, catalog, sandbox contract or approval authority has been supplied.
A pin alone is not proof of safety; neither latest metadata nor existing config is approval.
Do not fabricate audit results, signed manifests, trust anchors or approval-token enforcement.
Before any activation implementation, independent owners/security reviewers must supply and
approve at least:

- A reviewed exact package version and SHA-512 artifact digest with transitive dependency
  lock, reproducible integrity/audit results and verified provenance. Review transitive
  code, not only the top-level tarball. Lifecycle scripts must be ignored; install into an
  isolated location, never global/PATH. Verify the **installed tree** integrity before each
  launch, not just a cached tarball, and define update/revocation policy.
- An actual OS sandbox contract: no network, least privilege, bounded resources and a
  read-only source snapshot excluding secrets/credentials/private configuration and reports.
  A cwd or exclusion list is **not a sandbox**. No upstream exclusion flags are assumed.
- A proxy that verifies the full **paginated** MCP tool catalog and schemas against an
  approved manifest with signing authority/trust anchor, denies unknown/drifted tools and
  arguments, constrains allowed operations, and separates untrusted results from authority.
  Owner-reviewed signing, validation, revocation and runtime enforcement must be real.
- Independently reviewed approval artifacts and launch/installation contracts, effective
  framework least privilege, negative tests, and transitive audit/provenance/catalog/sandbox
  CI gates using that actual approved profile and lock.

Nightly/PR containment tests guard against restored uncontrolled install/launch/grants;
they do not audit a nonexistent dependency. Ordinary plugin npm audits do not audit CodeGraph.
No always-green pseudo-audit is provided. AMES/Morpheus remain pending. An Adobe-owned fork
requires owner approval and repository access; neither is assumed. Fail closed until these
requirements are supplied and independently approved.

## Encryption and critical configuration

Passwords are one-way hashes and independent of the two-way crypt key. Neither a version
bump nor research alone authorizes key rotation or a no-rotation decision. Human operators
review exact environment/action, protected backups, recovery and verification, then perform
any supported `encryption:key:change`, `crypt:key:rotate` or Admin operation themselves.
Agents never directly write env.php/secrets or auto-execute key commands. Auth/payment config
changes additionally need exact-action approval and security review. Record only non-secret
provenance and verification metadata.

Official version-specific reference:
https://experienceleague.adobe.com/en/docs/commerce-admin/systems/security/encryption-key
