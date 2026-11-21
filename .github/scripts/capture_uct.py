#!/usr/bin/env python3
# Copyright 2026 Adobe. All rights reserved.
# Licensed under the Apache License, Version 2.0.
# https://www.apache.org/licenses/LICENSE-2.0
# SPDX-License-Identifier: Apache-2.0
"""Capture an approved UCT argv without opening the final audit path for writing."""
import argparse
import hashlib
import json
import os
import secrets
import stat
import subprocess
import sys

sys.dont_write_bytecode = True
from normalize_uct import unique_object, reject_constant, escaped

LIMIT = 20_000_000
REPORT = "upgrade-findings.json"
PLACEHOLDER = "--json-output-path={uct-report}"


def open_directory(name, parent=None):
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    descriptor = os.open("/", flags) if parent is None else os.dup(parent)
    try:
        for part in name.split("/"):
            if not part:
                continue
            child = os.open(part, flags, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        return descriptor
    except OSError:
        os.close(descriptor)
        raise


def identity(metadata):
    return metadata.st_dev, metadata.st_ino


def read_capture(descriptor):
    before = os.fstat(descriptor)
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > LIMIT:
        raise ValueError("unsafe capture file")
    os.lseek(descriptor, 0, os.SEEK_SET)
    with os.fdopen(os.dup(descriptor), "rb") as stream:
        raw = stream.read(LIMIT + 1)
    after = os.fstat(descriptor)
    if (len(raw) > LIMIT or identity(before) != identity(after)
            or before.st_size != after.st_size or before.st_mtime_ns != after.st_mtime_ns):
        raise ValueError("capture changed during read")
    return raw


def raw_state(directory):
    try:
        metadata = os.stat(REPORT, dir_fd=directory, follow_symlinks=False)
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1 or metadata.st_size > LIMIT:
        raise ValueError("unsafe raw destination")
    descriptor = os.open(REPORT, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    try:
        if identity(metadata) != identity(os.fstat(descriptor)):
            raise ValueError("raw destination changed")
        raw = read_capture(descriptor)
        value = json.loads(raw, object_pairs_hook=unique_object, parse_constant=reject_constant)
        if (type(value) is not dict or not set(value) <= {"summary", "errors", "warnings", "targetVersion"}
                or not any(key in value for key in ("errors", "warnings"))
                or any(type(value[key]) is not list for key in ("errors", "warnings") if key in value)):
            raise ValueError("existing destination is not a recognized raw UCT artifact")
        return identity(metadata), hashlib.sha256(raw).hexdigest()
    finally:
        os.close(descriptor)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", default=".")
    parser.add_argument("--agent", choices=("claude-code", "github-copilot"), required=True)
    parser.add_argument("--mode", choices=("stdout", "file"), required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    descriptors = []
    private = None
    published = False
    phase = "output preflight"
    try:
        if os.name != "posix" or not hasattr(os, "O_NOFOLLOW"):
            raise ValueError("POSIX no-follow APIs required; use a reviewed Linux/WSL environment")
        command = args.command[1:] if args.command[:1] == ["--"] else args.command
        if not command:
            raise ValueError("missing approved command argv")
        outputs = [arg for arg in command if arg.startswith("--json-output-path")]
        if outputs != ([PLACEHOLDER] if args.mode == "file" else []):
            raise ValueError("only the private output placeholder is permitted")
        root = os.path.abspath(args.project_root)
        root_fd = open_directory(root)
        descriptors.append(root_fd)
        context = (".claude" if args.agent == "claude-code" else ".github") + "/context"
        context_fd = open_directory(context, root_fd)
        descriptors.append(context_fd)
        original = raw_state(context_fd)
        temporary = ".uct-capture-" + secrets.token_hex(16)
        os.mkdir(temporary, mode=0o700, dir_fd=context_fd)
        private = context + "/" + temporary
        temporary_fd = open_directory(temporary, context_fd)
        descriptors.append(temporary_fd)
        flags = os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
        capture_fd = os.open("report.json", flags, 0o600, dir_fd=temporary_fd)
        descriptors.append(capture_fd)
        log_fd = os.open("stderr.log", flags, 0o600, dir_fd=temporary_fd)
        descriptors.append(log_fd)
        command = ["--json-output-path=" + private + "/report.json" if arg == PLACEHOLDER else arg
                   for arg in command]
        phase = "scan execution"
        result = subprocess.run(command, cwd=root, stdin=subprocess.DEVNULL,
                                stdout=capture_fd if args.mode == "stdout" else log_fd,
                                stderr=log_fd, check=False)
        if result.returncode != 0:
            print("UCT command exit status: " + str(result.returncode), file=sys.stderr)
            raise ValueError("scan command failed")
        phase = "capture validation"
        current = os.stat("report.json", dir_fd=temporary_fd, follow_symlinks=False)
        if not stat.S_ISREG(current.st_mode) or identity(current) != identity(os.fstat(capture_fd)):
            raise ValueError("capture path changed")
        raw = read_capture(capture_fd)
        if not raw:
            raise ValueError("empty UCT report")
        stage_fd = os.open("publish.json", flags, 0o600, dir_fd=temporary_fd)
        with os.fdopen(stage_fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        phase = "publication"
        current_fd = open_directory(context, root_fd)
        try:
            if identity(os.fstat(current_fd)) != identity(os.fstat(context_fd)):
                raise ValueError("context directory changed")
        finally:
            os.close(current_fd)
        if raw_state(context_fd) != original:
            raise ValueError("raw destination changed during scan")
        os.replace("publish.json", REPORT, src_dir_fd=temporary_fd, dst_dir_fd=context_fd)
        published = True
        phase = "publication durability"
        os.fsync(context_fd)
        phase = "cleanup"
        for name in ("report.json", "stderr.log"):
            os.unlink(name, dir_fd=temporary_fd)
        os.rmdir(temporary, dir_fd=context_fd)
        print(escaped({"raw": context + "/" + REPORT, "bytes": len(raw)}))
        return 0
    except (OSError, ValueError, RecursionError):
        print("UCT capture failed during " + phase + ". Stop; do not consume a previous report.",
              file=sys.stderr)
        if private and not published:
            print("Private audit capture retained for human review: " + private, file=sys.stderr)
        if published:
            print("Raw publication completed, but durability or cleanup failed; human review is required.", file=sys.stderr)
        return 1
    finally:
        for descriptor in reversed(descriptors):
            os.close(descriptor)


if __name__ == "__main__":
    sys.exit(main())
