#!/usr/bin/env python3
# Copyright 2026 Adobe. All rights reserved.
# Licensed under the Apache License, Version 2.0.
# https://www.apache.org/licenses/LICENSE-2.0
# SPDX-License-Identifier: Apache-2.0
"""Fail-closed adapter for the UCT schema documented in upgrade-uca-scan.md."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import sys

IDENT = r"[A-Za-z_][A-Za-z0-9_]*"
CLASS = rf"{IDENT}(?:\\{IDENT})+"
PATTERNS = (
    ("MC-43", "PLUGIN_INTERSECTION",
     rf"Method ({CLASS}::{IDENT})\(\) was removed"),
    ("W-083", "DEPRECATED_CLASS",
     rf"Class ({CLASS}) is deprecated"),
)
PATH = re.compile(r"(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+")
VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+(?:-p[0-9]+)?")


def escaped(value):
    return (json.dumps(value, ensure_ascii=True, indent=2)
            .replace("<", "\\u003c").replace(">", "\\u003e")
            .replace("&", "\\u0026"))


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError("non-JSON numeric constant")


def contained(root, name, must_exist=True):
    if not isinstance(name, str) or not PATH.fullmatch(name):
        raise ValueError("invalid project-relative path")
    if any(part in (".", "..") for part in name.split("/")):
        raise ValueError("path traversal")
    path = root / name
    # Reject even in-project symlinks to avoid ambiguous source identities.
    if any(part.is_symlink() for part in (path, *path.parents)):
        raise ValueError("symlink path")
    resolved = path.resolve(strict=must_exist)
    if not resolved.is_relative_to(root):
        raise ValueError("path outside project")
    if must_exist and not resolved.is_file():
        raise ValueError("not a file")
    return resolved


def validate_policy(policy):
    if (type(policy) is not dict or type(policy.get("schemaVersion")) is not int or
            policy["schemaVersion"] != 1 or type(policy.get("roles")) is not dict or
            not all(isinstance(role, str) and role for role in policy["roles"])):
        raise ValueError("invalid fixed policy")
    groups = list(policy["roles"].values()) + [
        policy.get(name) for name in ("denied", "restricted", "commandEffects")]
    for patterns in groups:
        if type(patterns) is not list or not all(
                isinstance(pattern, str) and pattern for pattern in patterns):
            raise ValueError("invalid fixed policy")
        for pattern in patterns:
            try:
                re.compile(pattern, flags=re.ASCII | re.IGNORECASE)
            except re.error:
                raise ValueError("invalid fixed policy pattern") from None
    return policy


def load_source_policy():
    return validate_policy(json.loads(
        read_file_bytes(Path(__file__).absolute().parent / "write-policy.json", 2_000_000),
        object_pairs_hook=unique_object, parse_constant=reject_constant))


def source_file(root, name):
    return _source_file(root, name)


def _source_file(root, name, policy=None):
    if not isinstance(name, str) or not PATH.fullmatch(name):
        raise ValueError("invalid source path")
    policy = load_source_policy() if policy is None else policy
    patterns = policy["denied"]
    # Vendor is write-denied, not read-denied; its credential subpaths remain denied.
    if any(re.fullmatch(pattern, name, flags=re.ASCII | re.IGNORECASE)
           for pattern in patterns if pattern != r"vendor(?:/.*)?"):
        raise ValueError("denied-secret-source-path")
    path = contained(root, name)
    if path.stat().st_nlink != 1:
        raise ValueError("multiply linked source")
    return path


def output_artifact(root, name, kind):
    allowed = {f"{prefix}/upgrade-findings.{kind}.json" for prefix in
               (".claude/context", ".github/context", ".ccua/review")}
    if name not in allowed:
        raise ValueError("output outside designated normalizer artifacts")
    path = contained(root, name, must_exist=False)
    if path.exists():
        metadata = path.stat()
        if not path.is_file() or metadata.st_nlink != 1 or metadata.st_size > 20_000_000:
            raise ValueError("unsafe existing output")
        value = json.loads(read_file_bytes(path, 20_000_000), object_pairs_hook=unique_object,
                           parse_constant=reject_constant)
        if kind == "normalized":
            owned = (type(value) is dict and set(value) == {
                "normalizerVersion", "targetVersion", "accepted", "quarantine",
                "counts", "blocked", "rawSha256"} and
                type(value["normalizerVersion"]) is int and value["normalizerVersion"] == 1 and
                type(value["accepted"]) is list and type(value["quarantine"]) is list and
                type(value["counts"]) is dict and type(value["blocked"]) is bool and
                isinstance(value["rawSha256"], str) and
                re.fullmatch(r"[0-9a-f]{64}", value["rawSha256"]) is not None)
        else:
            owned = (type(value) is list and all(type(row) is dict and set(row) == {
                "id", "reason", "severity", "status", "untrusted_evidence"} and
                row["status"] == "human-review-blocker" for row in value))
        if not owned:
            raise ValueError("existing output is not a normalizer artifact")
    return path


def open_directory_chain(directory):
    chain = []
    if (os.name != "posix" or not all(hasattr(os, flag) for flag in ("O_DIRECTORY", "O_NOFOLLOW"))
            or not all(operation in os.supports_dir_fd for operation in (os.open, os.stat))):
        raise ValueError("POSIX directory-relative read support required")
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    try:
        if not directory.is_absolute() or directory.parts[0] != "/":
            raise ValueError("absolute POSIX artifact directory required")
        parent = os.open("/", flags)
        chain.append((None, None, parent))
        for name in directory.parts[1:]:
            if name in ("", ".", ".."):
                raise ValueError("invalid artifact directory")
            descriptor = os.open(name, flags, dir_fd=parent)
            chain.append((parent, name, descriptor))
            parent = descriptor
        verify_directory_chain(chain)
        return chain
    except (OSError, ValueError):
        for _, _, descriptor in reversed(chain):
            os.close(descriptor)
        raise


def verify_directory_chain(chain):
    for parent, name, descriptor in chain:
        opened = os.fstat(descriptor)
        if not stat.S_ISDIR(opened.st_mode):
            raise ValueError("unsafe artifact directory")
        if parent is not None:
            current = os.stat(name, dir_fd=parent, follow_symlinks=False)
            if not stat.S_ISDIR(current.st_mode) or (current.st_dev, current.st_ino) != (
                    opened.st_dev, opened.st_ino):
                raise ValueError("artifact directory changed")


def read_file_bytes(path, max_bytes):
    if type(max_bytes) is not int or not 0 < max_bytes <= 20_000_000:
        raise ValueError("invalid bounded read limit")
    if not hasattr(os, "O_NONBLOCK"):
        raise ValueError("POSIX nonblocking reads required")
    path = Path(path)
    chain = open_directory_chain(path.parent)
    descriptor = None
    failure = None
    try:
        descriptor = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                             dir_fd=chain[-1][2])
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > max_bytes:
            raise ValueError("unsafe or oversized bounded read")
        raw = bytearray()
        capacity = before.st_size + 1
        while len(raw) < capacity:
            chunk = os.read(descriptor, min(65536, capacity - len(raw)))
            if not chunk:
                break
            raw.extend(chunk)
        after = os.fstat(descriptor)
        current = os.stat(path.name, dir_fd=chain[-1][2], follow_symlinks=False)
        if (len(raw) != before.st_size or after.st_size != before.st_size or
                after.st_nlink != 1 or after.st_mtime_ns != before.st_mtime_ns or
                after.st_ctime_ns != before.st_ctime_ns or not stat.S_ISREG(current.st_mode) or
                (current.st_dev, current.st_ino) != (before.st_dev, before.st_ino)):
            raise ValueError("file changed during bounded read")
        verify_directory_chain(chain)
        return bytes(raw)
    except (ValueError, OSError) as error:
        failure = error
        raise
    finally:
        cleanup_errors = []
        descriptors = ([descriptor] if descriptor is not None else []) + [
            item[2] for item in reversed(chain)]
        for opened in descriptors:
            try:
                os.close(opened)
            except OSError as error:
                cleanup_errors.append(error)
        if cleanup_errors:
            raise OSError(f"Bounded read cleanup failed ({len(cleanup_errors)} errors).") from (
                failure if failure is not None else cleanup_errors[0])


def write_artifacts(items):
    staged = []
    directories = {}
    failure = None
    try:
        if (os.name != "posix" or not all(hasattr(os, flag) for flag in ("O_DIRECTORY", "O_NOFOLLOW"))
                or not all(operation in os.supports_dir_fd for operation in
                           (os.open, os.stat, os.rename, os.unlink))):
            raise ValueError("POSIX directory-relative publication support required")
        for target, _ in items:
            if not target.is_absolute():
                raise ValueError("absolute artifact path required")
            if target.parent not in directories:
                directories[target.parent] = open_directory_chain(target.parent)
        for target, content in items:
            chain = directories[target.parent]
            verify_directory_chain(chain)
            temporary = f".{target.name}.{secrets.token_hex(16)}"
            descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                 0o600, dir_fd=chain[-1][2])
            staged.append((temporary, target))
            stage_failure = None
            try:
                with os.fdopen(descriptor, "w", encoding="utf-8", closefd=False) as stream:
                    stream.write(content)
                    stream.flush()
                    os.fsync(stream.fileno())
            except (ValueError, OSError) as error:
                stage_failure = error
                raise
            finally:
                try:
                    os.close(descriptor)
                except OSError as error:
                    raise OSError("Artifact stage descriptor cleanup failed.") from (
                        stage_failure if stage_failure is not None else error)
        for temporary, target in staged:
            chain = directories[target.parent]
            verify_directory_chain(chain)
            os.rename(temporary, target.name, src_dir_fd=chain[-1][2], dst_dir_fd=chain[-1][2])
            os.fsync(chain[-1][2])
            try:
                verify_directory_chain(chain)
            except (ValueError, OSError) as error:
                raise ValueError("Artifact published to held directory; attachment changed; verify state.") from error
    except (ValueError, OSError) as error:
        failure = error
        raise
    finally:
        cleanup_errors = []
        for temporary, target in staged:
            try:
                os.unlink(temporary, dir_fd=directories[target.parent][-1][2])
            except FileNotFoundError:
                pass
            except OSError as error:
                cleanup_errors.append(error)
        for chain in directories.values():
            for _, _, descriptor in reversed(chain):
                try:
                    os.close(descriptor)
                except OSError as error:
                    cleanup_errors.append(error)
        if cleanup_errors:
            raise OSError(f"Artifact cleanup failed ({len(cleanup_errors)} errors); verify publication state.") from (
                failure if failure is not None else cleanup_errors[0])


def normalize(report, root, target_version=None):
    accepted, quarantine, evidence = [], [], []

    def reject(record, reason, severity):
        item = {"id": len(accepted) + len(quarantine) + 1,
                "reason": reason, "severity": severity, "status": "human-review-blocker"}
        quarantine.append(item)
        evidence.append({**item, "untrusted_evidence": record})

    if not isinstance(report, dict):
        reject(report, "unsupported-report-schema", "unknown")
        return {
            "normalizerVersion": 1, "targetVersion": None, "accepted": [],
            "quarantine": quarantine,
            "counts": {"accepted": 0, "quarantined": 1, "total": 1}, "blocked": True,
        }, evidence
    unknown = set(report) - {"summary", "errors", "warnings", "targetVersion"}
    if unknown or not any(key in report for key in ("errors", "warnings")):
        reject(report, "unsupported-report-schema", "unknown")
    policy = load_source_policy()
    for collection, severity in (("errors", "error"), ("warnings", "warning")):
        rows = report.get(collection, [])
        if not isinstance(rows, list):
            reject(rows, "invalid-issue-collection", severity)
            continue
        for row in rows:
            if not isinstance(row, dict) or set(row) != {"code", "type", "file", "line", "message"}:
                reject(row, "unsupported-issue-schema", severity)
                continue
            try:
                _source_file(root, row["file"], policy)
                if type(row["line"]) is not int or row["line"] <= 0:
                    raise ValueError("invalid positive line number")
                if not isinstance(row["message"], str):
                    raise ValueError("invalid diagnostic")
                match = None
                for code, kind, pattern in PATTERNS:
                    if row["code"] == code and row["type"] == kind:
                        match = re.fullmatch(pattern, row["message"], flags=re.ASCII)
                        break
                if match is None:
                    raise ValueError("unrecognized code/type/diagnostic")
                accepted.append({
                    "id": len(accepted) + len(quarantine) + 1,
                    "file": row["file"], "line": row["line"],
                    "code": row["code"], "type": row["type"],
                    "symbol": match[1], "severity": severity,
                })
            except (ValueError, OSError, RecursionError):
                reject(row, "invalid-path-line-or-diagnostic", severity)
    target = target_version if target_version is not None else report.get("targetVersion")
    if target_version is not None and "targetVersion" in report and report["targetVersion"] != target_version:
        reject(report["targetVersion"], "conflicting-target-version", "unknown")
    if not isinstance(target, str) or not VERSION.fullmatch(target):
        reject(target, "invalid-target-version", "unknown")
        target = None
    return {
        "normalizerVersion": 1, "targetVersion": target,
        "accepted": accepted, "quarantine": quarantine,
        "counts": {"accepted": len(accepted), "quarantined": len(quarantine),
                   "total": len(accepted) + len(quarantine)},
        "blocked": bool(quarantine),
    }, evidence


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report")
    parser.add_argument("normalized")
    parser.add_argument("evidence")
    parser.add_argument("--project-root", default=".")
    parser.add_argument("--target-version")
    args = parser.parse_args()
    try:
        root = Path(args.project_root).resolve(strict=True)
        source = source_file(root, args.report)
        output = output_artifact(root, args.normalized, "normalized")
        audit = output_artifact(root, args.evidence, "quarantine")
        if len({source, output, audit}) != 3:
            raise ValueError("input and outputs must be distinct")
        if source.stat().st_size > 20_000_000:
            raise ValueError("report size limit")
        raw = read_file_bytes(source, 20_000_000)
        report = json.loads(raw, object_pairs_hook=unique_object, parse_constant=reject_constant)
        result, evidence = normalize(report, root, args.target_version)
        result["rawSha256"] = hashlib.sha256(raw).hexdigest()
        write_artifacts(((output, escaped(result) + "\n"),
                         (audit, escaped(evidence) + "\n")))
        raw_counts = {name: len(report.get(collection))
                      if isinstance(report, dict) and isinstance(report.get(collection), list)
                      else None for name, collection in
                      (("rawErrorCount", "errors"), ("rawWarningCount", "warnings"))}
        print(escaped({**result["counts"], **raw_counts}))
        return 2 if result["blocked"] else 0
    except (ValueError, OSError):
        print("Normalization failed; artifacts may be partially published. Raw report remains untrusted; request human review.",
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
