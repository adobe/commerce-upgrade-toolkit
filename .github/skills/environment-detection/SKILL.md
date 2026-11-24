---
name: environment-detection
description: "Canonical procedure for detecting the local Commerce development environment: Docker flavor, container shell prefix, and installed service versions. Every command that needs to run `bin/magento` or `vendor/bin/` against a project applies..."
---

# Skill: environment-detection

Canonical procedure for detecting the local Commerce development environment: Docker flavor,
container shell prefix, and installed service versions. Every command that needs to run
`bin/magento` or `vendor/bin/` against a project applies this skill instead of re-deriving
the logic inline.

Callers: `/upgrade-hop`, `/upgrade-hop-execute`, `commerce-installation` skill, CLAUDE.md §2
(Phase 0 / Phase 3). (`/commerce-init` belongs to the broader module-development toolkit this
was extracted from — out of scope here per CLAUDE.md's own scope section — so it's correctly
absent as a command in this toolkit, just no longer listed as a caller.)

## Planning fallback

When called by no-argument `/upgrade-hop`, discovery is optional for a provisional roadmap.
Without live routine approval, do not probe Docker, run project tools or inspect an
unreviewed checkout; return supplied non-secret facts labelled provisional and unknown
runtime fields with `status: incomplete`.
Within approved discovery, empty/unavailable Docker, ambiguous app containers or unresolved
project roots must not select guessed host execution or invoke bootstrap routing. Collect
the unresolved choices once in the intake; if unanswered, return incomplete evidence and
human-run verification guidance so planning can continue. Never inspect credential files.
For analysis/execution, unresolved identity still blocks project commands; this fallback
cannot mark detection complete or authorize a guessed container/root.

---

## Step 1 — Single-pass container detection

Run `docker ps` exactly once. Do not issue a second `docker ps` (or `warden env ps`) to check
a different flavor or a different service — classify everything from this one output.

```bash
docker ps --format '{{.Names}}\t{{.Image}}' 2>/dev/null
```

**If this is empty or Docker is not installed:** dockerType = "plain". Skip straight to
Step 3 and run every command directly on the host — there is no container list to parse, so
Step 2's grep-based service detection does not apply.

**Before classifying a non-empty result, rule out the "global services only" case:** Warden
(and similar tools) run shared, project-independent containers — `traefik`, `dnsmasq`,
`mailhog`, `phpmyadmin`, `portainer` — that persist across every project on the machine and
show up in `docker ps` regardless of whether *this* project has been bootstrapped yet. A
non-empty `docker ps` is not by itself evidence that this project's environment exists. If
every container name/image matches only that shared-service set (no `php-fpm`, `phpfpm`, `db`,
`mariadb`, `mysql`, `opensearch`, `elasticsearch`, or project-name-prefixed container present)
**and** there is no `.env`/`warden-env.yml` in the current project directory, treat this the
same as an empty result: skip the table below and go straight to "No running environment at
all (bootstrap case)" — do not fall through to Step 1a's `custom` disambiguation, which would
incorrectly ask "which container is the app container?" when the real answer is "none exist
yet, bootstrap one." (This is not a hypothetical — it is the exact state a fresh Warden install
is in before its first project is bootstrapped, and the literal case this note exists to catch.)

**Otherwise, classify the captured output in memory** (no further `docker ps` calls):

| Match | dockerType | containerPrefix |
|---|---|---|
| name/image contains `php-fpm` AND `.warden/warden-env.yml` exists | `warden` | `warden shell --` |
| name/image matches `phpfpm\|php-fpm` AND `docker-compose.yml` contains `markshust` | `markshust` | `docker compose exec phpfpm` |
| containers running (beyond the shared-service set ruled out above), no Warden/markshust markers matched | `custom` | resolved via Step 1a below |

Record `dockerType` and `containerPrefix` — every subsequent command in this session prefixes
with `containerPrefix` (empty string when `plain`).

### Step 1a — Resolving `custom` (generic and cloud Docker templates)

Warden and markshust are the only two flavors with a known, fixed file layout. Everything
else — a hand-rolled `docker-compose.yml`, Adobe's Commerce Cloud Docker template, a CI
sandbox container, a bespoke internal image — must be resolved from live container data, not
string-matched against either known layout. Do not guess a container name here; inspect for
it, and only ask the user once inspection fails to narrow it down.

1. **Shortlist app-container candidates** from Step 1's already-captured `docker ps` output —
   no new `docker ps` call. Candidates are any container whose name or image contains `php`,
   `fpm`, `app`, `web`, or `magento`.
2. **Disambiguate with `docker inspect`** on each candidate (one call per candidate; this is
   inspecting a container already known from Step 1's output, not re-listing containers):
   ```bash
   docker inspect --format '{{.Name}}: image={{.Config.Image}} cmd={{.Config.Cmd}} entrypoint={{.Config.Entrypoint}}' <candidate>
   docker inspect --format '{{.Name}}: {{json .NetworkSettings.Ports}}' <candidate>
   ```
   A genuine match shows `php-fpm`/`magento` in `Cmd`/`Entrypoint`, or exposes `9000/tcp`
   (php-fpm's port). Image tags alone are not reliable — a custom Dockerfile can install a
   different PHP version on top of a base tag, so treat the tag as a hint, not a conclusion.
3. **Exactly one match** → set `containerPrefix = docker exec -it <resolved name>`, using the
   real container name from `docker inspect`, not a placeholder.
4. **Zero or multiple matches** → ask the user which container is the app container. This is
   the last resort after inspection has failed to narrow it to one candidate, not the first
   move — do not skip straight to asking.

## Step 2 — Service detection (reuse Step 1's output, don't re-query)

If `dockerType` is not `plain`, the container list already confirms which services are up —
grep the **same captured output** from Step 1 for `mysql|mariadb`, `opensearch|elasticsearch`,
and `rabbitmq` to identify the relevant containers, then fetch versions from inside them:

```bash
{containerPrefix} mysql --version 2>/dev/null
{containerPrefix} php --version 2>/dev/null | head -1
```

Do not run `docker ps` again to check whether MySQL/search/RabbitMQ "exist" — their presence
in Step 1's output already answers that.

If `dockerType` is `plain`, there is no cached container list, so fall back to direct checks:

```bash
php --version | head -1
mysql --version 2>/dev/null
docker ps --format '{{.Names}}\t{{.Image}}' 2>/dev/null | grep -iE 'opensearch|elasticsearch|rabbitmq'
```

## Step 3 — Magento version and edition

For `warden` and `markshust` (known, fixed layouts) their conventional path is reliable — use
it directly, and for `plain` the project root is simply the current host directory:

```bash
{containerPrefix} grep -E '"magento/(magento2-base|product-(community|enterprise)-edition|magento-cloud-metapackage)"' /app/composer.json 2>/dev/null \
  || {containerPrefix} grep -E '"magento/(magento2-base|product-(community|enterprise)-edition|magento-cloud-metapackage)"' /var/www/html/composer.json 2>/dev/null \
  || grep -E '"magento/(magento2-base|product-(community|enterprise)-edition|magento-cloud-metapackage)"' composer.json 2>/dev/null
```

Do not `head -1` this grep — check ALL matched lines, not just the first, since a Cloud
project's composer.json has both `magento/magento-cloud-metapackage` and
`magento/product-enterprise-edition` present at once, and only checking the first match
risks silently landing on whichever line sorts first rather than the one that matters.

For `custom`, do not assume either flavor's layout — discover the real app root from the
container itself before touching composer.json:

```bash
docker inspect --format '{{.Config.WorkingDir}}' <resolved name>
docker inspect --format '{{json .Mounts}}' <resolved name>
```

`WorkingDir` is usually the app/composer root directly. If it's empty or unhelpful, read
`Mounts` for an entry with `"Type": "bind"` and use its `Destination` — that's the
container-side path backed by the actual project source, wherever it's mounted from on the
host. Then grep that discovered path first:

```bash
{containerPrefix} grep -E '"magento/(magento2-base|product-(community|enterprise)-edition|magento-cloud-metapackage)"' <discovered-path>/composer.json 2>/dev/null
```

As above, check all matched lines here too — do not `head -1` and drop the metapackage line
in favor of whichever edition-package line happens to sort first.

Only if `docker inspect` yields nothing usable (no bind mount, empty `WorkingDir` — e.g. code
baked into the image at build time with no volume) fall back to the fixed guess list: `/app`,
`/var/www/html`, `/var/www/magento`, `/srv/magento`. If that also fails, ask the user for the
Magento root path inside the container. Inspect-based discovery is the primary path for
`custom`; the guess list is a last resort, not the first thing to try.

Derive `editionType`:
- `cloud` if `magento/magento-cloud-metapackage` is present (checked first — takes priority
  over community/enterprise since a Cloud project also carries a plain edition package
  underneath it). Also capture `metapackageVersion` from this line, and separately
  `magentoVersion`/`editionVersion` from the `product-enterprise-edition` line if present —
  these can diverge (e.g. metapackage `2.4.9-p2` vs edition tag `2.4.9`); do not conflate them
  into a single field.
- `community` if `product-community-edition` is present and no metapackage was found.
- `enterprise` if `product-enterprise-edition` or `magento2-base` is present and no
  metapackage was found.

**Version precedence rule:** a version implied by an image tag, container name, or guessed
file path is provisional only, never final. The live check always wins — the actual
`{containerPrefix} php --version` output for PHP, and the actual `composer.json` contents read
above for Magento. If a tag or path guess disagrees with the live check, report the live
check's value and flag the mismatch — do not silently prefer the tag/path guess, and do not
average or merge the two.

## Step 4 — Cloud runtime and template (live, not just composer.json)

Step 3's `editionType: cloud` only proves the **package edition** — `magento/magento-cloud-metapackage`
being present in composer.json means the codebase is *built for* Commerce Cloud. It does not
prove the container currently being inspected is actually running on Cloud infrastructure (or
`magento-cloud-docker` local-parity) right now — the exact same composer.json is equally valid
checked out under Warden, markshust, or a bare CI sandbox. Do not conflate the two. Apply the
same "live wins over static" precedence rule from Step 3 here: composer.json tells you the
edition; only the running environment can tell you the actual environment/template in use.

1. **Read live Cloud runtime variables** (only Adobe Commerce Cloud infrastructure — or a
   `magento-cloud-docker` local-parity container configured to mirror it — populates these; a
   plain Warden/markshust/custom box never sets them unless someone exported them by hand). Per
   Adobe's documented [Cloud-specific variables reference](https://experienceleague.adobe.com/en/docs/commerce-cloud-service/user-guide/configure/env/stage/variables-cloud),
   the actual `MAGENTO_CLOUD_*` set is `MAGENTO_CLOUD_APP_DIR`, `MAGENTO_CLOUD_APPLICATION`,
   `MAGENTO_CLOUD_APPLICATION_NAME`, `MAGENTO_CLOUD_DOCUMENT_ROOT`, `MAGENTO_CLOUD_ENVIRONMENT`,
   `MAGENTO_CLOUD_PROJECT`, `MAGENTO_CLOUD_RELATIONSHIPS`, `MAGENTO_CLOUD_ROUTES`,
   `MAGENTO_CLOUD_TREE_ID`, `MAGENTO_CLOUD_VARIABLES`, `MAGENTO_CLOUD_LOCKS_DIR` — there is no
   documented `MAGENTO_CLOUD_ENVIRONMENT_TYPE` or `MAGENTO_CLOUD_MODE` variable; do not grep for
   either (an earlier version of this skill did, which meant `cloudEnvironmentType` could never
   populate even on a genuine live Cloud environment — the exact "environment check misdetects"
   failure mode this skill exists to prevent):
   ```bash
   {containerPrefix} printenv | grep -E '^MAGENTO_CLOUD_(ENVIRONMENT|PROJECT|APPLICATION_NAME)='
   ```
2. **Classify:**
   - Vars present → `cloudRuntimeDetected: true`. Capture `cloudEnvironmentName` (from
     `MAGENTO_CLOUD_ENVIRONMENT` — Adobe documents this as "the name of the environment branch",
     e.g. `production`, `staging`, or an arbitrary integration branch name), `cloudProjectId`
     (from `MAGENTO_CLOUD_PROJECT`), `cloudApplicationName` (from `MAGENTO_CLOUD_APPLICATION_NAME`).
     These three are authoritative — they came from the actual running environment, not a guess.
     Derive `cloudEnvironmentType` (`production | staging | integration | unknown`) from
     `cloudEnvironmentName` using Adobe's own branch-naming convention (branch named `production`
     or `master`/`main` → `production`; `staging` → `staging`; anything else → `integration`) —
     label this field explicitly as an **inferred heuristic**, not a directly-read variable, since
     no live var carries environment type directly. Never report it with the same confidence as
     the three live-read fields.
   - Vars absent and `editionType: cloud` (from Step 3) → `cloudRuntimeDetected: false`,
     `cloudEnvironmentName: "n/a — Cloud edition package, but not running on Cloud/Cloud-parity
     infra"`. Never upgrade this to a reported Cloud environment name — the package being Cloud
     edition is not evidence the current box is one.
   - Vars absent and `editionType` is `community`/`enterprise` → `cloudRuntimeDetected: false`,
     `n/a`. Expected, not a gap.
   - Vars **present** but `editionType` is `community`/`enterprise` (composer.json doesn't show
     the metapackage, yet the container clearly reports Cloud runtime vars) → genuine mismatch.
     Do not silently prefer either signal. Append to `envMismatches`: "Cloud runtime detected live
     (env: {cloudEnvironmentName}) but composer.json shows editionType={editionType} — investigate
     before treating this environment as deploy-ready."
3. **Static cross-check (secondary only):** if a `.magento.app.yaml` exists at the discovered app
   root (Step 3's discovered path for `custom`, or the conventional root for `warden`/`markshust`),
   read its top-level `name:` field as `cloudTemplateName`. If `cloudApplicationName` (live) is
   also known and the two disagree, append to `envMismatches` rather than picking one silently —
   same rule as the version-precedence case: live wins for the reported value, but a disagreement
   is itself a signal worth surfacing, not discarding.

## Fallback and validity rule (applies to every field in this skill)

If a field — `dockerType`, `phpVersion`, `magentoVersion`, `editionType`, `cloudEnvironmentName`,
or any other — cannot be determined by either a live check or a reliable static fallback (Steps
1–4 above already define, per field, what "reliable" means before falling back to a guess list),
set that field to `unknown` explicitly. Never fill it with a plausible-looking default, a guess
list value that was never confirmed, or a carried-over value from a stale memory/cache entry that
disagrees with a fresh live check. A caller consuming this skill's output must treat any `unknown`
field, or a non-empty `envMismatches` list, as `status: incomplete` — this blocks deploy-readiness
reporting until a human resolves it (same posture as Step 1a's "ask the user" fallback for an
unresolved `custom` container: incomplete detection is a stop, not a best-effort pass-through).

## Output schema

Callers persist this to `context/upgrade-state.md`'s `# Environment detection` / `# Cloud
runtime identity` sections — the only durable store for this data in this toolkit. (There is
no session key-value "Claude memory" cache in this toolkit backing a separate `upgrade_env`
key — an earlier version of this skill and its callers assumed one existed; it didn't, and
every reference to it has been replaced with a direct read/write of this file.) Use this shape:

```
dockerType: {warden | markshust | custom | plain}
containerPrefix: {full exec command or empty string}
phpVersion: {detected}
magentoVersion: {detected}
editionType: {community | enterprise | cloud}
metapackageVersion: {detected magento/magento-cloud-metapackage version, only when editionType is cloud, else "n/a"}
mysqlVersion: {detected or "unknown"}
searchEngine: {opensearch | elasticsearch | unknown} with version
rabbitMQVersion: {detected or "unknown"}
cloudRuntimeDetected: {true | false}
cloudEnvironmentName: {detected or "n/a" — see Step 4}
cloudEnvironmentType: {production | staging | integration | "n/a"}
cloudProjectId: {detected or "n/a"}
cloudApplicationName: {detected or "n/a"}
cloudTemplateName: {from .magento.app.yaml "name:" field, or "n/a"}
envMismatches: [] # list of strings — non-empty means status must be "incomplete"
status: {complete | incomplete}
```

A caller that only needs the flavor + shell prefix may stop after Step 1 and Step 3's
Magento-version line — Step 2's service versions and Step 4's cloud
runtime fields are optional detail for infra-gap analysis and deploy-readiness callers (used by
`/upgrade-hop` and `/upgrade-deploy-prep`), not required for every caller.

## Verification scenarios (expected behavior, not just narrative)

| Situation | dockerType | editionType | cloudRuntimeDetected | Reported result |
|---|---|---|---|---|
| Warden local dev, plain Commerce (no metapackage) | warden | community/enterprise | false | `cloudEnvironmentName: n/a`, status: complete |
| Warden local dev, Cloud edition package, no Cloud env vars | warden | cloud | false | `cloudEnvironmentName: "n/a — Cloud edition package, but not running on Cloud/Cloud-parity infra"`, status: complete (not an error — just not live Cloud) |
| Actually running on Adobe Commerce Cloud (staging) | custom | cloud | true | `cloudEnvironmentName`, `cloudEnvironmentType: staging` populated from live vars, status: complete |
| Cloud runtime vars present, composer.json shows enterprise (no metapackage) | any | enterprise | true | `envMismatches` non-empty, status: **incomplete** — must be resolved before deploy-readiness reporting |
| `.magento.app.yaml` `name:` disagrees with live `MAGENTO_CLOUD_APPLICATION_NAME` | any | any | true | `envMismatches` non-empty, status: **incomplete** |
| `docker ps` empty, no `.env`/`warden-env.yml` | plain (bootstrap case) | unknown | false | status: **incomplete** until bootstrap runs ("No running environment at all" section) |
| `docker ps` non-empty but only Warden global services (`traefik`/`dnsmasq`/`mailhog`/`phpmyadmin`), no `.env`/`warden-env.yml` for this project | plain (bootstrap case) | unknown | false | status: **incomplete** until bootstrap runs — treated identically to the empty-`docker ps` row above, not routed through Step 1a's `custom` disambiguation |
| `custom` flavor, zero/multiple app-container matches after inspection | unknown | unknown | false | status: **incomplete**, ask the user (existing Step 1a rule) |

## No running environment at all (bootstrap case)

Trigger this section when **either**: Step 1 finds no containers at all, **or** Step 1 finds
containers but all of them are shared/global services (see the "global services only" rule
above) with no `.env`/`warden-env.yml` present in the project directory. Both mean the same
thing — the project has code but no environment yet — apply the `commerce-installation`
skill's "Warden environment bootstrap" section before retrying this skill's Step 1.
