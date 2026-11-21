# Prompt: upgrade-scope-estimate

## Purpose
Turn UCA findings and project context into a **stakeholder-ready effort estimate and risk matrix**.
Use after `/upgrade-hop {version}`'s Analysis Mode (SCAN + ANALYSE phases) has populated
`context/upgrade-state.md` and `context/upgrade-findings.md`.
Produces the "should we upgrade now, and what will it cost?" answer for project managers and architects.

## Effort tier reference
| Tier | Blockers | Estimated effort |
|------|----------|-----------------|
| Minimal | 0 | Direct upgrade |
| Low | 1–5 | 1–4 hours |
| Medium | 6–15 | 4–16 hours (1–2 sprints) |
| High | 16–30 | 16–40 hours |
| Very High | 30+ | Full audit required |

## Prompt template
```
Produce a stakeholder-ready upgrade scope estimate for Adobe Commerce.

From version: {e.g. 2.4.4-p3}
To version: {e.g. 2.4.8}
Intermediate hops: {list from the active /upgrade-hop plan's Hop plan table in context/upgrade-state.md — boundaries are architect judgment, not a fixed sequence}
Custom module count: {n}
Third-party extension count: {n}

UCA findings summary:
- CRITICAL: {n} ({list types e.g. DB_SCHEMA_CHANGES: 2, DEPRECATED_CLASS: 1})
- HIGH: {n}
- MEDIUM: {n}
- LOW: {n}

Notable findings (paste top 5–10 from upgrade-state.md or describe):
{findings}

Infrastructure changes in this hop:
- PHP version change: {from → to, or none}
- Search engine change: {e.g. ES 7 → OpenSearch 2.19, or none}
- MySQL version change: {e.g. 5.7 → 8.0, or none}
- Composer version change: {1 → 2, or none}
- Zend → Laminas migration required: {yes | no}
- Encryption key rotation required: {yes | no}

Produce the following sections:

1. EFFORT TIER
   Apply the tier table. State the tier and total blocker count (CRITICAL + HIGH).

2. RISK MATRIX
   For each blocker category present, rate: probability of regression × blast radius.
   Use: LOW / MEDIUM / HIGH / CRITICAL for each row.
   Include: DB_SCHEMA, API_CHANGES, DEPRECATED_CLASS, PLUGIN_INTERSECTION,
            infrastructure (PHP, search, MySQL), Zend migration (if applicable).

3. RECOMMENDED APPROACH
   - Staged (hop by hop) or direct to target? State which and why.
   - Pre-upgrade prep steps (encryption key rotation, Laminas migration, etc.)
   - Estimated calendar time assuming one developer (include testing buffer).

4. DEPENDENCIES AND BLOCKERS
   - Third-party extensions: list any that are known to lag behind Commerce releases.
   - PHP version change: any known Rector passes required?
   - Cloud infrastructure changes: any .magento/services.yaml updates needed?

5. RECOMMENDATION FOR STAKEHOLDERS (2–3 sentences, non-technical)
   What is the overall risk level, what is the estimated effort, and what is the
   single most important prerequisite before starting?
```
