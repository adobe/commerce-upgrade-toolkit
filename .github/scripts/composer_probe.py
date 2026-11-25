#!/usr/bin/env python3
# Copyright 2026 Adobe. All rights reserved.
# Licensed under the Apache License, Version 2.0.
# https://www.apache.org/licenses/LICENSE-2.0
# SPDX-License-Identifier: Apache-2.0
"""Run one read-only Composer metadata query inside the approved dev container.

The container's ambient Composer credentials (for example the Warden ~/.composer mount that
holds repo.magento.com and vendor license keys) authenticate the query implicitly. This helper
never reads, lists, forwards or prints any credential: it builds a fixed Composer argv from
validated tokens, runs it with a filtered host environment, and returns only whitelisted,
escaped metadata fields. Raw Composer output and stderr are never returned.
"""
import argparse
import json
import os
import re
import subprocess
import sys

sys.dont_write_bytecode = True
from normalize_uct import unique_object, reject_constant, escaped

LIMIT = 20_000_000
DEFAULT_TIMEOUT = 300
PACKAGE = re.compile(r"^[a-z0-9_.-]{1,64}/[a-z0-9_.-]{1,64}$")
VERSION = re.compile(r"^[0-9][0-9A-Za-z.+_-]{0,31}$")
PREFIX_TOKEN = re.compile(r"^[A-Za-z0-9_@%+=:,./-]{1,200}$")
DENIED_PREFIX = {"sh", "bash", "zsh", "dash", "ksh", "-c", "-e", "--env", "--env-file", "-u",
                 "--user", "--privileged", "-v", "--volume", "--mount", "composer"}
DENIED_FRAGMENTS = ("composer_auth", "auth.json", ".composer", ".ssh", "ssh-auth", "id_rsa", "id_ed25519")
ENV_ALLOW = ("PATH", "HOME", "LANG", "LC_ALL", "DOCKER_HOST", "DOCKER_CONTEXT")
FIXED = ["--no-interaction", "--no-ansi", "--no-plugins", "--no-scripts"]
CREDENTIAL = re.compile(
    r"://[^/\s:@]+:[^/\s@]+@|-----BEGIN|\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}"
    r"|\b[0-9a-f]{32}\b|(?i:bearer\s+[A-Za-z0-9._~+/-]{16,})"
    r"|(?i:\"?(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)\"?\s*[:=])")
FAILURES = (
    ("authentication", re.compile(r"\b(?:401|403)\b|could not authenticate|authentication required|"
                                   r"invalid credentials|bad credentials|forbidden|unauthori[sz]ed", re.I)),
    ("network", re.compile(r"could not resolve host|timed out|connection (?:refused|reset)|"
                           r"curl error|network is unreachable|ssl", re.I)),
    ("not-found", re.compile(r"could not find (?:package|a matching version)|not found|"
                             r"no composer\.json|is not installed", re.I)),
)


class Withheld(ValueError):
    pass


def text(value, limit=200):
    if not isinstance(value, str):
        return None
    value = "".join(ch if ch.isprintable() else " " for ch in value)[:limit]
    if CREDENTIAL.search(value):
        raise Withheld("credential-shaped content")
    return value


def optional_text(value, limit=200):
    try:
        return text(value, limit)
    except Withheld:
        return None


def package_map(value):
    if not isinstance(value, dict):
        return {}
    result = {}
    for key, constraint in list(value.items())[:150]:
        if isinstance(key, str) and isinstance(constraint, str) and re.match(r"^[a-z0-9_.*/-]{1,130}$", key):
            result[key] = text(constraint, 120)
    return result


def abandoned(value):
    return value if isinstance(value, bool) else text(value, 120) if isinstance(value, str) else False


def project(op, data):
    if op == "outdated":
        rows = data.get("installed") if isinstance(data, dict) else None
        if not isinstance(rows, list):
            raise ValueError("unexpected outdated shape")
        return [{"name": text(row.get("name"), 130), "version": text(row.get("version"), 40),
                 "latest": text(row.get("latest"), 40), "latestStatus": text(row.get("latest-status"), 40),
                 "abandoned": abandoned(row.get("abandoned")), "description": optional_text(row.get("description"))}
                for row in rows[:2000] if isinstance(row, dict)]
    if not isinstance(data, dict):
        raise ValueError("unexpected show shape")
    result = {"name": text(data.get("name"), 130), "abandoned": abandoned(data.get("abandoned")),
              "type": text(data.get("type"), 60)}
    if op == "versions":
        versions = data.get("versions")
        result["versions"] = [v for v in (versions if isinstance(versions, list) else [])[:500]
                              if isinstance(v, str) and VERSION.match(v.lstrip("v"))]
    else:
        result.update({"version": text(data.get("versions", [None])[0] if isinstance(data.get("versions"), list)
                                       and data["versions"] else None, 40),
                       "released": text(data.get("released") or data.get("time"), 40),
                       "requires": package_map(data.get("requires")),
                       "conflicts": package_map(data.get("conflicts"))})
    return result


def classify(raw):
    for kind, pattern in FAILURES:
        if pattern.search(raw):
            return kind
    return "failed"


def prefix_argv(tokens):
    if not tokens:
        raise ValueError("missing live-verified container prefix argv")
    for token in tokens:
        lowered = token.lower()
        if (not PREFIX_TOKEN.match(token) or lowered.split("=")[0] in DENIED_PREFIX
                or any(fragment in lowered for fragment in DENIED_FRAGMENTS)):
            raise ValueError("container prefix contains a token that is not permitted")
    # Non-interactive run: a pseudo-TTY request would make docker refuse the DEVNULL stdin.
    return ["-i" if token in ("-it", "-ti") else token for token in tokens if token != "-t"]


def composer_argv(args):
    if args.op == "outdated":
        if args.package or args.version:
            raise ValueError("outdated takes no package or version")
        return ["composer", "outdated", "--direct", "--format=json"] + FIXED
    if not args.package or not PACKAGE.match(args.package):
        raise ValueError("package must be a lowercase vendor/name")
    if args.op == "versions":
        if args.version:
            raise ValueError("versions takes no version")
        return ["composer", "show", "--all", "--format=json", args.package] + FIXED
    if not args.version or not VERSION.match(args.version):
        raise ValueError("release requires a validated version token")
    # --all is required: without it Composer only finds versions that are already installed.
    return ["composer", "show", "--all", "--format=json", args.package, args.version] + FIXED


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", default=".")
    parser.add_argument("--op", choices=("outdated", "versions", "release"), required=True)
    parser.add_argument("--package")
    parser.add_argument("--version")
    parser.add_argument("--timeout-seconds", type=int, default=DEFAULT_TIMEOUT)
    parser.add_argument("prefix", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    try:
        tokens = args.prefix[1:] if args.prefix[:1] == ["--"] else args.prefix
        command = prefix_argv(tokens) + composer_argv(args)
        root = os.path.abspath(args.project_root)
        if not os.path.isdir(root):
            raise ValueError("project root is not a directory")
        environment = {name: os.environ[name] for name in ENV_ALLOW if name in os.environ}
        timeout = max(1, min(args.timeout_seconds, DEFAULT_TIMEOUT))
    except ValueError as error:
        print("Composer probe rejected: " + str(error), file=sys.stderr)
        return 1
    try:
        result = subprocess.run(command, cwd=root, env=environment, stdin=subprocess.DEVNULL,
                                capture_output=True, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        kind = "timeout" if isinstance(error, subprocess.TimeoutExpired) else "execution-failed"
        print(escaped({"op": args.op, "status": "failed", "kind": kind, "exit": None}))
        return 1
    raw_out, raw_err = result.stdout[:LIMIT + 1], result.stderr[:LIMIT + 1]
    if result.returncode != 0 or len(raw_out) > LIMIT:
        kind = classify((raw_out + b"\n" + raw_err).decode("utf-8", "replace")[:200_000])
        print(escaped({"op": args.op, "status": "failed", "kind": kind, "exit": result.returncode}))
        return 1
    try:
        data = json.loads(raw_out, object_pairs_hook=unique_object, parse_constant=reject_constant)
        rows = project(args.op, data)
    except Withheld:
        print(escaped({"op": args.op, "status": "failed", "kind": "output-withheld", "exit": 0}))
        return 1
    except (ValueError, RecursionError):
        print(escaped({"op": args.op, "status": "failed", "kind": "unsupported-output", "exit": 0}))
        return 1
    print(escaped({"op": args.op, "status": "ok", "package": args.package, "data": rows}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
