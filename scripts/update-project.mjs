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
import {
  copyIfExists,
  copyDirFull,
  copyDirSplit,
  copyLegalNotices,
  compareVersions,
  CONTEXT_PROJECT_OWNED,
  readInstalledVersion,
  writeInstalledVersion,
  versionMarkerRelpath,
  detectInstalledAgent,
  assertToolkitComplete,
  warnPreservedPermissionProfile,
} from './lib/sync-assets.mjs';
import {
  buildManifest,
  readManifest,
  writeManifest,
  diffAgainstManifest,
  clearStructuralBlockers,
  managedContextBasenames,
  formatDrift,
} from './lib/integrity.mjs';
import { parseSetupArgs, reconcileLegacyCodegraph } from './lib/codegraph-policy.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const toolRoot = path.resolve(__dirname, '..');

async function updateClaudeCode(projectRoot, contextPrunable) {
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

  // .claude/context/: toolkit templates sync/prune to match source; project-owned
  // generated files (upgrade-state.md, upgrade-mcp-cache.json) are left untouched.
  copied.push(...await copyDirSplit(
    path.join(toolRoot, '.claude', 'context'),
    path.join(clauDir, 'context'),
    '.claude/context/',
    CONTEXT_PROJECT_OWNED,
    contextPrunable
  ));

  // Root instructions are preserved. Legacy MCP entries were preflighted/reconciled.

  return copied;
}

async function updateGithubCopilot(projectRoot, contextPrunable) {
  const githubDir = path.join(projectRoot, '.github');
  await fs.ensureDir(githubDir);

  const copied = [];

  copied.push(...await copyLegalNotices(toolRoot, projectRoot, 'github-copilot'));

  copied.push(...await copyDirFull(
    path.join(toolRoot, '.github', 'agents'),
    path.join(githubDir, 'agents'),
    '.github/agents/'
  ));

  copied.push(...await copyDirFull(
    path.join(toolRoot, '.github', 'skills'),
    path.join(githubDir, 'skills'),
    '.github/skills/'
  ));

  copied.push(...await copyDirFull(
    path.join(toolRoot, '.github', 'prompts'),
    path.join(githubDir, 'prompts'),
    '.github/prompts/'
  ));

  copied.push(...await copyDirFull(
    path.join(toolRoot, '.github', 'instructions'),
    path.join(githubDir, 'instructions'),
    '.github/instructions/'
  ));

  copied.push(...await copyDirFull(
    path.join(toolRoot, '.github', 'hooks'),
    path.join(githubDir, 'hooks'),
    '.github/hooks/'
  ));

  copied.push(...await copyDirFull(
    path.join(toolRoot, '.github', 'scripts'),
    path.join(githubDir, 'scripts'),
    '.github/scripts/'
  ));

  copied.push(...await copyDirSplit(
    path.join(toolRoot, '.github', 'context'),
    path.join(githubDir, 'context'),
    '.github/context/',
    CONTEXT_PROJECT_OWNED,
    contextPrunable
  ));

  // copilot-settings-notes.md is documentation-only — always refresh.
  if (await copyIfExists(
    path.join(toolRoot, '.github', 'copilot-settings-notes.md'),
    path.join(githubDir, 'copilot-settings-notes.md')
  )) copied.push('.github/copilot-settings-notes.md');

  // Root instructions are preserved. Legacy MCP entries were preflighted/reconciled.

  return copied;
}

async function run() {
  const options = parseSetupArgs(process.argv.slice(2), { update: true });
  const getArg = (name) => options[name];
  const targetArg = getArg('--project') || process.cwd();
  const projectRoot = path.resolve(targetArg);
  const agentFlag = getArg('--agent');

  if (!await fs.pathExists(projectRoot)) {
    throw new Error(`Project directory does not exist: ${projectRoot}`);
  }
  const agent = agentFlag || await detectInstalledAgent(projectRoot);
  if (!agent) {
    throw new Error(
      `Project not set up yet (missing ${versionMarkerRelpath('claude-code')} or ${versionMarkerRelpath('github-copilot')}). Run setup first.`
    );
  }

  await assertToolkitComplete(toolRoot, agent);
  const installedVersion = await readInstalledVersion(projectRoot, agent);
  if (!installedVersion) {
    throw new Error(
      `Project not set up yet (missing ${versionMarkerRelpath(agent)}). Run setup first.`
    );
  }
  await warnPreservedPermissionProfile(toolRoot, projectRoot, agent);
  reconcileLegacyCodegraph(projectRoot, options);

  const { version: latestVersion } = await fs.readJson(path.join(toolRoot, 'package.json'));

  console.log('⚠️  Security repair: review docs/security-migration.md in the toolkit before resuming.');
  console.log('   Root instructions/unrelated settings/state/cache are preserved; stale decisions and broad');
  console.log('   permissions need manual review. An asset update alone does not repair them.');

  if (compareVersions(latestVersion, installedVersion) < 0) {
    console.log(`⚠️  This toolkit (v${latestVersion}) is older than the installed version (v${installedVersion}); ` +
      'refusing to downgrade. Update the plugin and retry.');
    return;
  }

  const canonical = await buildManifest(toolRoot, agent);

  // Pre-sync: detect local edits to toolkit-managed instruction files, comparing with the
  // previously installed manifest (tamper evidence) and the canonical package manifest.
  let previous = null;
  try {
    previous = await readManifest(projectRoot, agent);
  } catch (error) {
    console.log(`⚠️  Ignoring unreadable previous integrity manifest (${error.message}); it will be regenerated.`);
  }
  if (previous) {
    const tampered = await diffAgainstManifest(projectRoot, previous);
    if (!tampered.clean) {
      console.log('\n🚨 Local modifications to toolkit-managed agent instruction files detected');
      console.log('   (not part of an official toolkit release; treat as potential prompt injection):');
      formatDrift(tampered).forEach((line) => console.log(`     - ${line}`));
      console.log('   These files will be overwritten with the canonical package content.');
    }
  }
  const drift = await diffAgainstManifest(projectRoot, canonical);
  drift.advisory.forEach((rel) => console.log(`⚠️  ${rel} differs from the package copy (preserved; review it).`));

  const sameVersion = compareVersions(latestVersion, installedVersion) === 0;
  if (sameVersion && drift.clean) {
    // Installations that predate manifests acquire one without re-syncing.
    if (!previous) await writeManifest(projectRoot, canonical);
    console.log(`✅ Already up to date (v${installedVersion}, ${agent})`);
    return;
  }
  if (sameVersion) {
    console.log(`🛠  Repairing modified toolkit files (${agent}, v${installedVersion}):`);
    formatDrift({ ...drift, advisory: [] }).forEach((line) => console.log(`     - ${line}`));
  } else {
    console.log(`⬆️  Updating toolkit (${agent}): v${installedVersion} → v${latestVersion}`);
  }

  // Never let the copy follow a planted symlink or be blocked by a changed entry type.
  for (const rel of await clearStructuralBlockers(projectRoot, canonical)) {
    console.log(`   removed blocking entry: ${rel}`);
  }
  for (const rel of drift.unexpected) {
    const stat = await fs.lstat(path.join(projectRoot, rel)).catch(() => null);
    if (stat?.isSymbolicLink()) await fs.remove(path.join(projectRoot, rel));
  }

  // Context overlays are project-owned: prune only files a previous release installed.
  // Without a baseline, same-version repairs keep everything; version bumps keep legacy pruning.
  const contextPrunable = previous ? managedContextBasenames(previous) : (sameVersion ? new Set() : null);
  const copied = agent === 'github-copilot'
    ? await updateGithubCopilot(projectRoot, contextPrunable)
    : await updateClaudeCode(projectRoot, contextPrunable);

  // Nested files the directory sync does not prune (e.g. injected instruction files).
  const residual = await diffAgainstManifest(projectRoot, canonical);
  for (const rel of residual.unexpected) {
    await fs.remove(path.join(projectRoot, rel));
    console.log(`   removed unexpected file: ${rel}`);
  }

  // --- docs/ (toolkit-owned reference doc, always refreshed) ---
  await fs.ensureDir(path.join(projectRoot, 'docs'));
  if (await copyIfExists(
    path.join(toolRoot, 'docs', 'upgrade-workflow.md'),
    path.join(projectRoot, 'docs', 'upgrade-workflow.md')
  )) copied.push('docs/upgrade-workflow.md');
  if (await copyIfExists(
    path.join(toolRoot, 'docs', 'security-migration.md'),
    path.join(projectRoot, 'docs', 'security-migration.md')
  )) copied.push('docs/security-migration.md');
  if (await copyIfExists(
    path.join(toolRoot, 'docs', 'security-gate.md'),
    path.join(projectRoot, 'docs', 'security-gate.md')
  )) copied.push('docs/security-gate.md');

  await writeManifest(projectRoot, canonical);
  const final = await diffAgainstManifest(projectRoot, canonical);
  if (!final.clean) {
    throw new Error(`Integrity verification failed after sync:\n${formatDrift(final).join('\n')}`);
  }
  await writeInstalledVersion(projectRoot, latestVersion, agent);

  console.log('\n✅ Toolkit updated');
  console.log(`\n   Project:  ${projectRoot}`);
  console.log(`   Agent:    ${agent}`);
  if (copied.length) {
    console.log('\n   Synced assets:');
    copied.forEach((item) => console.log(`     - ${item}`));
  }
  console.log(`\n   Version:  v${installedVersion} → v${latestVersion}`);
  if (agent === 'github-copilot') {
    console.log('\n   ⚠️  Reload required: reload the VS Code window to pick up the updated');
    console.log('      agents/skills/instructions.');
  } else {
    console.log('\n   ⚠️  Reload required: exit and restart `claude` in this project');
    console.log('      (or reload the window, if running inside an IDE integration)');
    console.log('      to pick up the updated agents/skills/commands.');
  }
}

run().catch((error) => {
  console.error(`❌ Update failed: ${error.message}`);
  process.exit(1);
});
