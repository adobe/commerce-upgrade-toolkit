# Coding standards

## PHP
- PHP 8.3, strict_types=1 on all new files
- Constructor property promotion for all injected dependencies
- Return types on all methods (including void)
- Named arguments when calling with 4+ params
- No mixed types unless unavoidable (and must be documented)
- No @suppress annotations without a comment explaining why

## Magento 2 specific
- No ObjectManager::getInstance() — constructor injection always
- No _init() in models — use resource model via DI
- No Mage:: calls (legacy 1.x — should never appear in 2.x code)
- All new DB structures via db_schema.xml declarative schema
- All data seeding via Setup\Patch\Data\, never UpgradeData
- Plugins preferred over preferences (preference = last resort)
- ViewModel for template data; Block stays thin
- GraphQL resolvers return arrays, not Model objects
- Repository pattern for all data access in service layer

## File naming
- Classes: PascalCase, one class per file, filename matches class name
- Interfaces: PascalCase + Interface suffix (ProductRepositoryInterface)
- Tests: ClassNameTest.php in Test/Unit/ or Test/Integration/ mirroring src structure

## PHPCS ruleset
Standard: Magento2
Run: vendor/bin/phpcs --standard=Magento2 app/code/
Auto-fix: vendor/bin/phpcbf --standard=Magento2 app/code/

## PHPStan
Level: 8
Config: phpstan.neon in project root
Run: vendor/bin/phpstan analyse app/code/ --level=8

## Git conventions
Branch naming: feature/{ticket-id}-short-description
               bugfix/{ticket-id}-short-description
               upgrade/{from-version}-to-{to-version}
Commit format: {TYPE}({scope}): short description
               TYPE: feat|fix|perf|test|chore|docs|upgrade
               Example: feat(catalog): add custom product attribute for subscription

**Hard rule:** NEVER add `Co-Authored-By:` trailers to commit messages — not for Claude, not for any tool. Commit messages contain only the subject line and optional body.

## Code review required for
- Any change to payment processing (PCI scope)
- Any change to authentication or session handling
- Any new API endpoint (webapi.xml)
- Any new admin ACL resource
- Any db_schema.xml change
- Any new AEP integration or XDM mapping
