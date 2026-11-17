# Skill: ece-tools-config

## Scope check — confirm Cloud config files exist before applying this skill's config sections

`.magento.env.yaml`, `.magento/services.yaml`, and `.magento.app.yaml` are Adobe Commerce
Cloud (or `magento-cloud-docker` local-parity) artifacts. A local Warden/markshust/bare-metal
project — the common case for day-to-day development — legitimately has none of them; that is
not a defect to fix, it's evidence this is not a Cloud/Cloud-parity checkout (same "live wins,
absence is a valid answer" posture as the `environment-detection` skill's Step 4).

Before applying the `.magento.env.yaml structure`, `.magento/services.yaml`, or Post-deploy
checklist sections below:
```bash
{containerPrefix} test -f .magento.app.yaml && echo present || echo absent
{containerPrefix} test -f .magento/services.yaml && echo present || echo absent
```
If both are absent: report `cloudConfigScope: n/a (no .magento.app.yaml/.magento/services.yaml
— local, non-Cloud project)` and skip straight to this skill's **Patch Verification** section
— but within it, only run Source A (composer.json `extra.patches`) and Source B (Commerce
Version Tool, which Adobe documents as supported for on-premises and Magento Open Source too,
not Cloud-only). Skip Source C (`/m2-hotfixes`) on a local/non-Cloud project: those patches are
applied by the `ece-tools` build hook specifically, which isn't running here, so an unapplied
`m2-hotfixes` patch on a local box isn't a deploy-readiness failure — report
`patchSourceC: n/a (no ece-tools build hook on this environment)` rather than flagging it.
Do not attempt to read or "confirm service versions match" against files that don't exist, and
do not treat their absence as an error requiring the user's attention — only report it as a
scope note.

If either file is present, proceed with the sections below as written.

## .magento.env.yaml structure
```yaml
stage:
  global:
    SKIP_HTML_MINIFICATION: true
    SCD_ON_DEMAND: false  # false in production — SCD at build time

  build:
    SCD_STRATEGY: compact  # compact|quick|standard
    SCD_THREADS: 4
    VERBOSE_COMMANDS: false

  deploy:
    SEARCH_CONFIGURATION:
      engine: opensearch
      opensearch-host: opensearch.internal
      opensearch-port: 9200
    CACHE_CONFIGURATION:
      frontend:
        default:
          backend: Magento\Framework\Cache\Backend\Redis
          backend_options:
            server: redis.internal
            port: 6379
            database: 0
    SESSION_CONFIGURATION:
      save: redis
      redis:
        host: redis.internal
        port: 6379
        database: 1
    DATABASE_CONFIGURATION:
      connection:
        default:
          username: user
          host: database.internal
          dbname: main
    QUEUE_CONFIGURATION:
      amqp:
        host: rabbitmq.internal
        port: 5672
        user: guest
        password: guest

  post-deploy:
    WARM_UP_PAGES:
      - "index.php/"
      - "index.php/customer/account/login"
```

## Hook lifecycle
```yaml
# .magento.app.yaml hooks section
hooks:
  build: |
    set -e
    composer --no-ansi --no-interaction install --no-progress --prefer-dist --optimize-autoloader
    vendor/bin/ece-tools run scenario/build/generate.xml
    vendor/bin/ece-tools run scenario/build/transfer.xml
  deploy: |
    vendor/bin/ece-tools run scenario/deploy.xml
  post_deploy: |
    vendor/bin/ece-tools run scenario/post-deploy.xml
```

## .magento/services.yaml (version pinning)
```yaml
mysql:
    type: mysql:10.6
    disk: 5120

redis:
    type: redis:7.2

opensearch:
    type: opensearch:2

rabbitmq:
    type: rabbitmq:3.11
```

## Common env variables for production
```yaml
MAGE_MODE: production
ENABLE_GOOGLE_ANALYTICS: false
CLEAN_STATIC_FILES_FLAG: true
SCD_MATRIX:
  "magento/language-en_us":
    language:
      - en_US
```

## SCD strategy guide
- compact: fewer files, slower first load, best for large catalogs
- quick: faster build, more files generated — best for stores with many themes
- standard: generates all permutations — slowest build, fastest page load

## Cron configuration
```yaml
# In .magento.app.yaml
crons:
    magento:
        spec: "*/5 * * * *"
        cmd: "php bin/magento cron:run"
    indexer:
        spec: "0 * * * *"
        cmd: "php bin/magento indexer:reindex"
```

## Post-deploy checklist
After any deploy:
1. vendor/bin/ece-tools env:config:show — verify env variables applied
2. bin/magento indexer:status — check no indexers stuck
3. bin/magento cache:status — verify all cache types enabled
4. Run **Patch Verification** below — a clean `ece-tools`/`composer` exit code alone is not
   proof every expected patch actually landed in `vendor/`.

## Patch Verification (do not trust exit codes — confirm actual applied state)

Per Adobe's documented [patch precedence order](https://experienceleague.adobe.com/en/docs/commerce-operations/implementation-playbook/best-practices/maintenance/patching-at-scale)
and [Apply patches](https://experienceleague.adobe.com/en/docs/commerce-cloud-service/user-guide/develop/upgrade/apply-patches)
guide, a Cloud/ECE-tools deployment can apply patches from **three distinct sources**, in this
order. A verification pass that only checks one of them (an earlier version of this skill
checked only Source A) silently misses failures in the other two — exactly the "patch fails to
apply silently" gap this section exists to close. Run all three; the overall gate (Step 4)
requires all of them to pass, not just one.

| Source | Applied by | Declared in |
|---|---|---|
| A — Custom/vendor patches via composer | `cweagans/composer-patches`, during `composer install`/`update` | `composer.json` `extra.patches` |
| B — Adobe's required + optional Commerce patches | `magento/magento-cloud-patches` (required) and `magento/quality-patches` (optional), invoked automatically by the `ece-tools` build hook | Adobe's patch registry (required) + `.magento.env.yaml`'s `QUALITY_PATCHES:` list (optional) |
| C — Custom hotfix patches | `ece-tools` build hook, applied automatically on every deploy, alphabetically by filename | `.patch` files in the `/m2-hotfixes` directory |

### Source A — composer.json `extra.patches` (cweagans/composer-patches)

Verifies those patches actually took effect — composer-patches can exit 0 while silently
skipping a patch (version constraint in `extra.patches` didn't match the installed package
version) or partially applying one (some hunks land, others get fuzzy-skipped or rejected into
a `.rej` file), and by default it only *fails the whole install* on an outright apply error,
not on a skip.

**A1 — Discover expected patches:**
```bash
{containerPrefix} php -r '$c = json_decode(file_get_contents("composer.json"), true); echo json_encode($c["extra"]["patches"] ?? [], JSON_PRETTY_PRINT);'
```
This yields, per package, a map of `{patch title: patch file path}`. This — not
`composer.lock`'s `extra.patches_applied` — is the source of truth for what's *expected*;
`patches_applied` (if present) is composer-patches' own record of what it *believes* it did
and is useful corroboration only, never a substitute for A2's content check.

If `extra.patches` is empty, there is nothing to verify for this source — report
`patchSourceA: n/a (no patches declared)` and move to Source B.

**A2 — Verify each declared patch against the installed vendor/ tree:**
For every `{package, patchTitle, patchPath}` from A1:

1. **Patch file exists?**
   ```bash
   {containerPrefix} test -f {patchPath} && echo present || echo missing
   ```
   `missing` → status = `missing` (can't have applied), reason = "patch file not found at
   {patchPath}". Continue to the next patch, do not check further for this one.

2. **Package installed and in the constrained version range?** (if `extra.patches` scopes this
   patch to a version constraint for {package})
   ```bash
   {containerPrefix} composer show {package} | grep versions
   ```
   Installed version outside the constraint → status = `missing`, reason = "installed
   {package} version does not satisfy the patch's version constraint — composer-patches
   silently skips out-of-range patches without failing the install". Continue to the next
   patch.

3. **Confirm the patch's actual content is present in the installed file(s)** — this is the
   real verification step; do not stop at 1–2. This is the same `git apply --check --reverse`
   mechanism ECE-tools itself uses internally to detect patch failures during the build hook
   — verify against allowed Commerce documentation and locally installed ECE-tools source.
   The historical general Experience Cloud KCS link is outside approved Commerce paths;
   do not fetch it or open broader domains to fill an evidence gap:
   ```bash
   {containerPrefix} git apply --check --reverse --directory=vendor/{package} {patchPath} 2>&1
   ```
   `extra.patches` diffs are commonly authored relative to the package root (so `--directory=`
   is needed to resolve them against `vendor/{package}`), but this isn't universal — if this
   command errors with a path-resolution complaint (not a hunk-mismatch complaint) rather than
   a clean 0/1 result, retry both checks below without `--directory=` (the diff may already
   carry the full `vendor/{package}/...` path):
   - Exit 0 → the patch's changes are already present in the target file(s) (reversing an
     applied patch only succeeds if it's there) → status = `applied`.
   - Non-zero → run the forward check to disambiguate:
     ```bash
     {containerPrefix} git apply --check --directory=vendor/{package} {patchPath} 2>&1
     ```
     - Exit 0 (forward check succeeds) → the target file(s) are still in their clean,
       pre-patch state → status = `missing`, reason = "patch declared but not applied to
       vendor/ — {package} content matches the unpatched original".
     - Non-zero (both checks fail) → the target file(s) are in neither the clean nor the
       fully-patched state → status = `partially-applied-or-conflicted`, reason = "some hunks
       may have applied and others didn't — vendor/{package} content matches neither state
       cleanly". Check for a `.rej` file next to the target (a leftover from a failed
       `patch`-style apply) and include its presence/absence in the reason.

### Source B — Adobe's required and optional Commerce patches (Commerce Version Tool)

Do not hand-roll a git-apply check for Adobe's own required ("Cloud Patches for Commerce") or
optional (Quality Patches Tool) patches — Adobe ships a purpose-built, official tool for
exactly this: the [Commerce Version Tool (CVT)](https://experienceleague.adobe.com/en/docs/commerce-operations/tools/commerce-version-tool/intro),
installed at `vendor/bin/patch-status` once any monthly security patch has been applied. It is
explicitly informational/read-only (does not apply or revert patches) and already performs the
same dry-run detect-applied-vs-missing logic this skill implements manually for Source A.

```bash
{containerPrefix} test -f vendor/bin/patch-status && echo present || echo absent
```
- `absent` → this project has never onboarded a monthly security patch package (CVT ships
  bundled with the first one). Report `patchSourceB: not-onboarded — vendor/bin/patch-status
  not present; cannot verify required/optional Commerce patch status this way` as an
  **advisory**, not a gate failure (there's nothing to check yet), but flag it as a follow-up
  recommendation.
- `present` → run it:
  ```bash
  {containerPrefix} php vendor/bin/patch-status --format=json
  ```
  Parse the JSON output's `missing_patches` and `unknown_patches` arrays (per the tool's
  documented [report schema](https://experienceleague.adobe.com/en/docs/commerce-operations/tools/commerce-version-tool/generate-report)).
  Any entry in `missing_patches` → status = `missing` for that patch ID, reason = "required or
  optional Commerce patch not detected by Commerce Version Tool". Any entry in `unknown_patches`
  → status = `unknown` (not a pass), reason = "CVT could not confirm patch status — see
  `var/log/patch_status.log` for the raw dry-run output"; treat `unknown` the same as `missing`
  for gating purposes — do not assume unknown means applied.

For the optional layer specifically, also read `.magento.env.yaml`'s `QUALITY_PATCHES:` list
(if present) and confirm every listed patch ID appears in CVT's `applied_patches` array — a
patch listed there but absent from `applied_patches` is `missing` even if CVT doesn't flag it
on its own (CVT reports what's detected in the codebase; the YAML list is what was *requested*
— the same "declared vs. actually verified" distinction as Source A's `extra.patches`).

### Source C — Custom hotfix patches (`/m2-hotfixes`)

Per Adobe's [Apply patches](https://experienceleague.adobe.com/en/docs/commerce-cloud-service/user-guide/develop/upgrade/apply-patches)
guide, every `.patch` file in the project-root `m2-hotfixes/` directory is applied
automatically on every deployment, in alphabetical order by filename — there is no
composer.json declaration for these at all, so Source A's discovery step misses them entirely.

**C1 — Discover expected patches:**
```bash
{containerPrefix} find m2-hotfixes -maxdepth 1 -name '*.patch' 2>/dev/null
```
If the directory doesn't exist or is empty, report `patchSourceC: n/a (no m2-hotfixes patches)`
and move to Step 4.

**C2 — Verify each patch**, using the same mechanism as A2.3 (confirmed to be the literal
command ECE-tools' own build hook runs against `m2-hotfixes` patches, per the same
troubleshooting doc referenced above) — but run from the project root with no `--directory=`
override, since `m2-hotfixes` patches are already authored relative to the project root:
```bash
{containerPrefix} git apply --check --reverse m2-hotfixes/{patchFile} 2>&1
```
Same exit-code interpretation as A2.3: exit 0 → `applied`; non-zero → run the forward
`git apply --check m2-hotfixes/{patchFile}` to disambiguate `missing` vs.
`partially-applied-or-conflicted`.

### Step 4 — Combined readiness gate

Build one combined per-patch table across all three sources:
`{source (A/B/C), package or patch ID, title/filename, status, reason}`. The overall patch
verification result is `PASSED` only if every row across **all three sources** is `applied`
(Source B's `not-onboarded` advisory doesn't block the gate; `missing`, `unknown`, and
`partially-applied-or-conflicted` do). This holds **regardless of** `vendor/bin/ece-tools` or
`composer install`'s own exit code. Report the failing source, package/patch ID, and reason
verbatim so the developer knows exactly what to fix — never collapse multiple patch failures
into a generic "patches failed" message.

This is a read-only check across all three sources. Never re-apply, edit, or delete a patch
file as part of verification — a failed/missing patch is a developer decision (fix the patch,
update the version constraint, or accept and record the gap), per `no-core-overrides`.

### Verification scenarios

| Situation | Source | Result | Gate |
|---|---|---|---|
| Patch applied cleanly, all hunks present | A/B/C | applied | contributes to PASSED |
| Patch never applied (e.g. composer install ran before patch was added to composer.json) | A | missing | FAILED |
| Patch file deleted/moved after being declared | A | missing | FAILED |
| Patch's declared version constraint doesn't match the currently installed package version | A | missing | FAILED |
| Patch partially applied — one hunk landed, one left a `.rej` | A/C | partially-applied-or-conflicted | FAILED |
| `composer install` exits 0 but one declared patch is out-of-range and silently skipped | A | missing | FAILED (exit code says nothing about this) |
| No patches declared in composer.json | A | n/a | contributes PASSED (nothing required) |
| Required Commerce patch missing per `patch-status` | B | missing | FAILED |
| CVT cannot classify a patch (`unknown_patches`) | B | unknown | FAILED (treated as not-confirmed-applied) |
| `vendor/bin/patch-status` not present (never onboarded) | B | not-onboarded | advisory only, does not block gate |
| `QUALITY_PATCHES:` lists a patch ID not in CVT's `applied_patches` | B | missing | FAILED |
| `m2-hotfixes/*.patch` file present but not applied to the working tree | C | missing | FAILED |
| No `m2-hotfixes` directory or it's empty | C | n/a | contributes PASSED (nothing required) |
| ECE-tools build/deploy hook exits 0 but a Source B or C patch is missing | B/C | missing | FAILED (exit code says nothing about this) |
