# Guardrail: pii-protection

## Rule
Never include customer PII in log statements, error messages, code comments,
or any output that could be captured in log aggregation tools.

## What counts as PII in Commerce context
- Customer email address
- Customer name (first, last, full)
- Physical address (street, city, postcode, country)
- Phone number
- Date of birth
- IP address (when linked to identity)
- Payment card data (any — see pci-checklist skill)
- Order contents when linkable to a specific person
- Admin user credentials or session tokens

## Logging rules
```php
// WRONG — PII in log
$this->logger->info('Customer registered: ' . $customer->getEmail());
$this->logger->debug('Order placed', ['customer' => $customer->getData()]);

// CORRECT — IDs only
$this->logger->info('Customer registered', ['customer_id' => $customer->getId()]);
$this->logger->debug('Order placed', ['order_id' => $order->getId(), 'total' => $order->getGrandTotal()]);
```

## Sanitization rules (for db-sanitize command)
When generating or running sanitization scripts:
- Always use replacement values, never log original PII values
- Replacements must be realistic enough to pass validation (valid email format, etc.)
- Hash-based email replacement: md5($customerId) . '@example.com'
- Names: 'Test' + 'User' + sequential number
- Addresses: use static fake addresses (never real ones)
- Phones: use 555-xxxx pattern (reserved for fiction in US)
- Never output "before → after" comparisons in logs

## External integration rules (CDP / journey orchestration / serverless connectors)
- Never include PII in serverless/integration action log output (e.g. Adobe App Builder)
- Event payloads sent to a CDP may include email for identity stitching — this is
  expected and must go over HTTPS to the CDP, not into log files (e.g. XDM → Adobe AEP)
- Always confirm: logger.info('Event processed', { eventType, entityId }) — IDs only
- See @.claude/context/integrations.md for which integrations actually apply to this project

## GDPR / CCPA implications
- Any new field storing PII must be registered in the data processing inventory
- Right to erasure: new PII fields need a deletion handler
- Flag to tech lead before adding any new PII storage

## Production environment
- MAGE_MODE=production suppresses most debug output — do not override
- Never enable MAGE_PROFILER in production
- New Relic custom attributes: use order IDs and product SKUs, not customer data
