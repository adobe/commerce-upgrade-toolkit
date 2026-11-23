# Linux and macOS publication boundary

The anchored Node publication helper requires either Linux with working `/proc/self/fd`
directory references, or macOS with working volfs (`/.vol/<device>/<inode>`) references.
Windows is not supported natively (use WSL, which is Linux). Any other host, or a macOS
volume where the volfs reference does not resolve, must report an explicit error, not
pretend the toolkit is absent or fall back to pathname-based publication.

On Linux a held directory is addressed through its descriptor. On macOS it is addressed by
the inode of the directory the descriptor holds. Both keep reaching the original directory
after its path is replaced by a symlink or moved, which a plain pathname does not. Every
path component is still opened with no-follow, so a symbolic link anywhere in the project
path is rejected; this includes macOS system links such as `/var`, `/tmp` and `/etc`.

macOS-specific limits to review:

- volfs is a legacy Apple interface. It is present on current macOS releases but is not
  documented as stable, so unavailability must continue to fail closed. The helper confirms
  at each directory that the reference resolves to the same device and inode as the held
  descriptor before use and again at attachment checks.
- The reference is inode-based, not descriptor-based. The directory stays referenced while
  its descriptor is held open; an inode cannot be recycled for another directory during
  that time.
- `fsync` on macOS flushes to the drive's cache but is not a full-disk barrier. Durability
  on power loss is weaker than the Linux guarantee the documentation describes.
- The same-UID limits below apply unchanged on both platforms.
- This macOS support has been exercised by this repository's tests but has not had an
  independent security review. Obtain one before treating it as equivalent to the Linux
  guarantee.

Marker reads/preflight and workspace-config reads on an existing installation also use this
helper. They fail explicitly on unsupported hosts; callers must not convert those errors
into "not installed."

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
