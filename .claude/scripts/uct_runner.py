#!/usr/bin/env python3
# Copyright 2026 Adobe. All rights reserved.
# Licensed under the Apache License, Version 2.0.
# https://www.apache.org/licenses/LICENSE-2.0
# SPDX-License-Identifier: Apache-2.0
"""Run a standalone UCT inside a separate, locked-down container (for projects on older PHP).

UCT 3.x needs PHP 8.4+, which the project's own container may not have. UCT analyses source
statically, so it can run elsewhere: this helper builds a fixed `docker run` argv, with no
network, no credential mounts, the project mounted read-only at its own host path (so UCT's
reported file names are host paths the normalizer accepts, with no path remapping) and only the
capture context directory writable, then executes it. Use it as the command argv for `capture_uct.py`.
"""
import argparse
import os
import re
import subprocess
import sys

sys.dont_write_bytecode = True

IMAGE = re.compile(r"^[a-z0-9][a-z0-9._/-]{0,100}(?::[A-Za-z0-9._-]{1,64})?(?:@sha256:[0-9a-f]{64})?$")
CONTEXTS = (".claude/context", ".github/context")
CREDENTIAL_PARTS = {".composer", ".ssh", ".aws", ".config", ".gnupg", ".docker", ".kube", ".npmrc"}
ALLOWED_FLAGS = {"--current-version", "--coming-version", "--json-output-path", "--html-output-path",
                 "--min-issue-level"}
ALLOWED_SWITCHES = {"--ignore-current-version-compatibility-issues", "-i", "--no-interaction", "-n"}
VERSION = re.compile(r"^\d+\.\d+\.\d+(?:-p\d+)?$")
LEVELS = {"warning", "error", "critical"}
OUTPUT = re.compile(r"^(?:\.claude|\.github)/context/\.uct-capture-[0-9a-f]{32}/report\.json$")
DEFAULT_IMAGE = "ccua-uct-runner:php8.4"
ENV_ALLOW = ("PATH", "HOME", "LANG", "LC_ALL", "DOCKER_HOST", "DOCKER_CONTEXT")


def reject(message):
    raise ValueError(message)


def clean_directory(value, label):
    if not value or not os.path.isabs(value) or os.path.islink(value) or not os.path.isdir(value):
        reject(label + " must be an existing absolute non-symlink directory")
    if re.search(r"[:,\s]", value):
        reject(label + " must not contain ':', ',' or whitespace (Docker mount syntax)")
    real = os.path.realpath(value)
    if real != os.path.abspath(value):
        reject(label + " must not contain symbolic links")
    if CREDENTIAL_PARTS.intersection(real.split(os.sep)):
        reject(label + " must not be inside a credential directory")
    return real


def scan_args(rest):
    """Accept only a fixed UCT command shape; anything else is rejected before launch."""
    if rest == ["--version"]:
        return rest, False
    if rest[:2] == ["help", "upgrade:check"] and len(rest) == 2:
        return rest, False
    if not rest or rest[0] != "upgrade:check":
        reject("only --version, help upgrade:check and upgrade:check are permitted")
    result, wrote, index = ["upgrade:check", "."], False, 1
    if rest[1:2] != ["."]:
        reject("scan target must be the project root '.'")
    index = 2
    while index < len(rest):
        arg = rest[index]
        name, sep, value = arg.partition("=")
        if arg in ALLOWED_SWITCHES:
            result.append(arg)
        elif name in ALLOWED_FLAGS and sep:
            if name in ("--current-version", "--coming-version") and not VERSION.match(value):
                reject(name + " must be digits.digits.digits[-pN]")
            elif name == "--min-issue-level" and value not in LEVELS:
                reject("--min-issue-level must be warning, error or critical")
            elif name == "--json-output-path":
                if not OUTPUT.match(value):
                    reject("--json-output-path must be the capture helper's private report path")
                wrote = True
            elif name == "--html-output-path":
                reject("HTML output is not supported through the runner")
            result.append(arg)
        else:
            reject("unsupported UCT argument: " + name)
        index += 1
    return result, wrote


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", default=DEFAULT_IMAGE, help="local image with PHP 8.4+ and Node")
    parser.add_argument("--uct-path", help="host directory of the standalone UCT "
                        "(default: ~/.aio-ccua/tools/uct-standalone/<project directory name>, "
                        "else ~/.claude/tools/uct-standalone/<project directory name>)")
    parser.add_argument("--project-root", default=".")
    parser.add_argument("--context-dir", choices=CONTEXTS, default=".github/context")
    parser.add_argument("--memory", default="6g")
    parser.add_argument("--timeout-seconds", type=int, default=3600)
    parser.add_argument("uct", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    try:
        if not IMAGE.match(args.image):
            reject("image name is not permitted")
        if not re.match(r"^[1-9]\d{0,3}[mg]$", args.memory):
            reject("memory must look like 6g")
        root = clean_directory(os.path.abspath(args.project_root), "--project-root")
        candidates = [os.path.join(os.path.expanduser("~"), tools, "tools", "uct-standalone",
                                   os.path.basename(root)) for tools in (".aio-ccua", ".claude")]
        default = next((path for path in candidates if os.path.isfile(os.path.join(path, "bin", "uct"))),
                       candidates[0])
        # Check the credential-directory rule on the path as given, before resolving defaults.
        uct = clean_directory(args.uct_path or default, "--uct-path")
        if not os.path.isfile(os.path.join(uct, "bin", "uct")):
            reject("--uct-path does not contain bin/uct")
        rest = args.uct[1:] if args.uct[:1] == ["--"] else args.uct
        uct_args, writes = scan_args(rest)
        context = clean_directory(os.path.join(root, args.context_dir), "context directory") if writes else None
        command = ["docker", "run", "--rm", "--network", "none", "--cap-drop", "ALL",
                   "--security-opt", "no-new-privileges", "--read-only", "--tmpfs", "/tmp",
                   "--memory", args.memory, "--user", "%d:%d" % (os.getuid(), os.getgid()),
                   "-e", "HOME=/tmp", "-v", uct + ":/uct:ro", "-v", root + ":" + root + ":ro"]
        if context:
            command += ["-v", context + ":" + context]
        # UCT writes an HTML report under its own var/ even when none is requested.
        command += ["--tmpfs", "/uct/var:rw,mode=1777", "-w", root, args.image,
                    "php", "-d", "memory_limit=-1", "/uct/bin/uct"] + uct_args
        environment = {name: os.environ[name] for name in ENV_ALLOW if name in os.environ}
        timeout = max(1, min(args.timeout_seconds, 14400))
    except ValueError as error:
        print("UCT runner rejected: " + str(error), file=sys.stderr)
        return 1
    try:
        return subprocess.run(command, env=environment, stdin=subprocess.DEVNULL, timeout=timeout,
                              check=False).returncode
    except subprocess.TimeoutExpired:
        print("UCT runner timed out", file=sys.stderr)
        return 124
    except OSError:
        print("UCT runner could not launch docker", file=sys.stderr)
        return 127


if __name__ == "__main__":
    sys.exit(main())
