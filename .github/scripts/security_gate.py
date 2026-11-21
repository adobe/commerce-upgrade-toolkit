#!/usr/bin/env python3
# Copyright 2026 Adobe. All rights reserved.
# Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0
"""Mandatory security gate for AI-generated upgrade changes. See docs/security-gate.md.

gate    scan a reviewed plan's proposed files in an isolated copy, classify sensitive changes,
        write .ccua/review/security-gate-*.json (never touches the Commerce project tree)
approve human-only (TTY) approval of sensitive changes after a passing scan
verify  re-check an accepted gate record (and optionally that the tree matches it)
final   independent post-upgrade scan of the current tree for every file changed by all hops
changed-scan  CI mode: scan files changed between two git revisions
"""
import argparse
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

from normalize_uct import contained, escaped, read_file_bytes, unique_object, reject_constant

HERE = Path(__file__).absolute().parent
RANKS = {"INFO": 0, "LOW": 1, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}
SEMGREP_SEVERITY = {"ERROR": "HIGH", "WARNING": "MEDIUM", "INFO": "LOW"}
HASH = re.compile(r"[0-9a-f]{64}")
MAX_BYTES = 2_000_000
EXIT_OK, EXIT_INVALID, EXIT_BLOCKED, EXIT_APPROVAL = 0, 1, 2, 3


class GateError(Exception):
    pass


def require(condition, reason="invalid-input"):
    if not condition:
        raise GateError(reason)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def parse_json(raw):
    return json.loads(raw, object_pairs_hook=unique_object, parse_constant=reject_constant)


def load_policy(timeout=None):
    path = HERE / "security-gate-policy.json"
    require(not any(p.is_symlink() for p in (path, *path.parents)), "policy-symlink")
    raw = read_file_bytes(path, MAX_BYTES)
    policy = parse_json(raw)
    require(type(policy) is dict and policy.get("schemaVersion") == 1, "policy-invalid")
    # The threshold may be stricter than HIGH but never weaker: High/Critical always block.
    require(policy.get("blockAtOrAbove") in RANKS and
            RANKS[policy["blockAtOrAbove"]] <= RANKS["HIGH"] and
            RANKS[policy["blockAtOrAbove"]] >= RANKS["LOW"], "policy-threshold-invalid")
    scanner = policy.get("scanner")
    require(type(scanner) is dict and type(scanner.get("command")) is list and
            all(isinstance(a, str) for a in scanner["command"]) and scanner["command"] and
            type(scanner.get("timeoutSeconds")) is int and 0 < scanner["timeoutSeconds"] <= 1800,
            "policy-scanner-invalid")
    require(type(policy.get("scannableExtensions")) is list, "policy-invalid")
    require(type(policy.get("ruleTargetPatterns")) is list and
            all(isinstance(p, str) and re.compile(p) for p in policy["ruleTargetPatterns"]),
            "policy-invalid")
    sensitive = policy.get("sensitive")
    require(type(sensitive) is dict, "policy-invalid")
    for key in ("pathPatterns", "contentPatterns", "phpContentPatterns"):
        require(type(sensitive.get(key)) is list, "policy-invalid")
        for pattern in sensitive[key]:
            re.compile(pattern)
    require(type(policy.get("authorizedOperators")) is list, "policy-invalid")
    if timeout is not None:
        # A caller may only shorten the policy timeout, never extend it.
        require(type(timeout) is int and timeout > 0, "timeout-invalid")
        scanner["timeoutSeconds"] = min(timeout, scanner["timeoutSeconds"])
    # The binding hash covers the policy and the rule pack, so editing either invalidates
    # every previously recorded gate result and approval.
    rules_raw = read_file_bytes(rules_path(), MAX_BYTES)
    policy["_rulesSha256"] = digest(rules_raw)
    policy["_sha256"] = digest(raw + b"\0" + rules_raw)
    return policy


def rules_path():
    path = HERE / "semgrep-magento-security.yml"
    require(path.is_file() and not path.is_symlink(), "rules-missing")
    return path


def project_root(arg):
    root = Path(arg).absolute()
    require(root.is_dir() and not any(p.is_symlink() for p in (root, *root.parents)), "invalid-root")
    return root


def now():
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------- scanning

def scanner_argv(policy, stage, override):
    template = override if override is not None else policy["scanner"]["command"]
    mapping = {"{rules}": str(rules_path()), "{target}": "."}
    argv = [mapping.get(arg, arg) for arg in template]
    return argv


def severity_of(result):
    extra = result.get("extra") if isinstance(result, dict) else None
    require(type(extra) is dict, "scanner-result-invalid")
    metadata = extra.get("metadata") if type(extra.get("metadata")) is dict else {}
    declared = metadata.get("ccua_severity")
    if isinstance(declared, str) and declared.upper() in RANKS:
        return declared.upper()
    mapped = SEMGREP_SEVERITY.get(str(extra.get("severity", "")).upper())
    require(mapped is not None, "scanner-severity-unknown")
    return mapped


BENIGN_SKIP_REASONS = {"excluded_by_config", "wrong_language", "irrelevant_rule",
                       "cli_include_flags_do_not_match"}


def check_coverage(output, names, targets):
    """Every staged file must have been analysed; ignored, oversized or unparsable files fail closed."""
    paths = output.get("paths")
    require(type(paths) is dict and type(paths.get("scanned")) is list and
            type(paths.get("skipped", [])) is list, "scanner-coverage-unknown")
    wanted = set(names)
    scanned = set()
    for entry in paths["scanned"]:
        require(isinstance(entry, str), "scanner-coverage-unknown")
        scanned.add(entry.removeprefix("./"))
    for item in paths.get("skipped", []):
        require(type(item) is dict and isinstance(item.get("path"), str), "scanner-coverage-unknown")
        if item["path"].removeprefix("./") in wanted and \
                item.get("reason") not in BENIGN_SKIP_REASONS:
            raise GateError("scanner-skipped-input")
    # Files the rule pack targets must all appear in the analysed inventory. Other permitted files
    # (composer.json, services.yaml, docs) have no applicable rule and so are not required.
    required = {n for n in wanted if any(re.search(p, n) for p in targets)}
    require(required <= scanned, "scanner-coverage-partial" if scanned & required else "scanner-coverage-empty")


def run_scanner(policy, stage, override, names=()):
    """Run the configured scanner over `stage`; any anomaly raises GateError (fail closed)."""
    # An empty ignore file replaces Semgrep's default exclusions (tests/, node_modules/, ...).
    Path(stage, ".semgrepignore").write_text("# ccua: scan every staged file\n", encoding="utf-8")
    argv = scanner_argv(policy, stage, override)
    try:
        result = subprocess.run(argv, cwd=stage, capture_output=True, text=True, check=False,
                                timeout=policy["scanner"]["timeoutSeconds"],
                                env={k: v for k, v in os.environ.items()
                                     if k in ("PATH", "HOME", "LANG", "LC_ALL", "TMPDIR",
                                              "PYTHONPATH", "VIRTUAL_ENV", "SEMGREP_USER_HOME")})
    except subprocess.TimeoutExpired:
        raise GateError("scanner-timeout") from None
    except (OSError, ValueError):
        raise GateError("scanner-unavailable") from None
    if result.returncode != 0:
        raise GateError("scanner-failed")
    try:
        output = parse_json(result.stdout)
    except ValueError:
        raise GateError("scanner-output-invalid") from None
    require(type(output) is dict and type(output.get("results")) is list and
            type(output.get("errors")) is list, "scanner-output-invalid")
    require(output["errors"] == [], "scanner-reported-errors")
    check_coverage(output, names, policy["ruleTargetPatterns"])
    findings = []
    for item in output["results"]:
        require(type(item) is dict and isinstance(item.get("check_id"), str) and
                isinstance(item.get("path"), str) and type(item.get("start")) is dict and
                type(item["start"].get("line")) is int, "scanner-result-invalid")
        extra = item["extra"]
        metadata = extra.get("metadata") if type(extra.get("metadata")) is dict else {}
        findings.append({
            "file": item["path"].removeprefix("./"), "line": item["start"]["line"],
            "rule": item["check_id"].split(".ccua.")[-1] if ".ccua." in item["check_id"] else item["check_id"],
            "severity": severity_of(item),
            "message": str(extra.get("message", ""))[:500],
            "remediation": str(metadata.get("remediation", ""))[:500],
            "category": str(metadata.get("category", ""))[:80]})
    findings.sort(key=lambda f: (-RANKS[f["severity"]], f["file"], f["line"], f["rule"]))
    return findings


def blocking(policy, findings):
    floor = RANKS[policy["blockAtOrAbove"]]
    return [f for f in findings if RANKS[f["severity"]] >= floor]


def scan_files(policy, files, override):
    """Copy (relative name, bytes) pairs into an isolated directory and scan them."""
    with tempfile.TemporaryDirectory(prefix="ccua-security-") as stage:
        for name, raw in files:
            target = Path(stage) / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
        if not files:
            return []
        return run_scanner(policy, stage, override, [name for name, _ in files])


def scannable(policy, name):
    return name.lower().endswith(tuple(policy["scannableExtensions"]))


def sensitive_reasons(policy, name, raw, flagged=False, before=None):
    rules = policy["sensitive"]
    reasons = []
    if flagged:
        reasons.append("plan-marked-sensitive")
    if any(re.search(p, name) for p in rules["pathPatterns"]):
        reasons.append("sensitive-path")
    lowered = name.lower()
    patterns = rules["contentPatterns"] if lowered.endswith(".xml") else \
        rules["phpContentPatterns"] if lowered.endswith((".php", ".phtml")) else []
    # Removing security-sensitive code is as sensitive as adding it, so the before-state counts.
    for blob in (raw, before):
        text = blob.decode("utf-8", errors="replace") if blob else ""
        if text and any(re.search(p, text) for p in patterns):
            reasons.append("sensitive-content")
            break
    return reasons


# ---------------------------------------------------------------- plan handling

def load_plan(root, plan_arg):
    require(isinstance(plan_arg, str) and
            re.fullmatch(r"\.ccua/review/[A-Za-z0-9_.-]+\.json", plan_arg), "invalid-plan-path")
    raw = read_file_bytes(contained(root, plan_arg), MAX_BYTES)
    plan = parse_json(raw)
    require(type(plan) is dict, "invalid-plan")
    for key in ("agent", "kind", "hop", "chunk", "changes"):
        require(key in plan, "invalid-plan")
    require(type(plan["hop"]) is int and plan["hop"] > 0 and type(plan["chunk"]) is int and
            0 <= plan["chunk"] <= 6 and type(plan["changes"]) is list and plan["changes"],
            "invalid-plan")
    seen = set()
    for change in plan["changes"]:
        require(type(change) is dict and isinstance(change.get("path"), str), "invalid-plan")
        require(change["path"] not in seen, "invalid-plan")
        seen.add(change["path"])
        require(not change["path"].startswith(("vendor/", ".ccua/")), "forbidden-path")
        contained(root, change["path"], must_exist=False)
        for stage in ("before", "after"):
            ref, sha = change.get(stage), change.get(stage + "Sha256")
            require((ref is None) == (sha is None), "invalid-plan")
            if ref is not None:
                require(isinstance(ref, str) and re.fullmatch(r"\.ccua/review/[A-Za-z0-9_.-]+", ref) and
                        isinstance(sha, str) and HASH.fullmatch(sha), "invalid-plan")
        require(change.get("before") is not None or change.get("after") is not None, "invalid-plan")
        require(type(change.get("sensitive", False)) is bool, "invalid-plan")
    return plan, digest(raw)


def finding_key(plan):
    """A retry supersedes a rejected plan only for the same finding: its reviewed issue, else its file set."""
    issue = plan["changes"][0].get("issue")
    if type(issue) is dict and isinstance(issue.get("kind"), str) and isinstance(issue.get("id"), (int, str)):
        return "issue:%s:%s" % (issue["kind"], issue["id"])
    return "paths:" + ",".join(sorted(c["path"] for c in plan["changes"]))


def proposed_files(root, plan):
    """Return (scan files, deleted paths, per-change records) from the plan's reviewed fixtures."""
    files, deleted, changes = [], [], []
    for change in plan["changes"]:
        raw = b""
        if change["after"] is None:
            deleted.append(change["path"])
        else:
            raw = read_file_bytes(contained(root, change["after"]), MAX_BYTES)
            require(digest(raw) == change["afterSha256"], "fixture-hash-mismatch")
            files.append((change["path"], raw))
        changes.append((change, raw))
    return files, deleted, changes


def record_path(root, plan, plan_sha):
    name = "security-gate-hop%d-chunk%d-%s.json" % (plan["hop"], plan["chunk"], plan_sha[:12])
    return root / ".ccua" / "review" / name


def approval_path(root, plan, plan_sha):
    name = "security-approval-hop%d-chunk%d-%s.json" % (plan["hop"], plan["chunk"], plan_sha[:12])
    return root / ".ccua" / "review" / name


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    require(not path.is_symlink(), "artifact-symlink")
    # mkstemp creates a fresh 0600 file (O_EXCL), so a pre-planted symlink is never followed.
    handle, temporary = tempfile.mkstemp(dir=path.parent, prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            stream.write(json.dumps(value, indent=2, sort_keys=True) + "\n")
        os.replace(temporary, path)
    except BaseException:
        if os.path.lexists(temporary):
            os.unlink(temporary)
        raise


def read_json(path):
    if not path.is_file() or path.is_symlink():
        return None
    try:
        return parse_json(read_file_bytes(path, MAX_BYTES))
    except (ValueError, OSError):
        return None


def valid_approval(root, policy, plan, plan_sha, sensitive):
    record = read_json(approval_path(root, plan, plan_sha))
    if type(record) is not dict:
        return False
    operator = record.get("operator")
    expected = {c["path"]: c.get("afterSha256") for c, _ in sensitive}
    return (record.get("schemaVersion") == 1 and record.get("planSha256") == plan_sha and
            record.get("policySha256") == policy["_sha256"] and record.get("interactive") is True and
            record.get("decision") == "approved" and isinstance(operator, str) and operator and
            (not policy["authorizedOperators"] or operator in policy["authorizedOperators"]) and
            record.get("files") == expected)


def prior_chunk_blockers(root, plan):
    latest = {}
    for path in sorted((root / ".ccua" / "review").glob("security-gate-hop%d-chunk*.json" % plan["hop"])):
        record = read_json(path)
        if type(record) is not dict or not isinstance(record.get("recordedAt"), str):
            continue
        chunk = record.get("chunk")
        if type(chunk) is int and chunk < plan["chunk"]:
            key = (chunk, record.get("finding") if isinstance(record.get("finding"), str) else "paths:" + ",".join(record.get("paths") or []))
            if key not in latest or record["recordedAt"] >= latest[key]["recordedAt"]:
                latest[key] = record
    return ["previous-chunk-%d-not-accepted:%s" % key
            for key, record in sorted(latest.items()) if record.get("status") != "accepted"]


def recovery(root, changes):
    """Describe, never perform, the recovery for a rejected plan."""
    notes = []
    for change, _ in changes:
        target = root / change["path"]
        current = digest(target.read_bytes()) if target.is_file() and not target.is_symlink() else None
        applied = (current == change.get("afterSha256") if change.get("after") is not None
                   else not target.exists() and not target.is_symlink())
        if applied:
            state = "applied-rejected: revert only this file to its reviewed before-state by hand"
        elif current == change.get("beforeSha256"):
            state = "not-applied: no action needed"
        else:
            state = "diverged: contains other edits; do not overwrite, review manually"
        notes.append({"path": change["path"], "state": state})
    return notes


def build_report(kind, status, blockers, findings, policy, extra):
    return {"schemaVersion": 1, "kind": kind, "status": status, "recordedAt": now(),
            "blockAtOrAbove": policy["blockAtOrAbove"], "blockers": blockers,
            "counts": {s: sum(1 for f in findings if f["severity"] == s) for s in RANKS},
            "findings": findings, **extra}


def render(report):
    lines = ["Security gate: %s (%s)" % (report["status"].upper(), report["kind"]),
             "Blocks at or above %s" % report["blockAtOrAbove"]]
    for blocker in report["blockers"]:
        lines.append("BLOCKER: " + blocker)
    if report["findings"]:
        lines.append("%-9s %-40s %-28s %s" % ("SEVERITY", "LOCATION", "RULE", "REMEDIATION"))
    for f in report["findings"]:
        lines.append("%-9s %-40s %-28s %s" % (f["severity"], "%s:%d" % (f["file"], f["line"]),
                                            f["rule"], f["remediation"] or f["message"]))
    for item in report.get("sensitive", []):
        lines.append("SENSITIVE: %s (%s)" % (item["path"], ", ".join(item["reasons"])))
    for item in report.get("recovery", []):
        lines.append("RECOVERY: %s -> %s" % (item["path"], item["state"]))
    return "\n".join(lines)


def scan_plan(root, plan, plan_sha, policy, override):
    files, deleted, changes = proposed_files(root, plan)
    blockers, findings = [], []
    try:
        findings = scan_files(policy, files, override)
        if blocking(policy, findings):
            blockers.append("blocking-findings")
    except GateError as error:
        blockers.append(str(error))
    blockers += prior_chunk_blockers(root, plan)
    sensitive = []
    for change, raw in changes:
        before = None
        if change.get("before") is not None:
            before = read_file_bytes(contained(root, change["before"]), MAX_BYTES)
            require(digest(before) == change["beforeSha256"], "fixture-hash-mismatch")
        reasons = sensitive_reasons(policy, change["path"], raw, change.get("sensitive", False), before)
        if reasons:
            sensitive.append((change, reasons))
    return files, deleted, changes, findings, blockers, sensitive


# ---------------------------------------------------------------- commands

def cmd_gate(args):
    root, policy = project_root(args.project_root), load_policy(getattr(args, 'timeout_seconds', None))
    plan, plan_sha = load_plan(root, args.plan)
    files, deleted, changes, findings, blockers, sensitive = scan_plan(
        root, plan, plan_sha, policy, args.scanner_cmd)
    approved = bool(sensitive) and valid_approval(root, policy, plan, plan_sha,
                                                  [(c, None) for c, _ in sensitive])
    if blockers:
        status = "blocked"
    elif sensitive and not approved:
        status = "pending-approval"
    else:
        status = "accepted"
    report = build_report("chunk", status, blockers, findings, policy, {
        "planSha256": plan_sha, "policySha256": policy["_sha256"],
        "rulesSha256": policy["_rulesSha256"], "hop": plan["hop"],
        "chunk": plan["chunk"], "scannerOverride": args.scanner_cmd is not None,
        "finding": finding_key(plan), "paths": sorted(c["path"] for c, _ in changes), "deleted": sorted(deleted),
        "sensitive": [{"path": c["path"], "reasons": r, "afterSha256": c.get("afterSha256")}
                      for c, r in sensitive],
        "approval": "granted" if approved else ("required" if sensitive else "not-required"),
        "recovery": recovery(root, changes) if blockers else []})
    write_json(record_path(root, plan, plan_sha), report)
    print(render(report))
    if status == "pending-approval":
        print("Human approval required: run `security_gate.py approve %s --expected-plan-sha256 %s` "
              "in an interactive terminal." % (args.plan, plan_sha))
    return {"accepted": EXIT_OK, "blocked": EXIT_BLOCKED, "pending-approval": EXIT_APPROVAL}[status]


def cmd_approve(args):
    root, policy = project_root(args.project_root), load_policy(getattr(args, 'timeout_seconds', None))
    plan, plan_sha = load_plan(root, args.plan)
    require(args.expected_plan_sha256 == plan_sha, "plan-hash-mismatch")
    files, deleted, changes, findings, blockers, sensitive = scan_plan(
        root, plan, plan_sha, policy, args.scanner_cmd)
    if blockers:
        print("Refusing approval: scan is blocked (%s)." % ", ".join(blockers), file=sys.stderr)
        return EXIT_BLOCKED
    if not sensitive:
        print("No sensitive changes; approval not applicable.")
        return EXIT_OK
    # Approval is only accepted from a live terminal, never from piped or agent-supplied input.
    if not (sys.stdin.isatty() and sys.stdout.isatty()):
        print("Approval requires an interactive terminal; treated as rejection.", file=sys.stderr)
        return EXIT_APPROVAL
    operator = getpass.getuser()
    if policy["authorizedOperators"] and operator not in policy["authorizedOperators"]:
        print("Operator is not authorized; treated as rejection.", file=sys.stderr)
        return EXIT_APPROVAL
    print("Sensitive AI-generated changes (hop %d, chunk %d):" % (plan["hop"], plan["chunk"]))
    for change, reasons in sensitive:
        before = (root / change["before"]).read_text("utf-8", "replace").count("\n") if change["before"] else 0
        after = (root / change["after"]).read_text("utf-8", "replace").count("\n") if change["after"] else 0
        print("  %s [%s] lines %d -> %d diff %s" % (change["path"], ", ".join(reasons), before, after,
                                                   change["diffSha256"][:12]
                                                   if isinstance(change.get("diffSha256"), str) else "n/a"))
    print("Review the exact diffs first. Type exactly: APPROVE %s" % plan_sha[:12])
    try:
        answer = input("> ").strip()
    except (EOFError, KeyboardInterrupt):
        answer = ""
    if answer != "APPROVE " + plan_sha[:12]:
        print("Approval not granted; changes remain rejected.", file=sys.stderr)
        return EXIT_APPROVAL
    write_json(approval_path(root, plan, plan_sha), {
        "schemaVersion": 1, "decision": "approved", "interactive": True, "operator": operator,
        "planSha256": plan_sha, "policySha256": policy["_sha256"], "approvedAt": now(),
        "files": {c["path"]: c.get("afterSha256") for c, _ in sensitive}})
    print("Approval recorded. Re-run `gate` to accept the chunk.")
    return EXIT_OK


def cmd_verify(args):
    root, policy = project_root(args.project_root), load_policy(getattr(args, 'timeout_seconds', None))
    plan, plan_sha = load_plan(root, args.plan)
    record = read_json(record_path(root, plan, plan_sha))
    require(type(record) is dict and record.get("planSha256") == plan_sha and
            record.get("policySha256") == policy["_sha256"], "no-gate-record")
    require(record.get("status") == "accepted" and record.get("blockers") == [], "gate-not-accepted")
    if record.get("sensitive"):
        flagged = [(c, None) for c in plan["changes"]
                   if c["path"] in {s["path"] for s in record["sensitive"]}]
        require(valid_approval(root, policy, plan, plan_sha, flagged), "approval-missing-or-invalid")
    if args.applied:
        for change in plan["changes"]:
            target = root / change["path"]
            if change["after"] is None:
                require(not target.exists(), "tree-drift")
            else:
                require(target.is_file() and not target.is_symlink() and
                        digest(read_file_bytes(target, MAX_BYTES)) == change["afterSha256"], "tree-drift")
    print("Security gate record verified for hop %d chunk %d." % (plan["hop"], plan["chunk"]))
    return EXIT_OK


def record_accepted(root, policy, plan, plan_sha):
    """True only for an accepted gate record bound to the current policy/rules and any needed approval."""
    record = read_json(record_path(root, plan, plan_sha))
    if (type(record) is not dict or record.get("status") != "accepted" or record.get("blockers") != [] or
            record.get("planSha256") != plan_sha or record.get("policySha256") != policy["_sha256"]):
        return False
    if record.get("sensitive"):
        paths = {s["path"] for s in record["sensitive"]}
        flagged = [(c, None) for c in plan["changes"] if c["path"] in paths]
        return valid_approval(root, policy, plan, plan_sha, flagged)
    return True


def cmd_final(args):
    root, policy = project_root(args.project_root), load_policy(getattr(args, 'timeout_seconds', None))
    blockers, hops, loaded = [], [], []
    for plan_arg in args.plans:
        loaded.append(load_plan(root, plan_arg))
    loaded.sort(key=lambda item: (item[0]["hop"], item[0]["chunk"]))
    expected, sensitive_paths = {}, set()
    for plan, plan_sha in loaded:
        hops.append({"hop": plan["hop"], "chunk": plan["chunk"], "planSha256": plan_sha})
        if not record_accepted(root, policy, plan, plan_sha):
            blockers.append("chunk-gate-not-accepted:hop%d-chunk%d" % (plan["hop"], plan["chunk"]))
        record = read_json(record_path(root, plan, plan_sha))
        if type(record) is dict and type(record.get("sensitive")) is list:
            sensitive_paths |= {i["path"] for i in record["sensitive"] if isinstance(i, dict)}
        for change in plan["changes"]:
            expected[change["path"]] = change.get("afterSha256")  # last change wins
    files, deleted, drift = [], [], []
    for name, after_sha in sorted(expected.items()):
        target = contained(root, name, must_exist=False)
        present = target.exists() or target.is_symlink()
        if after_sha is None:
            deleted.append(name)
            if present:
                blockers.append("deleted-file-present:" + name)
            continue
        if not (target.is_file() and not target.is_symlink()):
            blockers.append("expected-file-missing:" + name)
            continue
        raw = read_file_bytes(target, MAX_BYTES)
        if digest(raw) != after_sha:
            drift.append(name)
            # Changed after its reviewed state: approval no longer covers it, and any file that
            # now reads as sensitive needs a new hash-bound plan and approval.
            if name in sensitive_paths or sensitive_reasons(policy, name, raw):
                blockers.append("sensitive-file-changed-after-approval:" + name)
        if scannable(policy, name):
            files.append((name, raw))
    findings = []
    try:
        findings = scan_files(policy, files, args.scanner_cmd)
        if blocking(policy, findings):
            blockers.append("blocking-findings")
    except GateError as error:
        blockers.append(str(error))
    report = build_report("post-upgrade", "blocked" if blockers else "accepted", blockers, findings,
                          policy, {"policySha256": policy["_sha256"], "plans": hops,
                                   "paths": sorted(expected), "deleted": deleted, "drift": drift,
                                   "scannerOverride": args.scanner_cmd is not None})
    write_json(root / ".ccua" / "review" / "security-final-report.json", report)
    print(render(report))
    return EXIT_BLOCKED if blockers else EXIT_OK


def git_names(root, base, head):
    require(re.fullmatch(r"[0-9A-Za-z._/~^-]{1,100}", base) and
            re.fullmatch(r"[0-9A-Za-z._/~^-]{1,100}", head), "invalid-revision")
    zero = set(base) == {"0"}
    command = (["git", "ls-tree", "-r", "-z", "--name-only", head] if zero else
               ["git", "diff", "--name-only", "--no-renames", "--diff-filter=ACMT", "-z",
                base, head, "--"])
    try:
        out = subprocess.run(command, cwd=root, capture_output=True, check=True, timeout=60).stdout
    except (OSError, subprocess.SubprocessError):
        raise GateError("git-diff-failed") from None
    return [n for n in out.decode("utf-8", "surrogateescape").split("\0") if n]


def cmd_changed_scan(args):
    root, policy = project_root(args.project_root), load_policy(getattr(args, 'timeout_seconds', None))
    blockers, findings, names = [], [], []
    try:
        names = [n for n in git_names(root, args.base, args.head) if scannable(policy, n)]
        files = []
        for name in names:
            target = contained(root, name, must_exist=False)
            if target.is_file():
                files.append((name, read_file_bytes(target, MAX_BYTES)))
        findings = scan_files(policy, files, args.scanner_cmd)
        if blocking(policy, findings):
            blockers.append("blocking-findings")
        sensitive = [{"path": n, "reasons": r} for n, raw in files
                     for r in [sensitive_reasons(policy, n, raw)] if r]
    except (GateError, ValueError, OSError) as error:
        blockers.append(str(error) if isinstance(error, GateError) else "scan-setup-failed")
        sensitive = []
    report = build_report("ci", "blocked" if blockers else "accepted", blockers, findings, policy,
                          {"policySha256": policy["_sha256"], "paths": sorted(names),
                           "sensitive": sensitive})
    if args.output:
        write_json(Path(args.output).absolute(), report)
    print(render(report))
    return EXIT_BLOCKED if blockers else EXIT_OK


def scanner_json(value):
    try:
        parsed = json.loads(value)
    except ValueError:
        raise argparse.ArgumentTypeError("--scanner-cmd must be a JSON array of strings") from None
    if not (type(parsed) is list and parsed and all(isinstance(a, str) for a in parsed)):
        raise argparse.ArgumentTypeError("--scanner-cmd must be a JSON array of strings")
    return parsed


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="action", required=True)
    for name in ("gate", "approve", "verify", "final", "changed-scan"):
        p = sub.add_parser(name)
        p.add_argument("--project-root", default=".")
        if name in ("gate", "approve", "final", "changed-scan"):
            p.add_argument("--scanner-cmd", type=scanner_json, default=None,
                           help="JSON argv override; {rules} and {target} are substituted")
            p.add_argument("--timeout-seconds", type=int, default=None,
                           help="shorten (never extend) the policy scanner timeout")
        if name in ("gate", "approve", "verify"):
            p.add_argument("plan")
        if name == "approve":
            p.add_argument("--expected-plan-sha256", required=True)
        if name == "verify":
            p.add_argument("--applied", action="store_true")
        if name == "final":
            p.add_argument("--plans", nargs="+", required=True)
        if name == "changed-scan":
            p.add_argument("--base", required=True)
            p.add_argument("--head", default="HEAD")
            p.add_argument("--output")
    args = parser.parse_args()
    handlers = {"gate": cmd_gate, "approve": cmd_approve, "verify": cmd_verify,
                "final": cmd_final, "changed-scan": cmd_changed_scan}
    try:
        return handlers[args.action](args)
    except (GateError, ValueError, OSError, KeyError, TypeError, re.error) as error:
        reason = str(error) if isinstance(error, GateError) else "invalid-input"
        print("Security gate rejected the request (%s); nothing was accepted." % reason,
              file=sys.stderr)
        return EXIT_INVALID


if __name__ == "__main__":
    sys.exit(main())
