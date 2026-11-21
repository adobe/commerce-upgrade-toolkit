#!/usr/bin/env node
/*
Copyright 2026 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
SPDX-License-Identifier: Apache-2.0
*/
// Extracts the body of a single `## [x.y.z]` section from CHANGELOG.md.
// Used by the publish workflow to (a) fail fast if a release branch forgot to
// add a changelog entry, and (b) populate the GitHub Release notes.

import fs from 'fs';
import path from 'path';

const version = process.argv[2];
if (!version) {
  console.error('Usage: extract-changelog.mjs <version>');
  process.exit(1);
}

const changelogPath = path.resolve('CHANGELOG.md');
if (!fs.existsSync(changelogPath)) {
  console.error('CHANGELOG.md not found at repo root.');
  process.exit(1);
}

const content = fs.readFileSync(changelogPath, 'utf8');
const headingRe = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\].*$`, 'm');
const match = headingRe.exec(content);

if (!match) {
  console.error(`No "## [${version}]" section found in CHANGELOG.md.`);
  console.error(`Add one on the release branch before merging to main.`);
  process.exit(1);
}

const startIdx = match.index + match[0].length;
const rest = content.slice(startIdx);
const nextHeadingIdx = rest.search(/^## \[/m);
const body = (nextHeadingIdx === -1 ? rest : rest.slice(0, nextHeadingIdx)).trim();

if (!body) {
  console.error(`"## [${version}]" section in CHANGELOG.md is empty.`);
  process.exit(1);
}

process.stdout.write(body + '\n');
