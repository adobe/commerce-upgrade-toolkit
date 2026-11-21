# Linux publication boundary

The anchored Node publication helper requires Linux and working `/proc/self/fd`
directory references. macOS and Windows implementations are deferred. These hosts
must report an explicit unsupported-host error, not pretend the toolkit is absent
or fall back to pathname-based publication. This is not a claim of cross-platform
support. Update release/support documentation before distributing this change.

On an existing installation, marker reads/preflight and workspace-config reads
also use the Linux Node helper. They fail explicitly on unsupported hosts;
callers must not convert those errors into "not installed." Full macOS/Windows
support needs a separately reviewed implementation before release.

Python normalizer publication requires POSIX no-follow directory opens,
directory-relative open/stat/rename/unlink and directory fsync support.
Unsupported capabilities block before staging. Shared file reads open files
relative to held directories, reject symlinks/non-regular files/multiple links,
enforce a descriptor-based byte limit and reject observed identity/metadata drift.
Evidence, normalized findings, plans and policy are hashed and parsed from the
same captured buffer. These checks are not an authenticated snapshot against a
privileged actor or a replacement for human secret classification.

## What anchoring does and does not protect

The normalizer and Node publication helpers use held directory descriptors for
temporary creation, replacement, cleanup and fsync. Replacement symlinks cannot
redirect these operations into the symlink target.

Attachment checks diagnose directory drift; they are not atomic locks. Held
descriptors do not stop a same-UID actor from moving the originally held directory.
An operation already issued against a held directory can finish there before a
subsequent attachment check reports failure. These helpers are not a sandbox,
approval mechanism, authenticated audit or substitute for OS/framework least
privilege and exclusion of concurrent untrusted writers.

## Failure and recovery

A failure after publication is not evidence that nothing changed. Published-state
drift errors explicitly require human inspection before retry or recovery.
Normalizer failure output likewise warns that artifacts may be partially published.
No automatic rollback or completion update is authorized.

Inspect the reviewed workspace and any moved original directory. Do not consume
stale reports or silently recreate a lost marker. For legacy reconciliation,
preserve the hash-only journal, stop affected sessions and use the reviewed
roll-forward recovery procedure only after identifying the correct workspace.
Staging cleanup and descriptor closure are attempted even on failure; cleanup
failures retain the primary error and block completion. Node errors retain it
in AggregateError; Python retains it through explicit exception chaining.
CLI messages intentionally avoid emitting arbitrary exception/source text.

Configuration staging remains mode 0600 until immediately before replacement,
when the reviewed original mode is restored and fsynced. That short final interval
is not an access-control guarantee against other users. Inputs must already be
classified as non-secret; no credentials or raw configuration are placed in audits.

## Policy and audit binding

Fixed policy collection types and regex syntax are validated before use. A normalization
run captures one policy before processing records; policy-read/validation failures abort,
not quarantine individual findings. The persisted normalized schema is unchanged; it does
not include a policy digest or confer authority. Vendor read exemptions match the vendor
rule itself, never its array position. Scoped target reads reuse the reviewed target path.

Audit directory creation, append, fsync and descriptor cleanup use held directories.
Audit failure blocks completion; an append may already have occurred or left a partial
record. Inspect the hash-only log before retrying; there is no automatic rollback or
concurrent-writer/identity authentication guarantee. A non-regular file is rejected after
opening: nonblocking opens avoid FIFO hangs but cannot eliminate device-open side effects.
Only reviewed secret-free, ordinary filesystem inputs are supported; zero-size pseudo-files
that produce bytes or change metadata are deliberately rejected. Close errors fail closed.

## Validation

Human-operated, separately approved synthetic maintenance checks must cover both
toolkit flavors, normal installation/update, legacy recovery, injected directory
swaps, outside sentinel preservation, read-once hash/parse binding, stage permissions
and unsupported-host rejection. Generate Copilot assets from canonical sources and
run existing regressions as well as the new focused cases. Static proposal review
is not execution evidence; unrun or missing checks remain validation gaps.
