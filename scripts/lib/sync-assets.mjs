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
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { openAnchoredDirectory } from './anchored-fs.mjs';

export async function copyIfExists(from, to) {
  if (await fs.pathExists(from)) {
    await fs.copy(from, to, { overwrite: true });
    return true;
  }
  return false;
}

export async function pruneStaleFiles(destDir, keepBasenames) {
  if (!await fs.pathExists(destDir)) return;
  const entries = await fs.readdir(destDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!keepBasenames.has(entry.name)) {
      await fs.remove(path.join(destDir, entry.name));
    }
  }
}

export async function copyDirFull(sourceDir, destDir, label) {
  const copied = [];
  if (!await fs.pathExists(sourceDir)) return copied;
  if (await fs.pathExists(destDir)) {
    const sourceBasenames = new Set(await fs.readdir(sourceDir));
    await pruneStaleFiles(destDir, sourceBasenames);
  }
  await fs.copy(sourceDir, destDir, { overwrite: true });
  copied.push(label);
  return copied;
}

// Like copyDirFull, but basenames in `projectOwned` are only ever created if
// missing in destDir — never overwritten or pruned. Everything else (toolkit
// templates) is synced/pruned to match sourceDir exactly. When `prunable` (a Set of
// basenames) is given, only those stale files are pruned and all others are kept.
export async function copyDirSplit(sourceDir, destDir, label, projectOwned, prunable = null) {
  const copied = [];
  if (!await fs.pathExists(sourceDir)) return copied;
  await fs.ensureDir(destDir);

  const sourceEntries = await fs.readdir(sourceDir, { withFileTypes: true });
  const sourceBasenames = new Set(sourceEntries.map(e => e.name));

  if (await fs.pathExists(destDir)) {
    const destEntries = await fs.readdir(destDir, { withFileTypes: true });
    for (const entry of destEntries) {
      if (!entry.isFile()) continue;
      if (projectOwned.has(entry.name)) continue;
      // With `prunable`, only previously toolkit-installed files are removed; other
      // files are project overlays and are preserved.
      if (prunable && !prunable.has(entry.name)) continue;
      if (!sourceBasenames.has(entry.name)) {
        await fs.remove(path.join(destDir, entry.name));
      }
    }
  }

  for (const entry of sourceEntries) {
    if (entry.name === '.ccua-version') continue;
    const from = path.join(sourceDir, entry.name);
    const to = path.join(destDir, entry.name);
    if (projectOwned.has(entry.name)) {
      if (!await fs.pathExists(to)) {
        await fs.copy(from, to);
      }
      continue;
    }
    await fs.copy(from, to, { overwrite: true });
  }

  copied.push(label);
  return copied;
}

// Simple dotted-numeric semver compare — good enough for this toolkit's
// versioning (no pre-release/build metadata in use).
export function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function upsertGitignoreBlock(content, blockStart, blockEnd, blockBody) {
  const startIdx = content.indexOf(blockStart);
  const endIdx = content.indexOf(blockEnd);
  const normalizedBlock = `${blockStart}\n${blockBody}\n${blockEnd}\n`;

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = content.slice(0, startIdx);
    const after = content.slice(endIdx + blockEnd.length);
    return `${before}${normalizedBlock}${after}`.replace(/\n{3,}/g, '\n\n');
  }

  const separator = content.endsWith('\n') || content.length === 0 ? '' : '\n';
  return `${content}${separator}\n${normalizedBlock}`.replace(/\n{3,}/g, '\n\n');
}

// Basenames within .claude/context/ that are generated per-project and must
// never be overwritten or pruned by setup/update — only created if missing.
export const CONTEXT_PROJECT_OWNED = new Set([
  '.ccua-version',
  'upgrade-state.md',
  'upgrade-mcp-cache.json',
  '.ccua-last-notified',
  '.ccua-manifest.json',
]);

// Agent flavour -> the toolkit root dir it installs into. Each flavour's version marker
// and last-notified marker live under that flavour's own context/ dir, so a project can
// only ever have one flavour installed/detected at a time (agent-select is exclusive).
export const AGENT_BASE_DIRS = { 'claude-code': '.claude', 'github-copilot': '.github' };

export async function assertToolkitComplete(toolRoot, agent) {
  const base = AGENT_BASE_DIRS[agent];
  if (!base) throw new Error(`Unsupported agent: ${agent}`);
  const guardrails = ['untrusted-data', 'write-scope', 'encryption-safety', 'secure-code-generation'];
  const required = [
    ...guardrails.map(name => agent === 'claude-code'
      ? `${base}/guardrails/${name}.md`
      : `${base}/instructions/${name}.instructions.md`),
    ...['write-policy.json', 'review_change_plan.py', 'normalize_uct.py', 'research_url.py',
      'read_source.py', 'capture_uct.py',
      'inspect_changed_php.php', 'anchored-fs.mjs'].map(name => `${base}/scripts/${name}`),
  ];
  for (const relative of required) {
    let current = path.resolve(toolRoot);
    const parts = relative.split('/');
    for (const [index, part] of parts.entries()) {
      current = path.join(current, part);
      const stat = await fs.lstat(current).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!stat || stat.isSymbolicLink() || (index === parts.length - 1
        ? !stat.isFile() || stat.size === 0
        : !stat.isDirectory())) {
        throw new Error(`Incomplete or unsafe toolkit source: ${relative}. Restore the canonical assets and run npm run generate:github before setup/update. No project files were synced.`);
      }
    }
  }
}

export async function warnPreservedPermissionProfile(toolRoot, projectRoot, agent) {
  const instruction = agent === 'claude-code' ? 'CLAUDE.md' : '.github/copilot-instructions.md';
  const files = agent === 'claude-code' ? [instruction, '.claude/settings.json'] : [instruction];
  const preserved = [];
  for (const relative of files) {
    const target = path.join(projectRoot, relative);
    if (!await fs.pathExists(target)) continue;
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      preserved.push(relative);
      continue;
    }
    const source = await fs.readFile(path.join(toolRoot, relative));
    if (!source.equals(await fs.readFile(target))) preserved.push(relative);
  }
  if (preserved.length) {
    console.log(`⚠️  Permission profile review required: ${preserved.join(', ')} differs from the toolkit and is preserved.`);
    console.log(`   Compare with the templates in ${toolRoot} and merge the reviewed profile manually.`);
    console.log('   Older human-operated rules or broad execution grants may conflict with refreshed skills.');
    console.log('   Stop existing sessions; review docs/security-migration.md and effective host permissions before restarting.');
  }
}

export async function copyLegalNotices(toolRoot, projectRoot, agent) {
  const legalDir = path.join(AGENT_BASE_DIRS[agent], 'ccua-legal');
  const copied = [];
  for (const filename of ['LICENSE', 'COPYRIGHT']) {
    const relativePath = path.join(legalDir, filename);
    await fs.copy(path.join(toolRoot, filename), path.join(projectRoot, relativePath), { overwrite: true });
    copied.push(relativePath);
  }
  return copied;
}

export function versionMarkerRelpath(agent = 'claude-code') {
  return path.join(AGENT_BASE_DIRS[agent] ?? AGENT_BASE_DIRS['claude-code'], 'context', '.ccua-version');
}

export function lastNotifiedRelpath(agent = 'claude-code') {
  return path.join(AGENT_BASE_DIRS[agent] ?? AGENT_BASE_DIRS['claude-code'], 'context', '.ccua-last-notified');
}

// Kept for backward compatibility — always the Claude Code flavour's marker path.
export const VERSION_MARKER_RELPATH = versionMarkerRelpath('claude-code');
export const LAST_NOTIFIED_RELPATH = lastNotifiedRelpath('claude-code');

async function checkedVersionMarker(projectRoot, agent) {
  const marker = path.resolve(projectRoot, versionMarkerRelpath(agent));
  let current = path.parse(marker).root;
  for (const part of path.relative(current, marker).split(path.sep)) {
    current = path.join(current, part);
    let stat;
    try { stat = await fs.lstat(current); } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    if (stat.isSymbolicLink() || (current === marker
      ? !stat.isFile() || stat.nlink !== 1 || stat.size > 100
      : !stat.isDirectory())) {
      throw new Error(`Unsafe toolkit version marker path: ${current}`);
    }
  }
  return marker;
}

// Which agent flavour (if any) is currently installed in a project — used by
// update-project.mjs to detect which tree to sync without requiring --agent.
export async function detectInstalledAgent(projectRoot) {
  for (const agent of Object.keys(AGENT_BASE_DIRS)) {
    if (await checkedVersionMarker(projectRoot, agent)) return agent;
  }
  return null;
}

export async function readInstalledVersion(projectRoot, agent = 'claude-code') {
  const p = await checkedVersionMarker(projectRoot, agent);
  if (!p) return null;
  if (!constants.O_NOFOLLOW || !constants.O_NONBLOCK) throw new Error('POSIX no-follow marker reads required.');
  const directory = openAnchoredDirectory(path.dirname(p));
  let handle;
  let version;
  try {
    directory.assertAttached();
    handle = await open(directory.entry(path.basename(p)),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > 100) {
      throw new Error(`Unsafe toolkit version marker path: ${p}`);
    }
    const buffer = Buffer.alloc(101);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await handle.stat();
    if (length > 100 || length !== before.size || after.size !== before.size ||
        after.nlink !== 1 || after.mtimeMs !== before.mtimeMs) {
      throw new Error(`Unsafe toolkit version marker path: ${p}`);
    }
    version = buffer.subarray(0, length).toString('utf8').trim();
    directory.assertAttached();
  } finally {
    try { if (handle) await handle.close(); } finally { directory.close(); }
  }
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) {
    throw new Error('Invalid toolkit version marker; repair before updating.');
  }
  return version;
}

export async function preflightVersionMarker(projectRoot, agent = 'claude-code') {
  if (!Object.hasOwn(AGENT_BASE_DIRS, agent) || !constants.O_NOFOLLOW || !constants.O_DIRECTORY) {
    throw new Error('Supported agent and POSIX no-follow/directory durability APIs required.');
  }
  return readInstalledVersion(projectRoot, agent);
}

export async function writeInstalledVersion(projectRoot, version, agent = 'claude-code') {
  if (typeof version !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) {
    throw new Error('Invalid toolkit version for marker publication.');
  }
  await preflightVersionMarker(projectRoot, agent);
  const p = path.resolve(projectRoot, versionMarkerRelpath(agent));
  const directory = openAnchoredDirectory(path.dirname(p), { create: true, createRoot: projectRoot });
  const temporary = `.ccua-version-${randomUUID()}`;
  let created = false;
  let failure;
  try {
    directory.assertAttached();
    await preflightVersionMarker(projectRoot, agent);
    const handle = await open(directory.entry(temporary),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    created = true;
    try {
      await handle.writeFile(`${version}\n`, 'utf8');
      await handle.sync();
    } finally { await handle.close(); }
    await preflightVersionMarker(projectRoot, agent);
    directory.assertAttached();
    await fs.rename(directory.entry(temporary), directory.entry(path.basename(p)));
    directory.sync();
    try { directory.assertAttached(); } catch (error) {
      throw new Error('Marker published to held directory; attachment changed; verify state before retry.',
        { cause: error });
    }
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    const errors = [];
    if (created) {
      try { await fs.unlink(directory.entry(temporary)); } catch (error) {
        if (error.code !== 'ENOENT') errors.push(error);
      }
    }
    try { directory.close(); } catch (error) { errors.push(error); }
    if (errors.length) {
      throw new AggregateError(failure ? [failure, ...errors] : errors,
        'Marker publication or cleanup failed; review required.');
    }
  }
}

export async function readLastNotifiedVersion(projectRoot, agent = 'claude-code') {
  const p = path.join(projectRoot, lastNotifiedRelpath(agent));
  if (!await fs.pathExists(p)) return null;
  return (await fs.readFile(p, 'utf8')).trim();
}

export async function writeLastNotifiedVersion(projectRoot, version, agent = 'claude-code') {
  const p = path.join(projectRoot, lastNotifiedRelpath(agent));
  await fs.ensureDir(path.dirname(p));
  await fs.writeFile(p, `${version}\n`);
}
