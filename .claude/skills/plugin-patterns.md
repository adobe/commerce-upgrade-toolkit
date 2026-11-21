# Skill: plugin-patterns

## When to use a plugin
- Intercepting a public method on a non-final class
- You need to: modify input args (before), wrap/conditionally skip (around),
  or react to/modify output (after)
- Preferred over preference for all method-level interception

## When NOT to use a plugin
- Target class is final → use observer or preference
- Target method is __construct → not interceptable
- Target method is static → not interceptable
- You need to change constructor args → use virtualType in di.xml
- Performance-critical path + you only need to react → use observer instead

## Before plugin
```php
public function beforeMethodName(
    SubjectClass $subject,
    ArgumentType $arg1,
    ArgumentType $arg2
): array {
    // Modify args and return as array, or return null to leave unchanged
    return [$modifiedArg1, $modifiedArg2];
}
```
Return: array of modified arguments, or null to pass through unchanged.

## After plugin
```php
public function afterMethodName(
    SubjectClass $subject,
    ReturnType $result,
    ArgumentType $arg1  // Original args available but read-only
): ReturnType {
    // Modify and return result (must be same type)
    return $result;
}
```

## Around plugin — USE SPARINGLY
```php
public function aroundMethodName(
    SubjectClass $subject,
    callable $proceed,
    ArgumentType $arg1
): ReturnType {
    // Pre-processing
    $result = $proceed($arg1); // Must call unless intentionally short-circuiting
    // Post-processing
    return $result;
}
```
Performance cost: wraps every call. Prefer before/after.
Legitimate around uses: conditional skip, transaction wrapping, caching.

## di.xml declaration
```xml
<type name="Magento\Catalog\Model\Product">
    <plugin name="vendor_module_product_plugin"
            type="Vendor\Module\Plugin\ProductPlugin"
            sortOrder="10"
            disabled="false"/>
</type>
```

## sortOrder rules
- Omit (defaults to 0) unless ordering against a known other plugin
- Lower number = earlier execution
- Negative values allowed for "must run absolute first"
- Check for existing plugins: bin/magento dev:di:info 'Magento\Catalog\Model\Product'

## Common mistakes to avoid
- Do not declare a plugin on an interface — declare on the concrete class
- Do not use around when before+after would work
- Do not modify $subject state from within a plugin
- Plugin class must NOT be final itself
