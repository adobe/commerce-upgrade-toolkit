#!/usr/bin/env python3
# Copyright 2026 Adobe. All rights reserved.
# Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0
"""Produce deterministic review evidence, never consent or patches. See write-scope.md."""
import argparse
import difflib
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone

from normalize_uct import (contained, escaped, unique_object, reject_constant, VERSION, PATTERNS,
                           read_file_bytes, validate_policy, open_directory_chain,
                           verify_directory_chain)
from research_url import validate as validate_url

HERE = Path(__file__).absolute().parent
HASH = re.compile(r"[0-9a-f]{64}")
IDENT = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,79}")
MAX_BYTES = 2_000_000


def require(condition):
    if not condition:
        raise ValueError("invalid-review-input")


def keys(value, expected):
    require(type(value) is dict and set(value) == set(expected.split()))


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def read_bytes(path):
    return read_file_bytes(path, MAX_BYTES)


def parse_json(raw):
    return json.loads(raw, object_pairs_hook=unique_object,
                      parse_constant=reject_constant)


def load(path):
    return parse_json(read_bytes(path))


def artifact(root, name, policy, exists=True):
    require(isinstance(name, str) and
            re.fullmatch(r"\.ccua/review/[A-Za-z0-9_.-]+\.(json|before|after|txt|diff)", name))
    require(not matches(policy["denied"], name))
    return contained(root, name, must_exist=exists)


def matches(patterns, name):
    return any(re.fullmatch(pattern, name, flags=re.ASCII | re.IGNORECASE)
               for pattern in patterns)


def scope(root, policy, agent, kind, name):
    # Deny before even stat/read of a requested target, including fixture aliases.
    require(isinstance(name, str))
    if matches(policy["denied"], name):
        raise ValueError("never-write-path")
    if agent not in policy["roles"]:
        raise ValueError("unknown-agent")
    allowed = policy["roles"][agent]
    if kind == "command-effects":
        require(agent == "orchestrator")
        allowed = policy["commandEffects"]
    if not matches(allowed, name):
        raise ValueError("outside-role-scope")
    return contained(root, name, must_exist=False)


def php_risks(before, after):
    helper = HERE / "inspect_changed_php.php"
    require(not helper.is_symlink())
    try:
        result = subprocess.run(
            ["php", "-n", "-d", "extension=tokenizer", str(helper)],
            input=json.dumps({"before": before, "after": after}), text=True,
            capture_output=True, timeout=15, check=False)
        require(result.returncode == 0)
        return json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, ValueError):
        raise ValueError("php-tokenizer-unavailable") from None


def evidence(root, plan, policy):
    path = artifact(root, plan["evidence"], policy)
    raw = read_bytes(path)
    require(digest(raw) == plan["evidenceSha256"])
    ledger = parse_json(raw)
    keys(ledger, "schemaVersion fromVersion toVersion normalized normalizedSha256 sources")
    require(type(ledger["schemaVersion"]) is int and ledger["schemaVersion"] == 1)
    require((ledger["fromVersion"], ledger["toVersion"]) ==
            (plan["fromVersion"], plan["toVersion"]))
    uct_ids = set()
    if ledger["normalized"] is not None:
        report = artifact(root, ledger["normalized"], policy)
        require(HASH.fullmatch(ledger["normalizedSha256"] or "") is not None)
        normalized_raw = read_bytes(report)
        require(digest(normalized_raw) == ledger["normalizedSha256"])
        normalized = parse_json(normalized_raw)
        keys(normalized, "normalizerVersion targetVersion accepted quarantine counts blocked rawSha256")
        require(type(normalized["normalizerVersion"]) is int and
                normalized["normalizerVersion"] == 1 and
                normalized.get("blocked") is False and normalized.get("quarantine") == [] and
                normalized.get("targetVersion") == plan["toVersion"])
        require(isinstance(normalized["rawSha256"], str) and HASH.fullmatch(normalized["rawSha256"]))
        require(type(normalized.get("accepted")) is list)
        keys(normalized["counts"], "accepted quarantined total")
        require(all(type(n) is int and n >= 0 for n in normalized["counts"].values()))
        for row in normalized["accepted"]:
            keys(row, "id file line code type symbol severity")
            require(type(row["id"]) is int and row["id"] > 0 and row["id"] not in uct_ids)
            require(type(row["line"]) is int and row["line"] > 0)
            require(row["severity"] in ("error", "warning"))
            require(not matches([pattern for pattern in policy["denied"]
                                 if pattern != r"vendor(?:/.*)?"], row["file"]))
            contained(root, row["file"], must_exist=False)
            require(any(row["code"] == code and row["type"] == kind and
                        re.fullmatch(pattern.replace(" was removed", "").replace(" is deprecated", ""),
                                     ("Method " + row["symbol"] + "()") if code == "MC-43"
                                     else "Class " + row["symbol"], flags=re.ASCII)
                        for code, kind, pattern in PATTERNS))
            uct_ids.add(row["id"])
        require(normalized.get("counts") ==
                {"accepted": len(uct_ids), "quarantined": 0, "total": len(uct_ids)})
    else:
        require(ledger["normalizedSha256"] is None)
    require(type(ledger["sources"]) is list)
    sources = set()
    for source in ledger["sources"]:
        keys(source, "id reference sha256")
        require(isinstance(source["id"], str) and
                re.fullmatch(r"BC-[A-Za-z0-9_.-]+", source["id"]) and source["id"] not in sources)
        require(isinstance(source["sha256"], str) and HASH.fullmatch(source["sha256"]))
        reference = source["reference"]
        require(isinstance(reference, str))
        if reference.startswith("https://"):
            validate_url(reference)
        else:
            require(reference.startswith("vendor/magento/"))
            require(not matches([pattern for pattern in policy["denied"]
                                 if pattern != r"vendor(?:/.*)?"], reference))
            require(digest(read_bytes(contained(root, reference))) == source["sha256"])
        sources.add(source["id"])
    return uct_ids, sources


def check(root, policy, plan, action, changed, sniffs):
    keys(plan, "schemaVersion agent kind environment fromVersion toVersion hop chunk "
         "evidence evidenceSha256 changes")
    require(type(plan["schemaVersion"]) is int and plan["schemaVersion"] == 1)
    require(plan["kind"] in ("patch", "command-effects"))
    require(isinstance(plan["environment"], str) and IDENT.fullmatch(plan["environment"]))
    for version in ("fromVersion", "toVersion"):
        require(isinstance(plan[version], str) and plan[version].isascii() and
                VERSION.fullmatch(plan[version]))
    require(type(plan["hop"]) is int and plan["hop"] > 0)
    require(type(plan["chunk"]) is int and 0 <= plan["chunk"] <= 6)
    require(isinstance(plan["evidenceSha256"], str) and HASH.fullmatch(plan["evidenceSha256"]))
    require(type(plan["changes"]) is list and 0 < len(plan["changes"]) <= 200)
    # Preflight ALL scopes before reading ANY target or source fixtures.
    paths = []
    for change in plan["changes"]:
        keys(change, "path issue before after beforeSha256 afterSha256 diffSha256 sensitive")
        require(type(change["sensitive"]) is bool)
        scope(root, policy, plan["agent"], plan["kind"], change["path"])
        require(change["path"] not in paths)
        paths.append(change["path"])
        for stage in ("before", "after"):
            require((change[stage] is None) == (change[stage + "Sha256"] is None))
            if change[stage] is not None:
                artifact(root, change[stage], policy)
                require(isinstance(change[stage + "Sha256"], str) and
                        HASH.fullmatch(change[stage + "Sha256"]))
        require(change["before"] is not None or change["after"] is not None)
        require(isinstance(change["diffSha256"], str) and HASH.fullmatch(change["diffSha256"]))
    if action in ("verify", "audit"):
        require(changed is not None)
        actual = load(artifact(root, changed, policy))
        require(type(actual) is list and all(isinstance(p, str) for p in actual))
        # Review every reported extra path too; no content reads on denial.
        for name in actual:
            scope(root, policy, plan["agent"], plan["kind"], name)
        require(Counter(actual) == Counter(paths))
    accepted, sources = evidence(root, plan, policy)
    require(all(change["issue"] == plan["changes"][0]["issue"] for change in plan["changes"]))
    reviews, metadata, blockers = [], [], []
    needs_sniffs = False
    for change in plan["changes"]:
        issue = change["issue"]
        keys(issue, "kind id")
        require((issue["kind"] == "uct" and type(issue["id"]) is int and issue["id"] in accepted)
                or (issue["kind"] == "source" and isinstance(issue["id"], str)
                    and issue["id"] in sources))
        raw = {}
        for stage in ("before", "after"):
            raw[stage] = (read_bytes(artifact(root, change[stage], policy))
                          if change[stage] is not None else b"")
            require(change[stage] is None or digest(raw[stage]) == change[stage + "Sha256"])
        require(change["beforeSha256"] != change["afterSha256"])
        target = scope(root, policy, plan["agent"], plan["kind"], change["path"])
        stage = "before" if action == "review" else "after"
        if change[stage] is None:
            require(not target.exists())
        else:
            require(digest(read_bytes(target)) == change[stage + "Sha256"])
        before, after = raw["before"].decode("utf-8"), raw["after"].decode("utf-8")
        diff = "".join(difflib.unified_diff(
            before.splitlines(keepends=True), after.splitlines(keepends=True),
            fromfile="a/" + change["path"], tofile="b/" + change["path"]))
        require(digest(diff.encode()) == change["diffSha256"])
        restricted = change["sensitive"] or matches(policy["restricted"], change["path"])
        risks = None
        if change["path"].lower().endswith((".php", ".phtml")):
            needs_sniffs = True
            risks = php_risks(before, after)
            if risks["introduced"]:
                blockers.append("introduced-php-risk")
        item = {"path": change["path"], "issue": issue, "beforeSha256": change["beforeSha256"],
                "afterSha256": change["afterSha256"], "diffSha256": change["diffSha256"],
                "restricted": restricted}
        metadata.append(item)
        reviews.append({**item, "exactDiff": diff, "phpInspection": risks,
                        "requiredLiveReview": "developer-and-security-before-write"
                        if restricted or (risks and risks["introduced"])
                        else "exact-diff-files-environment-before-write"})
    security_listing = None
    if needs_sniffs and action != "review":
        if sniffs is None:
            blockers.append("magento2-security-sniffs-unverified")
        else:
            listing_bytes = read_bytes(artifact(root, sniffs, policy))
            listing = listing_bytes.decode("utf-8")
            found = re.findall(r"^\s*(Magento2\.Security\.[A-Za-z0-9_.]+)\s*$",
                               listing, flags=re.MULTILINE)
            if not found:
                blockers.append("magento2-security-sniffs-unverified")
            security_listing = {"sha256": digest(listing_bytes), "familyCount": len(set(found))}
    return reviews, metadata, sorted(set(blockers)), security_listing


def audit(root, entry):
    entry = {**entry, "recordedAt": datetime.now(timezone.utc).isoformat()}
    raw = (json.dumps(entry, ensure_ascii=True, separators=(",", ":"))
           .replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026") + "\n").encode("utf-8")
    if os.mkdir not in os.supports_dir_fd or not hasattr(os, "O_NONBLOCK"):
        raise ValueError("POSIX directory-relative audit support required")
    chain = open_directory_chain(root)
    descriptor = None
    failure = None
    try:
        verify_directory_chain(chain)
        parent = chain[-1][2]
        try:
            os.mkdir(".ccua", 0o700, dir_fd=parent)
        except FileExistsError:
            pass
        child = os.open(".ccua", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        chain.append((parent, ".ccua", child))
        verify_directory_chain(chain)
        descriptor = os.open("audit-log.jsonl", os.O_WRONLY | os.O_CREAT | os.O_APPEND |
                             os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=child)
        metadata = os.fstat(descriptor)
        require(stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1)
        verify_directory_chain(chain)
        offset = 0
        while offset < len(raw):
            written = os.write(descriptor, raw[offset:])
            if written <= 0:
                raise OSError("Audit append made no progress")
            offset += written
        os.fsync(descriptor)
        try:
            current = os.stat("audit-log.jsonl", dir_fd=child, follow_symlinks=False)
            require(stat.S_ISREG(current.st_mode) and current.st_nlink == 1 and
                    (current.st_dev, current.st_ino) == (metadata.st_dev, metadata.st_ino))
            os.fsync(child)
            verify_directory_chain(chain)
        except (ValueError, OSError) as error:
            raise ValueError("Audit appended to held directory; identity or attachment changed; verify state.") from error
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
            raise OSError("Audit descriptor cleanup failed; completion blocked.") from (
                failure if failure is not None else cleanup_errors[0])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("review", "verify", "audit"))
    parser.add_argument("plan")
    parser.add_argument("--project-root", default=".")
    parser.add_argument("--changed")
    parser.add_argument("--sniffs")
    parser.add_argument("--expected-plan-sha256")
    args = parser.parse_args()
    plan_hash = None
    root = None
    try:
        root = Path(args.project_root).absolute()
        require(root.is_dir() and not any(p.is_symlink() for p in (root, *root.parents)))
        # Fixed sibling policy; a plan cannot supply another policy path.
        policy_path = HERE / "write-policy.json"
        require(not any(p.is_symlink() for p in (policy_path, *policy_path.parents)))
        policy_raw = read_bytes(policy_path)
        policy_hash = digest(policy_raw)
        policy = validate_policy(parse_json(policy_raw))
        plan_path = artifact(root, args.plan, policy)
        plan_raw = read_bytes(plan_path)
        plan_hash = digest(plan_raw)
        if args.action != "review" or args.expected_plan_sha256 is not None:
            require(isinstance(args.expected_plan_sha256, str) and
                    HASH.fullmatch(args.expected_plan_sha256) and
                    plan_hash == args.expected_plan_sha256)
        plan = parse_json(plan_raw)
        reviews, files, blockers, security_listing = check(
            root, policy, plan, args.action, args.changed, args.sniffs)
        if args.action == "audit":
            audit(root, {"schemaVersion": 1, "event": "verified" if not blockers else "blocked",
                         "planSha256": plan_hash, "policySha256": policy_hash,
                         "claimedAgent": plan["agent"], "environment": plan["environment"],
                         "fromVersion": plan["fromVersion"], "toVersion": plan["toVersion"],
                         "hop": plan["hop"], "chunk": plan["chunk"], "kind": plan["kind"],
                         "files": files, "blockers": blockers, "securityListing": security_listing})
        print(escaped({"action": args.action, "planSha256": plan_hash,
                       "policySha256": policy_hash, "consent": "not-recorded",
                       "group": {key: plan[key] for key in
                                 ("agent", "kind", "environment", "fromVersion", "toVersion", "hop", "chunk")},
                       "securityListing": security_listing,
                       "blockers": blockers, "changes": files if args.action == "audit" else reviews}))
        return 2 if blockers else 0
    except (ValueError, OSError, KeyError, TypeError, RecursionError):
        if root is not None:
            try:
                audit(root, {"schemaVersion": 1, "event": "rejected",
                             "action": args.action, "planSha256": plan_hash})
            except (ValueError, OSError):
                print("Audit failure; completion blocked.", file=sys.stderr)
        print("Change review rejected; no authorization or patch applied.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
