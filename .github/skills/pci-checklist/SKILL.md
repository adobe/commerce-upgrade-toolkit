---
name: pci-checklist
description: "In scope by default:"
---

# Skill: pci-checklist

## PCI DSS scope for Commerce
In scope by default:
- Any code that processes, stores, or transmits cardholder data
- Payment module plugins and observers
- Order and quote models when payment data is present
- Admin controllers that display payment information
- API endpoints that return order/payment data

Out of scope (if properly implemented):
- Hosted payment forms (Braintree hosted fields, Stripe.js)
- Tokenisation via payment gateway (Commerce stores token, not PAN)

## Cardholder data — NEVER store or log
- Full PAN (Primary Account Number) — 16-digit card number
- CVV/CVC/CVV2 — 3-4 digit security code (illegal to store post-auth)
- Magnetic stripe data
- PIN or PIN block

## What Commerce stores by default (acceptable)
- cc_last_4 — last four digits only
- cc_type — card brand (Visa, MC, etc.)
- cc_exp_month, cc_exp_year — expiry (not stored post-auth in strict PCI)

## Code review checks for PCI scope

OUTPUT ESCAPING (XSS → PCI data exposure)
```php
// WRONG
echo $payment->getData('cc_number');

// CORRECT
echo $block->escapeHtml($payment->getCcLast4());
```

LOG CHECKING (never log payment data)
```php
// WRONG
$this->logger->debug('Payment data: ' . json_encode($paymentData));

// CORRECT
$this->logger->debug('Payment processed', ['order_id' => $orderId, 'method' => $method]);
```

ACL (admin controllers showing payment data)
```xml
<!-- acl.xml — required for every admin controller -->
<resource id="Vendor_Module::payment_view" title="View Payment Information"/>
```
```php
// Controller — must check ACL
protected function _isAllowed(): bool
{
    return $this->_authorization->isAllowed('Vendor_Module::payment_view');
}
```

API ENDPOINTS (webapi.xml)
```xml
<!-- Never allow anonymous access to payment/order endpoints -->
<route url="/V1/vendor/orders/:orderId/payment" method="GET">
    <service class="Vendor\Module\Api\PaymentInfoInterface" method="get"/>
    <resources>
        <resource ref="Magento_Sales::sales"/>  <!-- NOT anonymous -->
    </resources>
</route>
```

## HTTPS enforcement
- All payment-related pages must enforce HTTPS
- Check: bin/magento config:show web/secure/use_in_frontend should be 1 in production
- Check: web/secure/use_in_adminhtml should be 1

## Dependency on payment modules
- If adding sequence dependency on payment modules, note PCI review requirement in module.xml comment

## Encryption / crypt-key changes in PCI-scoped code
- Any change touching `EncryptorInterface` usage, `di.xml` preferences/plugins near payment
  code, or `app/etc/env.php` in a PCI-scoped module is both PCI-flagged *and* crypto-flagged —
  apply the `encryption-safety` guardrail in full (no custom cipher/KDF code, no Encryptor
  preferences, no logged key material) in addition to this checklist.
- Per `CLAUDE.md`, PCI/auth-flagged findings must be handed to `commerce-security-reviewer`
  before marking done — this applies without exception to anything touching stored payment
  tokens, vault data, or the crypt key, even a "like-for-like" rotation or re-encrypt command.
