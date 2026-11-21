# Copilot Settings Notes

## Automatic routine non-production profile

Read `.github/instructions/write-scope.instructions.md`. The current skill session is orchestrator;
the separate researcher is read-only. Approve the isolated instance/hop/routine scope once,
then automatically execute authorized routine commands and scoped metadata updates.
Application/config/test diffs, sensitive and outside-scope actions need separate approval.
Agent `execute` availability is broad, not a per-command permission grant. Repository
frontmatter and Markdown cannot enforce host isolation or intercept native execution.
Verify effective parent/subagent permissions in an isolated disposable non-production
host without production credentials/access; otherwise return human-run proposals.

For CLI use `copilot config defaultPermissionMode manual` and
`copilot config disableAllHooks true` (user-wide), then start a fresh project session.
Use `/reset-allowed-tools` before/after a run. Start `copilot` normally; no agent flag is required.
Grant only reviewed routine command/path permissions for the active session. No allow-all,
assisted auto-approval or broad shell grants. Path read/write denies do not constrain shell commands;
secret exclusion requires host filesystem isolation. Review execution-capable MCP servers.

No default CodeGraph registration or grants; activation is blocked pending review.
No automatic command hooks are shipped. Older installed hooks/settings and root
instructions are preserved: compare and merge the reviewed templates manually.
An asset update alone does not change host permissions. See `docs/security-migration.md`.
