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
import { buildManifest, writeManifest } from './integrity.mjs';
import path from 'path';
import { reconcileLegacyCodegraph, validateCodegraphOptions } from './codegraph-policy.mjs';
import {
  copyIfExists,
  copyDirFull,
  copyDirSplit,
  copyLegalNotices,
  upsertGitignoreBlock,
  CONTEXT_PROJECT_OWNED,
  writeInstalledVersion,
  preflightVersionMarker,
  assertToolkitComplete,
  warnPreservedPermissionProfile,
} from './sync-assets.mjs';

function applyEnvironmentState(content, installType, environment) {
  let updated = content;
  if (installType) {
    updated = updated.replace(/^installType: .*$/m, `installType: ${installType}`);
  }
  if (installType === 'fresh' && environment) {
    updated = updated.replace(/^environment: .*$/m, `environment: ${environment}`);
  }
  return updated;
}

export async function runClaudeCodeSetup({ toolRoot, projectRoot, installType, environment, ...options }) {
  validateCodegraphOptions(options);
  await assertToolkitComplete(toolRoot, 'claude-code');
  await preflightVersionMarker(projectRoot, 'claude-code');
  await warnPreservedPermissionProfile(toolRoot, projectRoot, 'claude-code');
  reconcileLegacyCodegraph(projectRoot, options);
  const clauDir = path.join(projectRoot, '.claude');
  await fs.ensureDir(clauDir);

  const copied = [];

  copied.push(...await copyLegalNotices(toolRoot, projectRoot, 'claude-code'));

  copied.push(...await copyDirFull(
    path.join(toolRoot, '.claude', 'commands'),
    path.join(clauDir, 'commands'),
    '.claude/commands/'
  ));

  copied.push(...await copyDirFull(
    path.join(toolRoot, '.claude', 'agents'),
    path.join(clauDir, 'agents'),
    '.claude/agents/'
  ));

  copied.push(...await copyDirFull(
    path.join(toolRoot, '.claude', 'skills'),
    path.join(clauDir, 'skills'),
    '.claude/skills/'
  ));

  copied.push(...await copyDirFull(
    path.join(toolRoot, '.claude', 'guardrails'),
    path.join(clauDir, 'guardrails'),
    '.claude/guardrails/'
  ));

  copied.push(...await copyDirFull(
    path.join(toolRoot, '.claude', 'prompts'),
    path.join(clauDir, 'prompts'),
    '.claude/prompts/'
  ));

  copied.push(...await copyDirFull(
    path.join(toolRoot, '.claude', 'hooks'),
    path.join(clauDir, 'hooks'),
    '.claude/hooks/'
  ));

  copied.push(...await copyDirFull(
    path.join(toolRoot, '.claude', 'scripts'),
    path.join(clauDir, 'scripts'),
    '.claude/scripts/'
  ));

  copied.push(...await copyDirSplit(
    path.join(toolRoot, '.claude', 'context'),
    path.join(clauDir, 'context'),
    '.claude/context/',
    CONTEXT_PROJECT_OWNED
  ));

  // --- Seed upgrade-state.md's installType/environment from wizard answers ---
  // (captured upfront — before any Claude Code session — so /upgrade-hop's
  // Phase -1 can skip live detection and go straight to bootstrap-or-proceed)
  if (installType) {
    const upgradeStatePath = path.join(clauDir, 'context', 'upgrade-state.md');
    if (await fs.pathExists(upgradeStatePath)) {
      const original = await fs.readFile(upgradeStatePath, 'utf8');
      await fs.writeFile(upgradeStatePath, applyEnvironmentState(original, installType, environment));
      console.log(`  ℹ️  upgrade-state.md seeded: installType=${installType}${installType === 'fresh' && environment ? `, environment=${environment}` : ''}`);
    }
  }

  // --- settings.json (no-overwrite — developer may have local customisation) ---
  const settingsSrc = path.join(toolRoot, '.claude', 'settings.json');
  const settingsDest = path.join(clauDir, 'settings.json');
  if (!await fs.pathExists(settingsDest)) {
    if (await copyIfExists(settingsSrc, settingsDest)) copied.push('.claude/settings.json');
  } else {
    console.log('  ℹ️  .claude/settings.json already exists — skipped (keeping existing).');
  }

  // --- CLAUDE.md (no-overwrite) ---
  const claudeMdSrc = path.join(toolRoot, 'CLAUDE.md');
  const claudeMdDest = path.join(projectRoot, 'CLAUDE.md');
  if (!await fs.pathExists(claudeMdDest)) {
    if (await copyIfExists(claudeMdSrc, claudeMdDest)) copied.push('CLAUDE.md');
  } else {
    console.log('  ℹ️  CLAUDE.md already exists — skipped (keeping existing).');
  }

  // --- docs/ ---
  await fs.ensureDir(path.join(projectRoot, 'docs'));
  // Report destinations the documentation agent writes to; it cannot create parent directories.
  await fs.ensureDir(path.join(clauDir, 'reports'));
  await fs.ensureDir(path.join(projectRoot, 'output'));
  if (await copyIfExists(
    path.join(toolRoot, 'docs', 'upgrade-workflow.md'),
    path.join(projectRoot, 'docs', 'upgrade-workflow.md')
  )) copied.push('docs/upgrade-workflow.md');

  // --- .gitignore ---
  const gitignorePath = path.join(projectRoot, '.gitignore');
  let gitignore = await fs.pathExists(gitignorePath)
    ? await fs.readFile(gitignorePath, 'utf8')
    : '';

  const blockStart = '# --- Adobe Commerce Upgrade Toolkit ---';
  const blockEnd = '# --- End Adobe Commerce Upgrade Toolkit ---';
  const blockBody = [
    '.claude/quality-log.jsonl',
    '/.claude/context/.uct-capture-*/',
    '/.github/context/.uct-capture-*/',
    '/.ccua-reconcile-*/',
    '/.vscode/.ccua-reconcile-*/',
    '/.claude/.ccua-reconcile-*/',
    '/.ccua/'
  ].join('\n');

  await fs.writeFile(gitignorePath, upsertGitignoreBlock(gitignore, blockStart, blockEnd, blockBody));
  copied.push('.gitignore (updated)');

  // --- Version marker ---
  const { version: toolkitVersion } = await fs.readJson(path.join(toolRoot, 'package.json'));
  await writeManifest(projectRoot, await buildManifest(toolRoot, 'claude-code'));
  await writeInstalledVersion(projectRoot, toolkitVersion, 'claude-code');

  // --- Summary ---
  console.log('\n✅ Adobe Commerce Upgrade Toolkit (Claude Code) setup complete');
  console.log(`\n   Project:  ${projectRoot}`);
  if (copied.length) {
    console.log('\n   Copied assets:');
    copied.forEach((item) => console.log(`     - ${item}`));
  }
  console.log('\n   Next steps:');
  console.log('     1. Open the project in your terminal and run: claude');
  console.log('     2. Type /upgrade-hop to detect your environment and generate a hop roadmap.');
  console.log('     3. Type /upgrade-hop <version> to scan and analyse the first hop.');
  console.log('     4. Type /upgrade-hop-execute <version> to implement fixes for that hop.');
  console.log('     5. Type /upgrade-deploy-prep once all hops are complete.');
  console.log('     6. Optional: type /upgrade-assess <version> for a read-only upgrade assessment report.');
  console.log('     7. See docs/upgrade-workflow.md for the full upgrade workflow diagram.');

  return { projectRoot, agent: 'claude-code', copied };
}
