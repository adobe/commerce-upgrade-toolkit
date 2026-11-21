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

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { runClaudeCodeSetup } from './lib/setup-claude.mjs';
import { runGithubCopilotSetup } from './lib/setup-github.mjs';
import { parseSetupArgs } from './lib/codegraph-policy.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const toolRoot = path.resolve(__dirname, '..');

async function run() {
  const options = parseSetupArgs(process.argv.slice(2));
  const getArg = (name) => options[name];
  const targetArg = getArg('--project') || process.cwd();
  const projectRoot = path.resolve(targetArg);
  const installType = getArg('--install-type');
  const environment = getArg('--environment');
  const agent = getArg('--agent') || 'claude-code';

  if (!await fs.pathExists(projectRoot)) {
    throw new Error(`Project directory does not exist: ${projectRoot}`);
  }

  const composerPath = path.join(projectRoot, 'composer.json');
  if (!await fs.pathExists(composerPath)) {
    console.warn(`⚠️  composer.json not found at ${projectRoot}. Continuing anyway.`);
  }

  const setupFn = agent === 'github-copilot' ? runGithubCopilotSetup : runClaudeCodeSetup;
  await setupFn({ toolRoot, projectRoot, installType, environment,
    enableCodegraph: options.enableCodegraph, skipCodegraph: options.skipCodegraph });

  await fs.ensureDir(path.join(projectRoot, 'docs'));
  await fs.copy(
    path.join(toolRoot, 'docs', 'security-migration.md'),
    path.join(projectRoot, 'docs', 'security-migration.md')
  );
  await fs.copy(
    path.join(toolRoot, 'docs', 'security-gate.md'),
    path.join(projectRoot, 'docs', 'security-gate.md')
  );
  console.log('   Security boundaries/repair: docs/security-migration.md (review before upgrades)');
}

run().catch((error) => {
  console.error(`❌ Setup failed: ${error.message}`);
  process.exit(1);
});
