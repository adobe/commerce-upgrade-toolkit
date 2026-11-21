# Guardrail: secure-code-generation

## Rule
AI-generated upgrade code must be secure by construction and must pass the mandatory
security gate (`security_gate.py`) before it is accepted. These rules supplement the gate;
they never replace it.

## Required practices
- Follow secure Adobe Commerce coding practices; prefer OOTB framework APIs.
- Use parameterized database operations (bound parameters, `Select::where('col = ?', $v)`,
  `quoteInto`); never build SQL by concatenation or interpolation.
- Escape output for its context (`escapeHtml`, `escapeHtmlAttr`, `escapeUrl`, `escapeJs`);
  render scripts through `$secureRenderer`.
- Do not use `unserialize()` on untrusted data; use the Json serializer.
- Use constructor injection and factories; no direct or dynamic `ObjectManager` use.
- Preserve authentication, authorization, ACL, encryption and payment security behavior.
  Every admin action and web API route keeps a specific ACL resource.
- Never expose secrets, tokens, encryption keys or payment credentials in code, logs,
  prompts, reports or test fixtures.

## Human approval required (stop and ask; never self-approve)
- Any change to encryption-key handling or rotation, payment or vault credentials,
  customer or admin authentication/authorization, admin ACL, REST/SOAP/GraphQL authorization
  declarations, or plugins/preferences/overrides on framework security classes.
- Requirements that are ambiguous, or a secure implementation that cannot be established.
- An agent's own statement is never approval. Approval is recorded only by a human through
  `security_gate.py approve` in an interactive terminal.

## Forbidden
- Disabling, skipping, weakening, or bypassing the security scanner, its rules, its
  severity threshold, or its scanner override option; suppressing findings globally.
- Writing `.ccua/review/security-approval-*.json` or `security-gate-*.json` files.
- Proceeding to the next chunk after a blocked or pending-approval gate result.

## Reporting
Report every security-sensitive change and its purpose to the orchestrator with the exact
file inventory so it can be presented for human review.
