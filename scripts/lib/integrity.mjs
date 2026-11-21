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
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

export const MANIFEST_SCHEMA = 1;
export const MANIFEST_BASENAME = '.ccua-manifest.json';

// Toolkit-managed trees (synced from the package on setup/update). `context` is
// split: only toolkit templates are hashed; project-owned files are ignored.
const MANAGED = {
  'claude-code': {
    base: '.claude',
    dirs: ['commands', 'agents', 'skills', 'guardrails', 'prompts', 'hooks', 'scripts', 'context'],
    files: [],
    advisory: ['CLAUDE.md'],
  },
  'github-copilot': {
    base: '.github',
    dirs: ['agents', 'skills', 'prompts', 'instructions', 'hooks', 'scripts', 'context'],
    files: ['copilot-settings-notes.md'],
    advisory: ['.github/copilot-instructions.md'],
  },
};

const CONTEXT_IGNORED = new Set([
  '.ccua-version', 'upgrade-state.md', 'upgrade-mcp-cache.json', '.ccua-last-notified', MANIFEST_BASENAME,
]);

export const manifestRelpath = (agent) => `${MANAGED[agent].base}/context/${MANIFEST_BASENAME}`;

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

function isIgnored(agent, rel) {
  const ctx = `${MANAGED[agent].base}/context/`;
  if (!rel.startsWith(ctx)) return false;
  const first = rel.slice(ctx.length).split('/')[0];
  return CONTEXT_IGNORED.has(first) || first.startsWith('.uct-capture-');
}

// Returns { rel -> sha256 | 'symlink' | 'special' } for every non-ignored entry under a managed path.
async function walk(root, agent, relDir, out) {
  const abs = path.join(root, relDir);
  let entries;
  try { entries = await fs.readdir(abs, { withFileTypes: true }); } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return;
    throw e;
  }
  for (const entry of entries) {
    const rel = `${relDir}/${entry.name}`;
    if (isIgnored(agent, rel)) continue;
    if (entry.isSymbolicLink()) out[rel] = 'symlink';
    else if (entry.isDirectory()) await walk(root, agent, rel, out);
    else if (entry.isFile()) out[rel] = sha256(await fs.readFile(path.join(root, rel)));
    else out[rel] = 'special';
  }
}

async function hashTree(root, agent) {
  const spec = MANAGED[agent];
  const files = {};
  for (const dir of spec.dirs) await walk(root, agent, `${spec.base}/${dir}`, files);
  for (const file of spec.files) {
    const rel = `${spec.base}/${file}`;
    const stat = await fs.lstat(path.join(root, rel)).catch(() => null);
    if (!stat) continue;
    files[rel] = stat.isFile() ? sha256(await fs.readFile(path.join(root, rel))) : 'special';
  }
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)));
}

async function hashAdvisory(root, agent) {
  const out = {};
  for (const rel of MANAGED[agent].advisory) {
    const stat = await fs.lstat(path.join(root, rel)).catch(() => null);
    if (stat) out[rel] = stat.isFile() ? sha256(await fs.readFile(path.join(root, rel))) : 'special';
  }
  return out;
}

// Canonical manifest: computed from the (trusted) toolkit package tree.
export async function buildManifest(toolRoot, agent) {
  const { version } = await fs.readJson(path.join(toolRoot, 'package.json'));
  return {
    schema: MANIFEST_SCHEMA,
    agent,
    version,
    files: await hashTree(toolRoot, agent),
    advisory: await hashAdvisory(toolRoot, agent),
  };
}

export async function readManifest(projectRoot, agent) {
  const file = path.join(projectRoot, manifestRelpath(agent));
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat) return null;
  if (!stat.isFile()) throw new Error(`Unsafe integrity manifest path: ${manifestRelpath(agent)}`);
  const manifest = await fs.readJson(file);
  if (manifest?.schema !== MANIFEST_SCHEMA || manifest.agent !== agent ||
      typeof manifest.files !== 'object' || manifest.files === null) {
    throw new Error(`Invalid integrity manifest: ${manifestRelpath(agent)}`);
  }
  return manifest;
}

async function assertContainedDirectories(projectRoot, relDir) {
  let current = path.resolve(projectRoot);
  for (const part of relDir.split('/')) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch((e) => {
      if (e.code === 'ENOENT') return null;
      throw e;
    });
    if (!stat) return;
    if (!stat.isDirectory()) throw new Error(`Unsafe integrity manifest directory: ${current}`);
  }
}

// Atomic publication: exclusive no-follow temp file in the same directory, fsync, then rename.
// rename() replaces a planted symlink entry itself and never writes through it.
export async function writeManifest(projectRoot, manifest) {
  const rel = manifestRelpath(manifest.agent);
  const dir = path.dirname(rel);
  await assertContainedDirectories(projectRoot, dir);
  const absDir = path.join(projectRoot, dir);
  await fs.ensureDir(absDir);
  await assertContainedDirectories(projectRoot, dir);
  const temporary = path.join(absDir, `${MANIFEST_BASENAME}.${randomUUID()}.tmp`);
  let created = false;
  try {
    const handle = await open(temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
    created = true;
    try {
      await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally { await handle.close(); }
    await fs.rename(temporary, path.join(projectRoot, rel));
    created = false;
  } finally {
    if (created) await fs.unlink(temporary).catch(() => {});
  }
}

// Removes entries that block restoring canonical paths: symlinks, files where a directory
// is expected, and directories where a file is expected. Returns the removed relpaths.
export async function clearStructuralBlockers(projectRoot, manifest) {
  const { base, dirs } = MANAGED[manifest.agent];
  const removed = [];
  const drop = async (rel) => {
    await fs.remove(path.join(projectRoot, rel));
    removed.push(rel);
  };
  const lstat = (rel) => fs.lstat(path.join(projectRoot, rel)).catch(() => null);

  for (const dir of dirs) {
    const stat = await lstat(`${base}/${dir}`);
    if (stat && !stat.isDirectory()) await drop(`${base}/${dir}`);
  }
  for (const rel of Object.keys(manifest.files)) {
    const parts = rel.split('/');
    for (let i = 2; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join('/');
      const stat = await lstat(ancestor);
      if (stat && !stat.isDirectory()) { await drop(ancestor); break; }
      if (!stat) break;
    }
    const stat = await lstat(rel);
    if (stat && !stat.isFile()) await drop(rel);
  }
  return removed;
}

// Compares the project's on-disk managed files with an expected manifest.
// `modified`/`missing`/`unexpected` are blocking; `advisory` (preserved root
// instruction files that users may legitimately customize) is warning-only.
export async function diffAgainstManifest(projectRoot, manifest) {
  const { agent } = manifest;
  const actual = await hashTree(projectRoot, agent);
  const modified = [];
  const missing = [];
  const unexpected = [];
  for (const [rel, hash] of Object.entries(manifest.files)) {
    if (!(rel in actual)) missing.push(rel);
    else if (actual[rel] !== hash) modified.push(rel);
  }
  for (const rel of Object.keys(actual)) {
    if (rel in manifest.files) continue;
    // Project overlays under context/ are the sanctioned customization surface.
    if (rel.startsWith(`${MANAGED[agent].base}/context/`)) continue;
    unexpected.push(rel);
  }
  const advisory = [];
  const actualAdvisory = await hashAdvisory(projectRoot, agent);
  for (const [rel, hash] of Object.entries(manifest.advisory ?? {})) {
    if (actualAdvisory[rel] !== hash) advisory.push(rel);
  }
  return {
    modified, missing, unexpected, advisory,
    clean: !modified.length && !missing.length && !unexpected.length,
  };
}

export function managedContextBasenames(manifest) {
  const prefix = `${MANAGED[manifest.agent].base}/context/`;
  return new Set(Object.keys(manifest.files)
    .filter((rel) => rel.startsWith(prefix) && !rel.slice(prefix.length).includes('/'))
    .map((rel) => rel.slice(prefix.length)));
}

export function formatDrift(drift) {
  const lines = [];
  for (const [label, list] of [['modified', drift.modified], ['missing', drift.missing],
    ['unexpected', drift.unexpected], ['root instruction file differs from package (review)', drift.advisory]]) {
    for (const rel of list) lines.push(`${label}: ${rel}`);
  }
  return lines;
}
