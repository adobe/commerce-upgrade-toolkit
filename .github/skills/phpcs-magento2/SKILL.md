---
name: phpcs-magento2
description: "vendor/bin/phpcs --standard=Magento2 app/code/"
---

# Skill: phpcs-magento2

## Running PHPCS
```bash
# Full check against Magento2 standard
vendor/bin/phpcs --standard=Magento2 app/code/

# Specific file or directory
vendor/bin/phpcs --standard=Magento2 app/code/Vendor/Module/

# With report format for CI
vendor/bin/phpcs --standard=Magento2 --report=checkstyle app/code/ > phpcs-report.xml

# Auto-fix what can be auto-fixed
vendor/bin/phpcbf --standard=Magento2 app/code/Vendor/Module/
```

## Running PHPStan
```bash
# Level 8 (strictest used in Commerce)
vendor/bin/phpstan analyse app/code/ --level=8

# Specific module
vendor/bin/phpstan analyse app/code/Vendor/Module/ --level=8

# With baseline (to ignore pre-existing issues)
vendor/bin/phpstan analyse --generate-baseline
vendor/bin/phpstan analyse --level=8
```

## Most common PHPCS violations in Commerce code

Magento2.Functions.DiscouragedFunction — use of deprecated PHP functions
→ Replace func_get_args() with variadic parameters, etc.

Magento2.Security.XssTemplate — unescaped output in .phtml
→ Wrap all echo/print with $block->escapeHtml() or $block->escapeUrl()

Magento2.SQL.RawQuery — direct SQL construction
→ Use Zend_Db_Select or connection->quoteInto()

Magento2.PHP.LiteralNamespaces — string class names
→ Use ::class constant instead

Generic.Files.LineLength — lines over 120 chars
→ Break into multiple lines

## phpstan.neon configuration for Commerce
```neon
parameters:
    level: 8
    paths:
        - app/code
    excludePaths:
        - app/code/*/Test/*
        - app/code/*/Setup/*
    ignoreErrors:
        # Commerce-specific false positives
        - '#Call to an undefined method Magento\\Framework\\Data\\Collection#'
    bootstrapFiles:
        - vendor/autoload.php
```

## Suppressing false positives (use sparingly)
```php
// phpcs:ignore Magento2.Security.XssTemplate.OutputNotSanitized
echo $this->getData('safe_html_content');

// @phpstan-ignore-next-line
$result = $this->_getData('legacy_method');
```

## Common PHPStan level 8 issues in Commerce
- AbstractModel::getData() returns mixed → add type assertion or use typed accessor
- Event observers receive DataObject → type-check before accessing
- Magic __get/__set → use typed getters from Data interfaces
