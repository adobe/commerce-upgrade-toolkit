---
name: di-xml-patterns
description: "<type name=\"Magento\\Catalog\\Model\\Product\"> <plugin name=\"vendor_module_product_name_plugin\" type=\"Vendor\\Module\\Plugin\\ProductPlugin\" sortOrder=\"10\"/> </type>"
---

# Skill: di-xml-patterns

## Plugin declaration
```xml
<type name="Magento\Catalog\Model\Product">
    <plugin name="vendor_module_product_name_plugin"
            type="Vendor\Module\Plugin\ProductPlugin"
            sortOrder="10"/>
</type>
```

## Preference (use sparingly — last resort for replacing a class)
```xml
<preference for="Magento\Catalog\Api\ProductRepositoryInterface"
            type="Vendor\Module\Model\ProductRepository"/>
```
Warning: two preferences for the same interface cause DI compile conflict.
Check existing preferences: bin/magento dev:di:info 'Interface\FQCN'

## VirtualType (preferred over preference for config-only changes)
```xml
<!-- Create a configured instance without a new class -->
<virtualType name="Vendor\Module\Model\SpecialLogger"
             type="Magento\Framework\Logger\Monolog">
    <arguments>
        <argument name="name" xsi:type="string">vendor_module</argument>
        <argument name="handlers" xsi:type="array">
            <item name="system" xsi:type="object">Magento\Framework\Logger\Handler\System</item>
        </argument>
    </arguments>
</virtualType>
```

## Constructor argument injection
```xml
<type name="Vendor\Module\Model\SomeClass">
    <arguments>
        <argument name="logger" xsi:type="object">Vendor\Module\Model\SpecialLogger</argument>
        <argument name="configValue" xsi:type="string">custom_value</argument>
        <argument name="flag" xsi:type="boolean">true</argument>
        <argument name="poolList" xsi:type="array">
            <item name="key" xsi:type="string">value</item>
        </argument>
    </arguments>
</type>
```

## Proxy (for breaking circular dependencies or lazy-loading heavy classes)
```xml
<type name="Vendor\Module\Model\SomeClass">
    <arguments>
        <argument name="heavyDep" xsi:type="object">Magento\HeavyClass\Proxy</argument>
    </arguments>
</type>
```
Proxy is auto-generated at setup:di:compile.

## Factory injection (for creating new object instances)
Factories are auto-generated — declare in constructor, no XML needed:
```php
public function __construct(
    private readonly \Vendor\Module\Model\EntityFactory $entityFactory
) {}
// Usage: $entity = $this->entityFactory->create(['data' => $data]);
```

## Scope-specific di.xml
- etc/di.xml → global scope
- etc/frontend/di.xml → frontend only
- etc/adminhtml/di.xml → admin only
- etc/webapi_rest/di.xml → REST API only
- etc/graphql/di.xml → GraphQL only

## Common errors
- "Circular dependency" → use Proxy on one side of the cycle
- "Plugin targeting non-existent method" → method removed or class refactored
- "Two preferences for same interface" → use virtualType or consolidate
- "Class X does not exist" → check namespace and autoload
