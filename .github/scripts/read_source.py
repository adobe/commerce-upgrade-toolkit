#!/usr/bin/env python3
# Copyright 2026 Adobe. All rights reserved.
# Licensed under the Apache License, Version 2.0.
# https://www.apache.org/licenses/LICENSE-2.0
# SPDX-License-Identifier: Apache-2.0
"""Read reviewed non-secret upgrade source without executing it."""
import argparse
import os
from pathlib import Path
import stat
import sys

sys.dont_write_bytecode = True
from normalize_uct import source_file, escaped
from capture_uct import open_directory

LIMIT = 2_000_000


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file")
    parser.add_argument("--project-root", default=".")
    args = parser.parse_args()
    try:
        if os.name != "posix":
            raise ValueError("POSIX no-follow source reads required")
        root = Path(args.project_root).absolute()
        if any(path.is_symlink() for path in (root, *root.parents)):
            raise ValueError("symlink project root")
        root = root.resolve(strict=True)
        path = source_file(root, args.file)
        before = path.stat()
        root_fd = open_directory(str(root))
        try:
            parent_fd = open_directory(args.file.rpartition("/")[0], root_fd)
            try:
                descriptor = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                                     dir_fd=parent_fd)
            finally:
                os.close(parent_fd)
        finally:
            os.close(root_fd)
        with os.fdopen(descriptor, "rb") as stream:
            opened = os.fstat(stream.fileno())
            if (not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1 or opened.st_size > LIMIT
                    or (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino)):
                raise ValueError("unsafe or changed source")
            raw = stream.read(LIMIT + 1)
            after = os.fstat(stream.fileno())
            if (len(raw) > LIMIT or after.st_nlink != 1 or opened.st_size != after.st_size
                    or opened.st_mtime_ns != after.st_mtime_ns):
                raise ValueError("source changed during read")
        print(escaped({"file": args.file, "untrusted_data": raw.decode("utf-8", errors="strict")}))
        return 0
    except (ValueError, OSError, KeyError, UnicodeError):
        print("Source read blocked; request human review of non-secret source and host permissions.",
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
