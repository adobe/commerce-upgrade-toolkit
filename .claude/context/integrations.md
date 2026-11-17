# Integrations

<!-- Fill in endpoints, credentials references (NOT actual credentials), and patterns.
     Each section below shows a generic shape plus an Adobe-ecosystem example — replace
     the example with your project's actual integration, or delete the section if it
     doesn't apply. Add new sections for anything not listed here. -->

## Admin SSO / identity provider
Pattern: [Commerce → IdP auth flow, e.g. OAuth 2.0 / SAML 2.0 federation]
Token validation: [JWKS endpoint preferred over a static secret]
Re-validation interval: [document any hardcoded session re-validation interval]
Credentials: [where stored, e.g. app/etc/env.php — never in code]
<!-- Example (Adobe IMS + Microsoft Entra ID): Commerce → Adobe IMS (OAuth 2.0) →
     Entra ID (SAML 2.0 federation). IMS re-validation interval: 10 minutes (hardcoded
     in BackendAuthSessionPlugin). JWKS endpoint: https://ims-na1.adobelogin.com/ims/keys
     (update for your IMS org). Credentials in app/etc/env.php (imsConfig section). -->

## Customer Data Platform (CDP)
Auth pattern: [e.g. OAuth Server-to-Server / API key]
Endpoint: [ingestion or datastream URL]
Org/tenant ID: [your org id]
Client ID: [reference to vault/env var — not the value]
Credentials location: [never in the Commerce codebase]
Data format: [e.g. XDM, custom JSON]
<!-- Example (Adobe Experience Platform / RTCDP): OAuth Server-to-Server
     (client_credentials grant). Datastream URL: https://server.adobedc.net/ee/v2/interact.
     IMS Org ID: [your-org]@AdobeOrg. Credentials in App Builder .env. Data format: XDM
     (ExperienceEvent for behavioural, Profile for customer data). -->

## Marketing automation / journey orchestration
Integration via: [e.g. CDP events → journey trigger]
API: [endpoint]
Active journeys: [document journey names and trigger events here]
<!-- Example (Adobe Journey Optimizer): triggered via AEP events → AJO journey.
     Journey API: https://platform.adobe.io/data/foundation/flowservice/ -->

## Serverless / integration runtime
Namespace: [your namespace]
Runtime endpoint: [your runtime URL]
Actions: [list deployed action names here]
Credentials: [.env location]
<!-- Example (Adobe App Builder): Namespace [your-namespace]. Runtime endpoint
     https://[namespace].adobeioruntime.net. Credentials: .env in the App Builder
     project root. -->

## GraphQL API (Commerce)
Endpoint: /graphql
Auth: Bearer token (customer token from generateCustomerToken mutation)
M2M auth: [document — e.g. JWKS-validated JWT, API key — not a static secret]
HTTP response: always 200 — errors in body `errors[]` array

## [ERP — add yours]
System: [SAP / NetSuite / etc.]
Integration pattern: [REST / message queue / file-based]
Sync frequency: [real-time / scheduled]
Credentials ref: [vault path or env var name]

## [PIM — add yours]
System: [Akeneo / inRiver / etc.]
Sync direction: PIM → Commerce (product catalog, attributes)
Sync method: [integration action / direct API / cron]
Credentials ref: [vault path or env var name]

## [OMS — add yours]
System: [custom / Magento OMS / external]
Integration: [order placed webhook → OMS / OMS status updates → Commerce]
