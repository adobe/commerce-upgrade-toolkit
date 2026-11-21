# Architecture

<!-- Fill this in for your project -->

## Environment topology
| Environment | Purpose | URL pattern |
|---|---|---|
| production | Live store | store.example.com |
| staging | UAT / pre-prod | staging.example.com |
| qa | QA testing | qa.example.com |
| integration | Dev integration | *.integration.example.com |

## Stack
- Commerce 2.4.x EE on Adobe Commerce Cloud PaaS
- PHP 8.3, Composer 2.7
- OpenSearch 2.x (search)
- Redis 7.x (cache + sessions, separate instances)
- RabbitMQ 3.11 (async queue)
- Hyva 1.3 (frontend theme)

## Integration map
<!-- Replace with this project's actual integrations — delete any branch that doesn't
     apply (e.g. no SSO federation, no CDP, no serverless runtime). Example below shows
     a common Adobe-ecosystem shape; see .github/context/integrations.md for details. -->
```
Commerce (PaaS)
    │
    ├── [Admin SSO / IdP] ──────── [federated identity provider]
    │   └── Admin SSO via OAuth 2.0 / SAML 2.0
    │       (example: Adobe IMS ── Microsoft Entra ID, SAML 2.0 federation)
    │
    ├── [Serverless / integration runtime] (example: Adobe App Builder)
    │   ├── Receives Commerce events
    │   ├── Transforms to the CDP's data format (example: XDM)
    │   └── Forwards to the CDP (example: AEP Datastream, OAuth S2S)
    │
    ├── [CDP] (example: Adobe Experience Platform / RTCDP)
    │   └── Receives events, builds profiles
    │
    ├── [Journey orchestration] (example: Adobe Journey Optimizer)
    │   └── Triggers journeys from CDP events
    │
    └── [Add ERP, PIM, OMS connections here]
```

## Custom module locations
- All custom modules: app/code/Vendor/
- All custom themes: app/design/frontend/Vendor/ and app/design/adminhtml/Vendor/
- Hyva child theme: app/design/frontend/Vendor/HyvaChild/

## Key configuration paths
- Cache backend: Redis (see .magento.env.yaml CACHE_CONFIGURATION)
- Session storage: Redis (see .magento.env.yaml SESSION_CONFIGURATION)
- Search engine: OpenSearch (see .magento.env.yaml SEARCH_CONFIGURATION)
- Admin URL: configured via ADMIN_URL env variable
