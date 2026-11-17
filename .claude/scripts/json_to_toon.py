#!/usr/bin/env python3
# Copyright 2026 Adobe. All rights reserved.
# This file is licensed to you under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License. You may obtain a copy
# of the License at http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software distributed under
# the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
# OF ANY KIND, either express or implied. See the License for the specific language
# governing permissions and limitations under the License.
# SPDX-License-Identifier: Apache-2.0
"""Convert a JSON file to TOON (Token-Oriented Object Notation) for cheaper LLM context reads.

TOON is a lossless re-serialization of the JSON data model: indentation instead of
braces, and a declare-once field header + CSV-style rows for arrays of uniform
objects (the shape of UCT's `issues` array). Stdlib only, no external dependency.

The header field list is the union of keys seen across all rows (not a hardcoded
schema), so rows missing an occasional field (e.g. UCT's optional `issueType`) just
get an empty cell rather than breaking the table.

Usage: python3 json_to_toon.py <input.json> <output.toon>
"""
import csv
import io
import json
import sys


def _scalar(value):
    if value is None:
        return "~"
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _csv_row(values):
    buf = io.StringIO()
    csv.writer(buf, lineterminator="").writerow(["" if v is None else v for v in values])
    return buf.getvalue()


def _encode_table(key, rows, indent):
    pad = "  " * indent
    fields = []
    seen = set()
    for row in rows:
        for field in row.keys():
            if field not in seen:
                seen.add(field)
                fields.append(field)
    lines = [f"{pad}{key}[{len(rows)}]{{{','.join(fields)}}}:"]
    for row in rows:
        lines.append(f"{pad}  {_csv_row(row.get(field) for field in fields)}")
    return lines


def _encode_list(key, values, indent):
    pad = "  " * indent
    if values and all(isinstance(v, dict) for v in values):
        return _encode_table(key, values, indent)
    return [f"{pad}{key}[{len(values)}]: " + ",".join(_scalar(v) for v in values)]


def _encode_dict(obj, indent=0):
    pad = "  " * indent
    lines = []
    for key, value in obj.items():
        if isinstance(value, list):
            lines.extend(_encode_list(key, value, indent))
        elif isinstance(value, dict):
            lines.append(f"{pad}{key}:")
            lines.extend(_encode_dict(value, indent + 1))
        else:
            lines.append(f"{pad}{key}: {_scalar(value)}")
    return lines


def main():
    if len(sys.argv) != 3:
        print("Usage: json_to_toon.py <input.json> <output.toon>", file=sys.stderr)
        sys.exit(1)
    with open(sys.argv[1], encoding="utf-8") as f:
        data = json.load(f)
    lines = _encode_dict(data)
    with open(sys.argv[2], "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"Wrote {len(lines)} lines to {sys.argv[2]}")


if __name__ == "__main__":
    main()
