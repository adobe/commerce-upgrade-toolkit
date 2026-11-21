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

// Verifies scaffolded agent instruction files in a project against the manifest
// computed from this (installed, trusted) toolkit package. Usable as a CI step or
// agent pre-flight. Exit 0 = clean, 2 = drift detected, 1 = error.
//   node scripts/verify-integrity.mjs [--project <dir>] [--agent claude-code|github-copilot]

import path from 'path';
import { fileURLToPath } from 'url';
import { buildManifest, diffAgainstManifest, formatDrift } from './lib/integrity.mjs';
import { detectInstalledAgent } from './lib/sync-assets.mjs';

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parse(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (!['--project', '--agent'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('-')) {
      throw new Error(`Unknown flag or missing value: ${args[i]}`);
    }
    out[args[i]] = args[++i];
  }
  if (out['--agent'] && !['claude-code', 'github-copilot'].includes(out['--agent'])) {
    throw new Error('Invalid --agent value');
  }
  return out;
}

try {
  const options = parse(process.argv.slice(2));
  const projectRoot = path.resolve(options['--project'] || process.cwd());
  const agent = options['--agent'] || await detectInstalledAgent(projectRoot);
  if (!agent) throw new Error('No installed toolkit flavour detected; pass --agent.');

  const manifest = await buildManifest(toolRoot, agent);
  const drift = await diffAgainstManifest(projectRoot, manifest);
  const lines = formatDrift(drift);
  if (drift.clean) {
    console.log(`✅ Agent instruction files match toolkit v${manifest.version} (${agent})`);
    lines.forEach((line) => console.log(`   ⚠️  ${line}`));
    process.exit(0);
  }
  console.error(`❌ Agent instruction files differ from toolkit v${manifest.version} (${agent}):`);
  lines.forEach((line) => console.error(`   - ${line}`));
  console.error('   Treat unexpected changes as potential prompt injection. Review the diff, then run `aio ccua:update` from the official package to restore.');
  process.exit(2);
} catch (error) {
  console.error(`❌ Integrity check failed: ${error.message}`);
  process.exit(1);
}
