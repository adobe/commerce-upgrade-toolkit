# Skill: commerce-installation

---

## Environment bootstrap (code exists, no Docker running)

Use this section when the project has a codebase but no running Docker/local environment yet.
Complete all steps before detecting the environment (see §2 in CLAUDE.md).

Which subsection to use is driven by `context/upgrade-state.md`'s `environment` field — this
is normally pre-filled at project-setup time from the wizard's "Docker setup" question
(`warden | markshust | cloud | bare-metal`). If it is still `~` (unset), ask the user which of
the four they want before proceeding, then record the answer in `environment`.

Steps 1–2 below are shared by every environment. Steps 3–5 branch per `environment` value.

### Step 1 — Read Commerce version from code (no Docker needed)

```bash
# Most reliable — composer.lock records the resolved version
grep -A2 '"name": "magento/magento2-base"' composer.lock | grep '"version"'

# Fallback — composer.json constraint
grep -E '"magento/product-community-edition|magento/product-enterprise-edition|magento/magento-cloud-metapackage"' composer.json
```

Parse the version string (e.g. `2.4.6-p3`) — use the MINOR version (2.4.6) for
the service lookup below. Ignore patch suffix for service version selection.

### Step 2 — Determine correct service versions

The table below is a sanity-check reference only, current as of when this skill was last
updated — Adobe moves these floors with new releases, so treat it as a starting guess, not
the source of truth. Before generating `.env` in Step 3, confirm the detected Commerce
version's actual system requirements via `WebSearch`
(per the `websearch-scope` guardrail) with query:
`"Adobe Commerce {detectedVersion} system requirements PHP MySQL OpenSearch RabbitMQ"`
and use the confirmed values in place of the table below wherever they differ.

Map the detected Commerce version to the required services:

| Commerce | PHP | MariaDB | Search engine | Redis | RabbitMQ | Varnish |
|---|---|---|---|---|---|---|
| 2.2.x | 7.2 | 10.2 | (none — MySQL FTS) | 3.x | — | 5.x |
| 2.3.x | 7.4 | 10.4 | OpenSearch 1.2 or ES 7.x | 5.x | 3.8 (opt) | 6.2 |
| 2.4.0–2.4.1 | 7.4 | 10.4 | OpenSearch 1.2 / ES 7.6+ | 6.x | 3.8 (opt) | 6.x |
| 2.4.2–2.4.3 | 7.4 | 10.4 | OpenSearch 1.2 / ES 7.x | 6.x | 3.8 (opt) | 6.x |
| 2.4.4–2.4.5 | 8.1 | 10.6 | OpenSearch 1.2 / ES 7.x | 6.x | 3.9 (opt) | 7.0 |
| 2.4.6–2.4.7 | 8.2 | 10.6 | OpenSearch 2.x | 7.x | 3.13 (opt) | 7.0 |
| 2.4.8 | 8.3 | 10.6 | **OpenSearch 2.19** (ES removed) | 7.x | 4.x | 7.4 |
| 2.4.9 | 8.4 | 10.6 | OpenSearch 2.x/3.x | 7.x | 4.x | 7.4 |

For any Commerce version released after this table was last updated, skip the table
entirely and rely solely on the `WebSearch` query above.

**In-place upgrade compatibility per service — plan for this, don't discover it by failure:**
Bumping a service's version in `.env` and recreating its container is not uniformly safe as
an in-place operation across services; a genuinely major version jump can require the data
volume to be wiped and recreated rather than upgraded in place, and finding this out from a
failed startup mid-hop costs real diagnostic time. Before bumping, check which case applies:
- **MariaDB**: in-place is normally safe across a major version bump — recreate the
  container against the existing data volume, then run `mariadb-upgrade -uroot -p{password}`
  to update the on-disk format/system tables. Verify it reports all tables OK.
- **OpenSearch / Elasticsearch**: a major Lucene-format jump (e.g. OpenSearch 1.x → 3.x) is
  **not** safe in-place — the new version's Lucene reader cannot open an old on-disk index
  format (`IndexFormatTooOldException` or equivalent). If the existing index holds real data,
  reindex into a fresh index/volume rather than assuming in-place works; if it's a
  low-value dev index (confirm doc count first), wiping and recreating fresh is simpler.
- **RabbitMQ**: a major version bump can require feature flags that don't exist in an older
  data directory (e.g. `direct_exchange_routing_v2` becoming mandatory) — in-place startup
  then fails outright. Confirm there's no durable queue data of consequence (a local dev
  broker usually has none) before wiping the data volume and starting fresh; if there is
  real queued data, follow RabbitMQ's own documented upgrade path for that version pair
  instead of a blind wipe.
- When in doubt for any service not listed here: check that service's own release notes for
  "upgrade" or "migration" guidance before assuming in-place works, and confirm actual data
  loss risk (row/doc/message count) before wiping anything.

### `environment: warden` — Step 3 — Generate Warden `.env`

Create `.env` in the project root with the values from Step 2.
Replace `{PROJECT_NAME}` with the directory name (lowercase, no spaces).

```bash
# Derive a project name from the directory
PROJECT_NAME=$(basename "$PWD" | tr '[:upper:]' '[:lower:]' | tr ' _' '-')
```

Template (adjust PHP_VERSION, MARIADB_VERSION, OPENSEARCH_VERSION, REDIS_VERSION
to the values from the table above):

```dotenv
WARDEN_ENV_NAME={PROJECT_NAME}
WARDEN_ENV_TYPE=magento2
TRAEFIK_DOMAIN={PROJECT_NAME}.test
TRAEFIK_SUBDOMAIN=app
WARDEN_SELENIUM=0
WARDEN_SELENIUM_DEBUG=0
WARDEN_BLACKFIRE=0
WARDEN_SPLIT_SALES=0
WARDEN_SPLIT_CHECKOUT=0
WARDEN_RABBITMQ=0
WARDEN_OPENSEARCH=1
WARDEN_ELASTICSEARCH=0
PHP_VERSION={PHP_VERSION}
PHP_XDEBUG_3=1
COMPOSER_VERSION=2
MARIADB_VERSION={MARIADB_VERSION}
OPENSEARCH_VERSION={OPENSEARCH_VERSION}
REDIS_VERSION={REDIS_VERSION}
VARNISH_VERSION={VARNISH_VERSION}
NODE_VERSION=18
```

Notes (cross-check the version cutoffs below against the Step 2 `WebSearch` query result for the detected version — they're a reference starting point, not authoritative):
- Set `WARDEN_RABBITMQ=1` if the project uses message queues (check `app/etc/env.php` for `queue` section or `app/code/` for `queue_consumer.xml`).
- Set `WARDEN_ELASTICSEARCH=0` / `WARDEN_OPENSEARCH=1` once the confirmed search engine is OpenSearch.
- For versions with no search service configured: set `WARDEN_OPENSEARCH=0` and `WARDEN_ELASTICSEARCH=0`.
- Composer 2.x is required once the confirmed PHP/Composer floor requires it; set `COMPOSER_VERSION=2` always once past that floor.

### `environment: warden` — Step 4 — Sign Warden SSL certificate and start environment

```bash
# One-time CA trust (only needed if not already done on this machine)
warden sign-certificate {PROJECT_NAME}.test

# Start all services defined in .env
warden env up

# Verify containers are running
warden env ps
```

Expected: `php-fpm`, `nginx`, `db`, `opensearch` (or `elasticsearch`), `redis`,
`cache`, `varnish` containers all show `Up` status.

### `environment: warden` — Step 5 — Add /etc/hosts entry (if not using dnsmasq)

```bash
# Check if dnsmasq is handling *.test already
ping -c1 {PROJECT_NAME}.test

# If not resolved, add manually:
echo "127.0.0.1  app.{PROJECT_NAME}.test" | sudo tee -a /etc/hosts
```

---

### `environment: markshust` — Step 3 — Scaffold and start docker-magento

If `bin/start` and `docker-compose.yml` already exist, request exact-command/environment
approval before using those project scripts. Otherwise stop automated bootstrap: Markshust
upstream is outside the strict research allowlist. Ask the human to provision and review
the Docker tooling independently, then resume local environment detection. Do not fetch
third-party bootstrap scripts, pipe network content into tar/shell, or silently bypass the
allowlist via shell instead of WebFetch.

Adjust the generated `.env` (`PHP_VERSION`, `MYSQL_VERSION`/`MARIADB_VERSION`, search engine
version) to match the Step 2 service table for the detected Commerce version.

```bash
bin/start          # builds/pulls images and starts the compose stack
bin/composer install   # only if vendor/ is missing
```

Expected: `phpfpm`, `nginx`/`varnish`, `db`, `opensearch` (or `elasticsearch`), `redis` containers
all show `Up` via `docker-compose ps`.

---

### `environment: cloud` — Step 3 — Build and start the Cloud Docker compose stack

Cloud Docker generates its Docker Compose file from the project's existing
`.magento.app.yaml` / `.magento/services.yaml` / `.magento/routes.yaml` — it does not need a
separate bootstrap `.env`, since the cloud config files already declare service versions.

```bash
composer require magento/magento-cloud-docker --dev
vendor/bin/ece-docker build:compose
docker-compose build
docker-compose up -d
```

Do **not** run `bin/magento setup:install` manually against a Cloud Docker stack — see the
Cloud variant in "Fresh install" below; the equivalent local trigger is
`docker-compose run deploy cloud-deploy` followed by `docker-compose run deploy magento-installer`.
Confirm the exact command names against the current `magento/magento-cloud-docker` README before
running, since this environment sees less use in this toolkit than Warden and may drift.

---

### `environment: bare-metal` — Step 3 — Verify host services

No container to start — confirm PHP, MySQL/MariaDB, and the search engine from the Step 2
table are installed directly on the host and running:

```bash
php --version
mysql --version 2>/dev/null
curl -s http://localhost:9200/_cluster/health 2>/dev/null | grep status   # OpenSearch/ES
```

If any are missing, install them matching the Step 2 version table (via the OS package manager
or Adobe's documented native-install steps), then proceed — there's no container-start step.

---

### Step 6 — Proceed to environment detection (all environments)

Once the chosen environment is up (Warden containers `Up`, docker-magento's compose stack
`Up`, Cloud Docker's compose stack `Up`, or bare-metal services confirmed running), continue
with the standard detection flow below (Step 2 onwards).

---

## Environment detection (running Docker environment)

### Step 1 — Detect Docker environment type

Apply the `environment-detection` skill for dockerType, containerPrefix, PHP version, and
Magento version. If it reports `dockerType: plain` and there is no running environment at
all (no containers, no `.env`/`warden-env.yml`), this is bare-metal / Commerce Cloud, or the
project needs the "Warden environment bootstrap" section above.

### Step 2 — Detect if Commerce is installed

```bash
# Check if DB is configured and Commerce is installed
bin/magento setup:db:status

# Exit codes:
# 0 = DB exists, up to date
# 1 = DB exists but needs upgrade (setup:upgrade required)
# 2 = DB does not exist / Commerce not installed
```

Also verify:
```bash
# Confirm app/etc/env.php exists — never print its contents (it holds DB credentials);
# DB connectivity is already verified by `setup:db:status` above
test -f app/etc/env.php && echo "env.php: present" || echo "env.php: MISSING"

# Confirm composer.json has the right Commerce version
cat composer.json | grep "magento/product-community-edition\|magento/magento-cloud-metapackage"
```

### Step 3 — Detect Commerce edition and version from code

```bash
# Most reliable: composer.json lock file
cat composer.lock | grep -A2 '"name": "magento/magento2-base"'

# Fallback: setup module
cat vendor/magento/magento2-base/composer.json | grep '"version"'
```

---

## Fresh install — when no database exists

### Pre-install checklist

Before running setup:install, verify services are running:

```bash
# Warden environment
warden env up
warden shell

# markshust/docker-magento
docker-compose up -d
docker-compose exec phpfpm bash

# Verify services reachable
php -r "new PDO('mysql:host=db;dbname=magento', 'magento', 'magento');" && echo "DB OK"
curl -s http://opensearch:9200/_cluster/health | grep status    # or elasticsearch:9200
redis-cli -h redis ping                                          # should return PONG
```

### setup:install command — environment variants

**Warden (standard local):**
```bash
bin/magento setup:install \
  --base-url=https://${WARDEN_ENV_NAME}.test/ \
  --base-url-secure=https://${WARDEN_ENV_NAME}.test/ \
  --db-host=db \
  --db-name=magento \
  --db-user=magento \
  --db-password=magento \
  --admin-firstname=Admin \
  --admin-lastname=User \
  --admin-email=admin@${WARDEN_ENV_NAME}.test \
  --admin-user=admin \
  --admin-password=Admin@123456 \
  --language=en_US \
  --currency=USD \
  --timezone=Australia/Sydney \
  --use-rewrites=1 \
  --search-engine=opensearch \
  --opensearch-host=opensearch \
  --opensearch-port=9200 \
  --cache-backend=redis \
  --cache-backend-redis-server=redis \
  --cache-backend-redis-db=0 \
  --page-cache=redis \
  --page-cache-redis-server=redis \
  --page-cache-redis-db=1 \
  --session-save=redis \
  --session-save-redis-host=redis \
  --session-save-redis-db=2
```

**markshust/docker-magento:**
```bash
bin/magento setup:install \
  --base-url=https://magento.test/ \
  --db-host=db \
  --db-name=magento \
  --db-user=magento \
  --db-password=magento \
  --admin-firstname=Admin \
  --admin-lastname=User \
  --admin-email=admin@example.com \
  --admin-user=admin \
  --admin-password=Admin@123456 \
  --language=en_US \
  --currency=USD \
  --timezone=America/New_York \
  --use-rewrites=1 \
  --search-engine=opensearch \
  --opensearch-host=opensearch \
  --opensearch-port=9200
```

**Commerce Cloud (integration environment):**
```bash
# Cloud: DO NOT run setup:install manually
# The platform runs it via ece-tools deploy hook
# Trigger a redeploy instead:
git commit --allow-empty -m "trigger: fresh install"
git push origin <branch>
```

**Bare-metal / custom Docker:**
```bash
# Adjust host/port/credentials to match your docker-compose.yml
bin/magento setup:install \
  --base-url=http://localhost/ \
  --db-host=127.0.0.1 \
  --db-name=magento \
  --db-user=root \
  --db-password=root \
  --admin-user=admin \
  --admin-password=Admin@123456 \
  --admin-email=admin@example.com \
  --language=en_US \
  --currency=USD \
  --timezone=UTC \
  --use-rewrites=1 \
  --search-engine=mysql   # only if ES/OS not available in the environment
```

### Post-install steps

```bash
bin/magento deploy:mode:set developer
bin/magento cache:flush
bin/magento indexer:reindex
```

---

## Sample data deployment

### When to deploy sample data

Deploy sample data when:
- Testing an upgrade path and you need realistic data to validate:
  - Schema migrations (db_schema.xml changes run against populated tables)
  - Data patches (DataPatchInterface::apply() runs against real rows)
  - Indexer reindex completes without timeout
  - Search returns results (OpenSearch index populated)
  - Category/product pages render with actual content

### Sample data commands

```bash
# Method 1: via Composer (preferred — installs correct version for your Commerce)
composer require magento/sample-data-media --no-interaction
bin/magento sampledata:deploy
bin/magento setup:upgrade
bin/magento indexer:reindex
bin/magento cache:flush

# Verify sample data loaded
bin/magento sampledata:status   # should show all modules as 'Installed'
```

```bash
# Method 2: via CLI flag during setup:install (add to install command above)
--use-sample-data
```

### What sample data provides for upgrade testing

| Commerce area | Sample data added | Why it matters for upgrade |
|--------------|-------------------|---------------------------|
| Catalog | 500+ products, 8 categories | Validates product attribute migrations |
| Customers | 200+ customer accounts | Validates customer schema changes |
| Orders | 100+ orders in all states | Validates sales/quote schema changes |
| CMS | Pages, blocks, widgets | Validates layout/block removals |
| Config | Multiple store views | Validates multi-store config migrations |

### Sample data + upgrade testing workflow

```
Install at current version
      ↓
Deploy sample data
      ↓
Verify storefront renders, search works, checkout works (baseline)
      ↓
Run setup:upgrade to target version
      ↓
Verify same pages still work (regression check)
      ↓
Compare exception.log before and after (look for new errors)
```

---

## Detecting install type for upgrade workflow decision

```
bin/magento setup:db:status exit code:
  0 → existing install, DB up to date   → proceed to Gate 4 (encryption gate) of
                                           `/upgrade-hop-execute`'s Pre-Execution Gate
  1 → existing install, needs upgrade   → run setup:upgrade first, then proceed
  2 → not installed                     → offer fresh install + sample data option
  error → env.php missing / DB unreachable → fix environment first
```

---

## Version consistency check (after install)

Before starting upgrade scan, confirm installed version matches the source of the upgrade:

```bash
bin/magento --version
# Compare against fromVersion in upgrade arguments
# Mismatch = stop and confirm which version to use as baseline
```
