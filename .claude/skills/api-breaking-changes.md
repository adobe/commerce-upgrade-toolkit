# Skill: api-breaking-changes

Covers two things needed for every upgrade hop: (1) what broke and how severe it is, and
(2) the replacement pattern to apply. Apply this skill when categorising UCT findings or
remediating deprecated / removed APIs.

---

## Severity Classification

CRITICAL — blocks upgrade, causes fatal error at deploy time:
- Class removed with no replacement → fatal autoload error
- DB table schema conflict with core (column removed, type changed) → setup:upgrade fails
- Interface method signature changed → type error or DI compile failure
- Plugin target method removed or made final → DI compile failure

HIGH — will cause runtime error in production:
- Deprecated class that is fully removed in target → fatal at first instantiation
- Observer event removed → silent data loss (order not processed, etc.)
- Constructor argument added to injectable you extend → instantiation error
- Layout handle removed → missing block, visual break in checkout/account

MEDIUM — degrades functionality without fatal:
- Template override for block with changed output contract → visual regression
- Config path renamed (system.xml) → setting silently ignored
- ACL resource key changed → admin permission breaks

LOW — future risk, no immediate failure:
- Deprecated method still present but annotated @deprecated → will break in next major
- CSS class renamed in Blank/Luma (for Hyva: usually irrelevant)
- Non-critical admin grid column change

---

## Per-Type Remediation

### API_CHANGES
1. Read the `@deprecated` docblock or release notes for replacement method
2. Update the call site to use the new signature
3. If this is a plugin target: check if before/after type hints need updating

### DEPRECATED_CLASS
1. Read `@deprecated` annotation for replacement class name
2. Update use statement and any DI preference declarations
3. Common substitutions — see **Replacement Patterns** below

### PLUGIN_INTERSECTION
1. Verify the method no longer exists: `grep -r "function {methodName}" vendor/magento/`
2. If method is gone: remove the plugin entirely, reassess if behaviour is still needed
3. If method was renamed: re-target the plugin to the new method name

### PREFERENCE_CONFLICT
1. Read the new constructor of the preferred class
2. Update your preference class constructor to match new injections
3. Test: `bin/magento setup:di:compile`

### DB_SCHEMA_CHANGES
1. Identify the conflict: your `db_schema.xml` vs core's `db_schema.xml`
2. If you added a column that core now also adds → remove yours if semantically identical
3. If you modified a core column → revert and use plugin/observer instead

### LAYOUT_OVERRIDE
1. Check if the block still exists in target version
2. If removed: update layout XML to reference the replacement block
3. If handle removed: check new handle name in release notes

### TEMPLATE_OVERRIDE
1. Diff your template against the new core version: `git diff vendor/magento/.../template.phtml`
2. Merge core changes into your override: preserve your customisations, adopt core structure
3. If your override is minimal: consider removing it and using ViewModel instead

---

## Replacement Patterns

### How to find a replacement
1. Read the `@deprecated` docblock — it always names the replacement
2. Check https://developer.adobe.com/commerce/php/development/backward-incompatible-changes/
3. Search vendor/magento/ for the replacement: `grep -r "class NewClassName"`

### ObjectManager (always wrong outside factory/proxy)
```php
// WRONG
$objectManager = \Magento\Framework\App\ObjectManager::getInstance();
$product = $objectManager->create(\Magento\Catalog\Model\Product::class);

// CORRECT — inject factory via constructor
public function __construct(
    private readonly \Magento\Catalog\Model\ProductFactory $productFactory
) {}
$product = $this->productFactory->create();
```

### Zend Framework → Laminas (2.4.4+)
```php
// WRONG (removed in 2.4.4)
use Zend\Http\Client;
use Zend\Stdlib\Parameters;
use Zend\Validator\EmailAddress;

// CORRECT
use Laminas\Http\Client;
use Laminas\Stdlib\Parameters;
use Laminas\Validator\EmailAddress;
```

### AbstractModel::load() → Repository
```php
// WRONG (deprecated)
$product = $this->productFactory->create()->load($productId);

// CORRECT
$product = $this->productRepository->getById($productId);
```

### Resource model paths (renamed in 2.2+)
```php
// WRONG
use Magento\Catalog\Model\Resource\Product;

// CORRECT
use Magento\Catalog\Model\ResourceModel\Product;
```

### Helper classes with business logic → Service classes
```php
// WRONG — Helper with business logic
class Data extends \Magento\Framework\App\Helper\AbstractHelper
{
    public function calculateDiscount(float $price): float { ... }
}

// CORRECT — Plain service class with constructor injection
class DiscountCalculator
{
    public function calculate(float $price): float { ... }
}
```

### Block with data logic → ViewModel
```php
// WRONG — Block doing data work
class ProductBlock extends \Magento\Framework\View\Element\Template
{
    public function getProductCollection(): Collection { ... }
}

// CORRECT — ViewModel
class ProductViewModel implements \Magento\Framework\View\Element\Block\ArgumentInterface
{
    public function getProductCollection(): Collection { ... }
}
```

### PHP 8.1/8.2+ deprecations
```php
// WRONG — null passed to non-nullable (TypeError in PHP 8.1)
formatName(null);

// WRONG — deprecated string interpolation (PHP 8.2)
$msg = "Hello ${name}";

// CORRECT
$msg = "Hello {$name}";

// WRONG — dynamic properties (deprecated PHP 8.2, error PHP 9.0)
class Foo {}
$foo = new Foo();
$foo->bar = 'value';

// CORRECT — declare properties explicitly
class Foo {
    public string $bar = '';
}
```

### Automated PHP upgrade with Rector
```bash
composer require rector/rector --dev

# rector.php
return RectorConfig::configure()
    ->withPaths([__DIR__ . '/app/code'])
    ->withSets([LevelSetList::UP_TO_PHP_81])
    ->withSkip([__DIR__ . '/app/code/*/Test/*']);

vendor/bin/rector process
```

---

## Version-Specific Critical Breaks

Everything below is a sanity-check reference compiled at the time this skill was last
updated — it goes stale with every Adobe release and covers only the version pairs known at
that time. It is never the authoritative source for a real hop: the authoritative source is
the `knownBreakers` list recorded during `/upgrade-hop` analysis (from the
`websearch-scope`-scoped `WebSearch` query for this hop's actual `fromVersion`→`targetVersion`
pair). Use this section to sanity-check that `knownBreakers` isn't missing something
obvious, and to source ready-made fix patterns for breaks it does confirm — never as a
substitute for confirming this hop's specific range, and never for a version pair not
listed here (query `WebSearch` directly instead of assuming "no breaks" from its absence).

Infra-floor version numbers (PHP, MariaDB, search engine, Redis, RabbitMQ, Varnish) for
every Commerce version live in exactly one place — the `commerce-installation` skill's
"Determine correct service versions" table. Do not restate a specific version number in this
section; an earlier version of this file did (independently claiming "PHP 8.3 fully supported"
for the 2.4.6→2.4.7 boundary), and it drifted out of sync with that table, which pins the floor
at PHP 8.2 for the same range (8.3 only becomes the floor at 2.4.8). Each entry below points to
that table for the number and keeps only the code-level fix, which is this skill's unique value.

### 2.3.x → 2.4.0
- Search engine floor changes at this boundary — see `commerce-installation`'s service-version
  table for the exact engine/version; MySQL search engine is removed as of here.
  Fix: provision the required search engine, set SEARCH_CONFIGURATION in .magento.env.yaml
- 2FA is mandatory for admin
  Fix: if blocking, temporarily disable with: `bin/magento module:disable Magento_TwoFactorAuth`

### 2.4.3 → 2.4.4
- PHP floor bump at this boundary — see `commerce-installation`'s table for the exact version.
  Fix: run Rector: `vendor/bin/rector process app/code --config rector.php`
- Zend Framework → Laminas: global find-replace `Zend_` → `Laminas_` in `app/code/`
- Composer floor bump — see the same table for the required major version; update in CI and
  local environment

### 2.4.4 → 2.4.5
- GraphQL cart mutations: `addSimpleProductsToCart` merged into `addProductsToCart`
  Fix: update any storefront code using the old mutation name

### 2.4.5 → 2.4.6
- IMS module refactored: `BackendAuthSessionPlugin` moved
  Fix: check for any plugins on the old IMS class paths

### 2.4.6 → 2.4.7
- No infra-floor bump confirmed at this boundary per `commerce-installation`'s table — check
  that table for this project's actual `toVersion` floor before assuming a PHP bump here.
  Fix: run PHPStan on `app/code/` to catch any deprecated-construct fallout from whichever PHP
  version the table confirms.

### 2.4.7 → 2.4.8
- **Encryption key rotation UI removed** — Admin > System > Manage Encryption Key is gone;
  this changes the *method* available (admin-ui → CLI), it does not by itself create a
  rotation *requirement*. Do not treat "2.4.8" as a confirmed rotation-required cutoff here
  — apply the `encryption-and-passwords` skill, which dynamically confirms both whether
  rotation is actually needed and the exact method-change version via `WebSearch`/native
  command checks. The skill returns an allowed-source proposal for live human review
  of both required and not-required decisions. Only the approved orchestrator records
  reviewed non-secret `encryptionDecision` metadata and the required/method fields for
  this hop; no research result authorizes rotation or silently sets those fields.
- Search engine and RabbitMQ floor bumps at this boundary — see `commerce-installation`'s
  table for the exact versions (ES support removed; RabbitMQ major version bump).
  Fix: update `.magento/services.yaml` to the confirmed engine and RabbitMQ version, rebuild
  indexes post-migration.

### 2.4.8 → 2.4.9
- **`elasticsearch7` search engine module removed.** Any project still configured with
  `catalog/search/engine = elasticsearch7` must migrate its search-engine config as part of
  this hop, not after — indexing/search breaks post-upgrade otherwise.
  Fix: if the project is actually running OpenSearch (common even on pre-2.4.9 installs,
  since OpenSearch has always spoken the Elasticsearch 7 wire protocol and was frequently
  configured via the `elasticsearch7` engine for that reason), switch to the dedicated
  `opensearch` engine (`module-open-search`) — **not** `elasticsearch8`. Adobe's own
  Elasticsearch 8 client hard-rejects non-Elastic distributions via a product-check, so it
  is not a viable path against OpenSearch regardless of version; only use `elasticsearch8`
  if the project is running genuine Elastic 8.x. Set `catalog/search/engine` and the
  `catalog/search/opensearch_server_hostname` / `_port` / `_index_prefix` / `_timeout` /
  `_enable_auth` config paths accordingly, then reindex.
- PHP floor bump at this boundary — see `commerce-installation`'s table for the exact version.

### 2.2.x → 2.3.x (password hashing)
- Password hashing upgrades from SHA-256 to bcrypt/argon2id
  Impact: zero customer/admin access loss — rehash happens silently on first login
  Action: send password reset to security-critical admin accounts post-upgrade
