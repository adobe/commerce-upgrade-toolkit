# Guardrail: encryption-safety

## Scope
Applies to any change touching cryptography, password hashing, or the Commerce
crypt key — PHP/PHTML implementing or calling encryption primitives, `di.xml`
preferences/plugins on `EncryptorInterface` (or any class implementing it),
`app/etc/env.php`, and this toolkit's own encryption-related skills/commands/
agents Markdown. This is remediation guidance for an **upgrade toolkit** — it
does not perform rotation itself. Rotation is always a human-run, version-confirmed native
operation reviewed by `commerce-security-reviewer`.

## Absolute rules (never violate)

Never write custom cryptography and never rotate or delete encryption keys without a
human-approved, version-referenced runbook — only native Commerce commands and the native
`EncryptorInterface` are allowed extension points for key/password handling.

1. **Never write custom cipher, KDF, hashing, or key-generation code.** No
   AI-authored `openssl_encrypt`/`openssl_decrypt`, `mcrypt_*`, hand-rolled
   key derivation, custom `password_hash`/`password_verify`/`crypt` wrappers,
   or any replacement for Commerce's version-specific native encryption and password
   hashing implementations. Use `\Magento\Framework\Encryption\EncryptorInterface`
   (constructor-injected) for any encrypt/decrypt/hash call site — this is the
   one correct, already-native extension point and remains fully allowed.
2. **Never write a literal key, password, or secret into any file** —
   `env.php`, PHP, XML, Markdown, logs, or test fixtures. This includes
   example/placeholder values that look like real key material (use `***`
   or `<redacted>` instead).
3. **Never implement, extend, or `preference`/`plugin` the Encryptor, including via aliases.**
   No class implementing `EncryptorInterface`, no `di.xml` preference pointing
   at a custom encryptor, no plugin wrapping `encrypt()`/`decrypt()`/`hash()`
   with custom logic, and no DI virtual-type alias that routes around it.
   Ordinary constructor injection of `EncryptorInterface` to call its public
   methods is the normal, allowed usage pattern and is not affected by this
   rule.
4. **Never edit `vendor/` crypto internals** — see the `no-core-overrides`
   guardrail; it applies in full here with no crypto-specific exception.
5. **Never log, dump, or grep the crypt key or decrypted secrets.** This
   includes unscoped `bin/magento config:show` output, raw decryption
   exception/stack-trace logging, `grep`-ing `env.php` for `crypt` and
   printing the match, or writing key material to `var/log/*`. See also the
   `pii-protection` guardrail — crypt-key material is sensitive in the same
   way PII is and must never appear in log aggregation output.
6. **Never delete an old encryption key** until all encrypted data (every
   table/column found by inventory, not just the native tables) *and* all
   backups subject to retention requirements have been verified re-encrypted
   or restorable by a human security expert. This is a human sign-off, not an
   automated check.
7. **Never trigger or schedule automatic key rotation.** Rotation is a
   human-initiated, human-supervised operation every time — there is no
   "rotate automatically on hop N" behaviour anywhere in this toolkit.
8. **Every rotation or re-encryption recommendation must cite a named,
   version-specific official reference** (an Adobe Experience League /
   `developer.adobe.com/commerce` URL, found via the `websearch-scope`
   guardrail) **and** have a documented backup/restore plan and explicit
   human approval before any native command is suggested. Generic claims like
   "rotate before every hop" or "UI removal means rotation is required" are
   not sufficient justification — see the `encryption-and-passwords` skill
   for how rotation need is actually determined.
9. **Secret backups never live in the repository or docroot.** `env.php`
   backups, DB dumps, and any exported key material must go to storage
   outside the project directory and outside anything served by the web
   root, with access restricted to approved operators.
10. **Stop and drain all writers before the coordinated key/database recovery snapshot.**
    Keep them stopped through rotation, verification, and recovery. Resume services only
    after a verified successful outcome or verified recovery and explicit human sign-off.

## What stays allowed (do not over-block)

- Regular `EncryptorInterface` consumers: constructor-injecting it and calling
  `encrypt()`/`decrypt()`/`hash()`/`isValidHash()` is normal Commerce code and
  is unaffected by this guardrail.
- Non-cryptographic hashing used for cache keys, checksums, ETags, or dedup
  (e.g. `hash('crc32b', ...)`, `md5($cacheKey)`) — these are not password or
  key material and are out of scope here.
- Reading (not rotating) config via scoped, specific `bin/magento config:show
  <path>` calls that do not dump the entire encrypted config tree.

## Heuristic checker — what it is and is not

`node .claude/scripts/check-encryption-changes.mjs` gives a deterministic,
git-diff-based pass/fail against the rules above for PHP/PHTML/`di.xml`/
`env.php` changes. It is a **heuristic static guard**, not a proof of
cryptographic correctness or complete re-encryption coverage:
- It cannot verify that a rotation was actually run correctly, that all
  custom-encrypted fields were inventoried, or that backups are valid.
- It only inspects changed lines in the current diff — it will not flag
  pre-existing unsafe code that nobody touched. Exception: every enumerated tracked
  `env.php` touch (including deletions, non-key edits and renames away from that path)
  is blocked path-only as `ENC_ENV_CRYPT_KEY_CHANGE`. New nonignored `env.php` files
  are also blocked without reading their contents. This diagnostic reports a protected
  configuration change, not proof that a key was rotated or exposed.
- Only tracked and nonignored new files are inspected. Gitignored runtime
  `app/etc/env.php` is intentionally out of scope: the checker cannot detect
  its local changes. Do not stage it; enforce the native human-approved runbook
  and security review instead. A normal existing ignored configuration is not
  a reason to block an upgrade.
- An unavailable CI base (for example, after a force-push) stops the check;
  restore or fetch the intended base before retrying rather than bypassing it.
- Unmerged source files fail closed. Resolve Git conflicts before rerunning the check;
  an unreadable source is never treated as a clean scan.
- Source symlinks are rejected in Git blobs and working files. Disk reads also reject
  symlinked ancestors, hardlinks, nonregular files, oversized sources and observed drift.
  Working-file reads require the bundled Linux procfs or macOS volfs descriptor helper;
  unsupported hosts fail explicitly rather than falling back to insecure pathname reads.
  Held descriptors and attachment checks are not a sandbox against a same-UID or
  privileged actor moving directories; use the reviewed secret-free environment.
- DI checks target the exact native Magento Framework Encryptor types, not unrelated
  module-local names. Indirect custom contract inheritance or encoded/obfuscated XML
  may evade this heuristic and still requires independent security review.
- A clean run is a necessary gate, not sufficient sign-off. PCI/auth-flagged
  findings still require `commerce-security-reviewer` before marking done,
  per `CLAUDE.md`.

## Where this applies

Referenced by the `encryption-and-passwords` skill, and applied by
`commerce-developer`, `commerce-devops-engineer`, `commerce-security-reviewer`,
and `commerce-upgrade-analyst` wherever their work touches crypto-adjacent
code, `env.php`, or encryption/rotation planning. Also applied during
`/upgrade-hop` (planning) and `/upgrade-hop-execute` (Gate 4 and any chunk
that edits a file this guardrail scopes) — see the `applyTo` scoping in the
generated `.github/instructions/encryption-safety.instructions.md` for the
Copilot-flavour equivalent.

Native contract reference:
https://developer.adobe.com/commerce/php/development/security/data-encryption
