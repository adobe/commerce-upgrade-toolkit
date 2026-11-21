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

// Heuristic, dependency-free git-diff guard for the `encryption-safety` guardrail.
//
// Usage: node .claude/scripts/check-encryption-changes.mjs [--base <ref>]
//
// Scans NEW/changed PHP, PHTML and di.xml content; env.php touches are blocked path-only
// (including deletions, without reading configuration). Never scans pre-existing untouched
// lines) across three always-checked sources — staged, working tree, and untracked files —
// plus, when --base is given, the committed diff from merge-base(<ref>, HEAD) to HEAD. Each
// source is inspected independently against its own content and its own added-line ranges,
// so an unsafe change staged but reverted in the working tree (or vice versa) is still caught.
//
// LIMITATIONS (see encryption-safety guardrail for the authoritative statement):
// - This is a static, regex-based heuristic. It is not a parser and cannot prove the absence
//   of crypto flaws, incomplete re-encryption coverage, or correct key handling.
// - It only inspects lines introduced/changed in the inspected diff — pre-existing unsafe
//   code nobody touched is deliberately out of scope (that is a separate, larger audit).
// - It intentionally does not attempt entropy-based secret detection or try to guess every
//   possible obfuscation of a forbidden call — see the guardrail for what "allowed" means.
// - Gitignored runtime files (including app/etc/env.php) are not inspected. Their safe
//   handling requires the human-reviewed native runbook, not a clean result from this check.
//
// Exit codes: 0 = clean, 1 = violations found (see stdout JSON), 2 = fail-closed (git
// unavailable, bad ref, unreadable file content, or unsupported CLI usage) — exit 2 never
// prints git stderr, file content, or secret material, only a fixed sanitized message.

import { execFileSync } from 'node:child_process';
import { constants, openSync, closeSync, fstatSync, lstatSync, readSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

class FailClosedError extends Error {}

const EXCLUDE_PATHSPECS = [':(exclude)vendor/*', ':(exclude)node_modules/*'];
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
let openAnchoredDirectory;

function phpClassImportAliases(source) {
  const aliases = new Map();
  const addImport = (item, prefix = '') => {
    const trimmed = item.trim();
    if (/^(?:function|const)\b/i.test(trimmed)) return;
    const imported = trimmed.match(/^\\?([\w\\]+)(?:\s+as\s+(\w+))?$/i);
    if (!imported) return;
    const name = imported[2] || imported[1].split('\\').pop();
    aliases.set(name.toLowerCase(), [prefix, imported[1]].filter(Boolean).join('\\'));
  };
  let depth = 0;
  let index = 0;
  while (index < source.length) {
    if (source.startsWith('//', index) || (source[index] === '#' && source[index + 1] !== '[')) {
      const newline = source.indexOf('\n', index);
      index = newline < 0 ? source.length : newline + 1;
      continue;
    }
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2);
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    if (source[index] === "'" || source[index] === '"' || source[index] === '`') {
      const quote = source[index++];
      while (index < source.length) {
        if (source[index] === '\\') index += 2;
        else if (source[index++] === quote) break;
      }
      continue;
    }
    if (source[index] === '{') depth++;
    else if (source[index] === '}') depth--;
    else if (
      depth === 0 &&
      source.slice(index, index + 3).toLowerCase() === 'use' &&
      !/[\w$]/.test(source[index - 1] || '') &&
      !/[\w$]/.test(source[index + 3] || '')
    ) {
      let statementStart = index + 3;
      while (/\s/.test(source[statementStart] || '')) statementStart++;
      if (source[statementStart] !== '(') {
        let end = statementStart;
        while (end < source.length && source[end] !== ';') end++;
        if (end === source.length) break;
        const declaration = source.slice(statementStart, end).trim();
        const group = declaration.match(/^\\?([\w\\]+)\\\s*\{([\s\S]*)\}$/);
        if (group) {
          for (const item of group[2].split(',')) addImport(item, group[1]);
        } else {
          for (const item of declaration.split(',')) addImport(item);
        }
        index = end + 1;
        continue;
      }
    }
    index++;
  }
  return aliases;
}

// --- Rules -------------------------------------------------------------------------------
// Match against full content, then check whether the match intersects changed lines.
const MULTILINE_RULES = [
  {
    id: 'ENC_DIRECT_CIPHER_CALL',
    maskNonCode: true,
    appliesTo: (file) => /\.(php|phtml)$/i.test(file),
    pattern: /\b(?:openssl_encrypt|openssl_decrypt|openssl_pbkdf2|mcrypt_encrypt|mcrypt_decrypt|hash_pbkdf2|hash_hkdf|sodium_crypto_pwhash|sodium_crypto_secretbox(?:_open)?|sodium_crypto_aead_\w+_(?:encrypt|decrypt))\s*\(/gi,
  },
  {
    id: 'ENC_PASSWORD_HASH_OVERRIDE',
    maskNonCode: true,
    appliesTo: (file) => /\.(php|phtml)$/i.test(file),
    pattern: /\b(?:password_hash|password_verify|crypt)\s*\(/gi,
  },
  {
    id: 'ENC_WEAK_PASSWORD_HASH',
    appliesTo: (file) => /\.(php|phtml)$/i.test(file),
    pattern: /(?<!->\s*)(?<!::\s*)\b(?:md5|sha1|hash|hash_hmac)\s*\(/gi,
    call: true,
    matches: (match) => {
      const identifiers = match[0].matchAll(/\$(\w+)|->\s*(\w+)/g);
      return [...identifiers].some((identifier) =>
        /password|passwd|passphrase|pwd/i.test(identifier[1] || identifier[2]) ||
        identifierComponents(identifier[1] || identifier[2]).some((part) => /^pass$/i.test(part))) ||
        /\[\s*(['"])(?:password|passwd|passphrase|pwd|pass)\1\s*\]/i.test(match[0]) ||
        /\bget(?:Password|Passphrase)\s*\(/i.test(match[0]);
    },
  },
  {
    id: 'ENC_KEY_MATERIAL_GENERATION',
    appliesTo: (file) => /\.(php|phtml)$/i.test(file),
    pattern: /(?:\$\w+\s*->\s*|\b\w+::\$|\$)(\w+)\s*=\s*[^;]*?\b(?:random_bytes|openssl_random_pseudo_bytes|random_int)\s*\(/gi,
    matches: (match) => identifierComponents(match[1])
      .some((component) => /^(?:keys?|secrets?|ivs?|nonces?|salts?|(?:encryption|crypt|master|secret|private|public|api|auth)(?:keys?|secrets?|nonces?|salts?))$/i.test(component)),
  },
  {
    id: 'ENC_ENCRYPTOR_IMPLEMENTATION',
    appliesTo: (file) => /\.(php|phtml)$/i.test(file),
    pattern: /\bclass\b(?:\s+(?!extends\b|implements\b)\w+)?[^{;]*\{/gi,
    matches: (match, content) => {
      const before = content.slice(0, match.index);
      const namespaces = [...before.matchAll(/\bnamespace\s*([\w\\]*)\s*[;{]/gi)];
      const declaration = namespaces[namespaces.length - 1];
      const namespace = declaration ? declaration[1] : '';
      const scope = declaration ? before.slice(declaration.index + declaration[0].length) : before;
      const aliases = phpClassImportAliases(scope);
      const inheritance = match[0].match(/\b(?:extends|implements)\s+([\s\S]*)\{/i);
      if (inheritance === null) return false;
      return inheritance[1].split(/[\s,]+/).some((name) => {
        let resolved;
        if (name.startsWith('\\')) {
          resolved = name.slice(1);
        } else {
          const parts = name.split('\\');
          const alias = aliases.get(parts[0].toLowerCase());
          if (parts[0].toLowerCase() === 'namespace') {
            resolved = [namespace, ...parts.slice(1)].filter(Boolean).join('\\');
          } else if (alias) {
            resolved = [alias, ...parts.slice(1)].join('\\');
          } else {
            resolved = [namespace, name].filter(Boolean).join('\\');
          }
        }
        return /^Magento\\Framework\\Encryption\\Encryptor(?:Interface)?$/i.test(resolved);
      });
    },
  },
  {
    id: 'ENC_ENCRYPTOR_DI_OVERRIDE',
    appliesTo: (file) => /(^|[/\\])di\.xml$/i.test(file),
    pattern: /<preference\b[^>]*>|<virtualType\b[^>]*>|<type\b[^>]*>[\s\S]*?<\/type>/gi,
    matches: (match) => {
      const tag = match[0];
      const opening = tag.slice(0, tag.indexOf('>') + 1);
      const lowerTag = tag.toLowerCase();
      const attribute = lowerTag.startsWith('<preference') ? 'for' : lowerTag.startsWith('<virtualtype') ? 'type' : 'name';
      const value = opening.match(new RegExp(`\\b${attribute}\\s*=\\s*(["'])([^"']*)\\1`, 'i'));
      return value !== null &&
        /^\\?Magento\\Framework\\Encryption\\Encryptor(?:Interface)?$/i.test(value[2].trim()) &&
        (!lowerTag.startsWith('<type') || /<plugin\b/i.test(tag));
    },
  },
];

function isEnvPhp(file) {
  return /(^|[/\\])env\.php$/i.test(file);
}

function identifierComponents(identifier) {
  return identifier
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .split('_');
}

function callEnd(content, opening) {
  let depth = 0;
  let quote = null;
  let comment = null;
  let started = false;
  let inPhp = false;
  for (let index = 0; index < content.length; index++) {
    if (!inPhp) {
      if (index === opening) return null;
      const tag = content.slice(index, index + 6).match(/^<\?(?:php\b|=|(?=\s))/i);
      if (tag) { inPhp = true; index += tag[0].length - 1; }
      continue;
    }
    if (index === opening) {
      if (quote || comment) return null;
      started = true;
    }
    const char = content[index];
    const next = content[index + 1];
    if (!quote && comment !== 'block' && char === '?' && next === '>') {
      if (started) throw new FailClosedError('Unable to inspect an incomplete hashing call.');
      inPhp = false;
      comment = null;
      index++;
      continue;
    }
    if (quote) {
      if (char === '\\') index++;
      else if (char === quote) quote = null;
      continue;
    }
    if (comment === 'line') {
      if (char === '\n') comment = null;
      continue;
    }
    if (comment === 'block') {
      if (char === '*' && next === '/') { comment = null; index++; }
      continue;
    }
    if (char === '/' && next === '*') { comment = 'block'; index++; }
    else if ((char === '/' && next === '/') || char === '#') comment = 'line';
    else if (char === '"' || char === "'") quote = char;
    else if (started && char === '(') depth++;
    else if (started && char === ')' && --depth === 0) return index + 1;
  }
  throw new FailClosedError('Unable to inspect an incomplete hashing call.');
}

// --- Fail-closed git wrapper ---------------------------------------------------------------

// Every git invocation goes through this one wrapper. stdio is pinned explicitly
// (stdin ignored, stdout/stderr piped-and-captured-only) so a failing git command can
// never leak its stderr (paths, ref names, raw diffs) to this process's own stderr —
// only the fixed, sanitized failMessage below is ever surfaced to the caller.
function git(args, cwd, failMessage) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new FailClosedError(failMessage || 'git command failed.');
  }
}

function resolveRepoRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new FailClosedError('Not a git repository, or git is unavailable.');
  }
}

// --- Diff / content collection -------------------------------------------------------------

function parseNameStatus(raw) {
  const tokens = raw.split('\0').filter((t) => t.length > 0);
  const entries = [];
  let i = 0;
  while (i < tokens.length) {
    const status = tokens[i];
    i++;
    if (status.startsWith('R') || status.startsWith('C')) {
      const oldPath = tokens[i]; i++;
      const newPath = tokens[i]; i++;
      entries.push(status.startsWith('R') ?
        { status: 'R', path: newPath, oldPath } :
        { status: 'A', path: newPath, oldPath });
    } else {
      const path = tokens[i]; i++;
      entries.push({ status, path });
    }
  }
  return entries;
}

function relevantFile(path) {
  return /\.(php|phtml)$/i.test(path) || /(^|[/\\])di\.xml$/i.test(path) || /(^|[/\\])env\.php$/i.test(path);
}

function parseAddedRanges(diffText) {
  const added = new Set();
  const hunkRe = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;
  let m;
  while ((m = hunkRe.exec(diffText)) !== null) {
    const newStart = parseInt(m[1], 10);
    const newLines = m[2] !== undefined ? parseInt(m[2], 10) : 1;
    for (let l = newStart; l < newStart + newLines; l++) added.add(l);
  }
  return added;
}

function allLinesAdded(content) {
  const added = new Set();
  const count = content.length === 0 ? 0 : content.split('\n').length;
  for (let l = 1; l <= count; l++) added.add(l);
  return added;
}

function lineRangeOfIndex(content, start, length) {
  const before = content.slice(0, start);
  const startLine = (before.match(/\n/g) || []).length + 1;
  const within = content.slice(start, start + length);
  const endLine = startLine + (within.match(/\n/g) || []).length;
  return [startLine, endLine];
}

// Blank out PHP comments, string literals and non-PHP regions (newlines kept) so offsets and
// line numbers are unchanged but names inside them cannot trigger call-pattern rules.
function maskNonCode(content) {
  const out = content.split('');
  const blank = (from, to) => {
    for (let i = from; i < to && i < out.length; i++) if (out[i] !== '\n') out[i] = ' ';
  };
  let index = 0;
  let inPhp = false;
  while (index < content.length) {
    if (!inPhp) {
      const open = content.slice(index).search(/<\?(?:php\b|=|(?=\s))/i);
      const stop = open < 0 ? content.length : index + open;
      blank(index, stop);
      if (open < 0) break;
      const tag = content.slice(stop).match(/^<\?(?:php\b|=)?/i)[0];
      index = stop + tag.length;
      inPhp = true;
      continue;
    }
    const char = content[index];
    const next = content[index + 1];
    if (char === '?' && next === '>') { inPhp = false; index += 2; continue; }
    if (char === '/' && next === '*') {
      const end = content.indexOf('*/', index + 2);
      const stop = end < 0 ? content.length : end + 2;
      blank(index, stop);
      index = stop;
    } else if ((char === '/' && next === '/') || (char === '#' && next !== '[')) {
      let stop = index;
      while (stop < content.length && content[stop] !== '\n' &&
        !(content[stop] === '?' && content[stop + 1] === '>')) stop++;
      blank(index, stop);
      index = stop;
    } else if (char === '"' || char === "'") {
      let stop = index + 1;
      while (stop < content.length && content[stop] !== char) stop += content[stop] === '\\' ? 2 : 1;
      blank(index + 1, stop);
      index = stop + 1;
    } else {
      index++;
    }
  }
  return out.join('');
}

function scanContent(path, content, addedLines, source, violations) {
  if (addedLines.size === 0) return;
  for (const rule of MULTILINE_RULES) {
    if (!rule.appliesTo(path)) continue;
    rule.pattern.lastIndex = 0;
    const haystack = rule.maskNonCode ? maskNonCode(content) : content;
    let m;
    while ((m = rule.pattern.exec(haystack)) !== null) {
      if (rule.call) {
        const end = callEnd(content, m.index + m[0].length - 1);
        if (end === null) continue;
        m[0] = content.slice(m.index, end);
      }
      if (rule.matches && !rule.matches(m, content)) continue;
      const [startLine, endLine] = lineRangeOfIndex(content, m.index, m[0].length);
      let touchesAdded = false;
      for (let l = startLine; l <= endLine; l++) {
        if (addedLines.has(l)) { touchesAdded = true; break; }
      }
      if (touchesAdded) {
        violations.push({ rule: rule.id, file: path, line: startLine, source });
      }
      if (rule.pattern.lastIndex === m.index) rule.pattern.lastIndex++; // guard against zero-length loops
    }
  }

}

function readGitBlob(repoRoot, revision, path) {
  const literal = `:(literal)${path}`;
  const listing = git(revision === null ?
    ['ls-files', '--stage', '-z', '--', literal] :
    ['ls-tree', '-z', revision, '--', literal],
  repoRoot, 'Unable to inspect source file metadata.');
  const entry = listing.split('\0').find((item) => item.slice(item.indexOf('\t') + 1) === path);
  if (!entry || !/^100(?:644|755) /.test(entry)) {
    throw new FailClosedError('Source files must be regular files, not symlinks.');
  }
  return git(['show', revision === null ? `:${path}` : `${revision}:${path}`],
    repoRoot, 'Unable to read file content for scanning.');
}

function readWorkingFile(repoRoot, path) {
  let directory;
  let descriptor;
  try {
    if (path.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new FailClosedError('Invalid source path.');
    }
    directory = openAnchoredDirectory(dirname(join(repoRoot, path)));
    directory.assertAttached();
    const entry = directory.entry(basename(path));
    descriptor = openSync(entry, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(MAX_SOURCE_BYTES)) {
      throw new FailClosedError('Unsafe or oversized source file.');
    }
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, length);
      if (!count) break;
      length += count;
    }
    const after = fstatSync(descriptor, { bigint: true });
    const current = lstatSync(entry, { bigint: true });
    if (BigInt(length) !== before.size || after.size !== before.size ||
        after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs ||
        after.nlink !== 1n || !current.isFile() ||
        current.dev !== before.dev || current.ino !== before.ino) {
      throw new FailClosedError('Source changed during scanning.');
    }
    directory.assertAttached();
    return buffer.subarray(0, length).toString('utf8');
  } catch {
    throw new FailClosedError('Unable to safely read source. Linux procfs and stable regular, single-link paths are required.');
  } finally {
    try { if (descriptor !== undefined) closeSync(descriptor); } finally {
      if (directory) directory.close();
    }
  }
}

function rejectUnmergedSources(repoRoot) {
  const raw = git(['ls-files', '--unmerged', '-z', '--', '.', ...EXCLUDE_PATHSPECS],
    repoRoot, 'Unable to inspect unmerged files.');
  for (const entry of raw.split('\0').filter(Boolean)) {
    const separator = entry.indexOf('\t');
    if (separator < 0 || relevantFile(entry.slice(separator + 1))) {
      throw new FailClosedError('Resolve unmerged source files before running the encryption check.');
    }
  }
}

function scanDiffSource(repoRoot, nameStatusArgs, diffArgs, contentFn, source, violations) {
  const nameStatusRaw = git(
    ['diff', '--find-renames', '--no-color', '--no-ext-diff', '--no-textconv', '--name-status', '-z', ...nameStatusArgs, '--', '.', ...EXCLUDE_PATHSPECS],
    repoRoot,
    'Unable to enumerate changed files.'
  );
  const entries = parseNameStatus(nameStatusRaw);

  for (const entry of entries) {
    if (entry.status === 'U' && relevantFile(entry.path)) {
      throw new FailClosedError('Resolve unmerged source files before running the encryption check.');
    }
    const envPath = [entry.path, entry.oldPath].find((path) => path && isEnvPhp(path));
    if (envPath) {
      violations.push({ rule: 'ENC_ENV_CRYPT_KEY_CHANGE', file: envPath, line: 1, source });
      continue;
    }
    if (entry.status === 'D' || !relevantFile(entry.path)) continue;
    const paths = entry.oldPath ? [entry.oldPath, entry.path] : [entry.path];
    const fileDiff = git(
      ['diff', '--find-renames', '--text', '--no-color', '--no-ext-diff', '--no-textconv', '-U0', ...diffArgs, '--', ...paths],
      repoRoot,
      'Unable to read diff for a changed file.'
    );
    if (!fileDiff || /^Binary files /m.test(fileDiff)) {
      throw new FailClosedError('Unable to inspect diff for a changed source file.');
    }
    const content = contentFn(entry.path);
    const addedLines = parseAddedRanges(fileDiff);
    scanContent(entry.path, content, addedLines, source, violations);
  }
}

function scanVendorChanges(repoRoot, diffArgs, source, violations) {
  const nameStatusRaw = git(
    ['diff', '--find-renames', '--no-color', '--no-ext-diff', '--no-textconv', '--name-status', '-z', ...diffArgs, '--', 'vendor'],
    repoRoot,
    'Unable to enumerate changed vendor files.'
  );
  for (const entry of parseNameStatus(nameStatusRaw)) {
    for (const path of [entry.oldPath, entry.path].filter((value) => value && value.startsWith('vendor/'))) {
      violations.push({ rule: 'ENC_VENDOR_MODIFICATION', file: path, line: 1, source });
    }
  }
}

function scanUntrackedVendor(repoRoot, violations) {
  const raw = git(
    ['ls-files', '--others', '--exclude-standard', '-z', '--', 'vendor'],
    repoRoot,
    'Unable to enumerate untracked vendor files.'
  );
  for (const path of raw.split('\0').filter((value) => value.startsWith('vendor/'))) {
    violations.push({ rule: 'ENC_VENDOR_MODIFICATION', file: path, line: 1, source: 'untracked' });
  }
}

function scanUntracked(repoRoot, violations) {
  const raw = git(
    ['ls-files', '--others', '--exclude-standard', '-z', '--', '.', ...EXCLUDE_PATHSPECS],
    repoRoot,
    'Unable to enumerate untracked files.'
  );
  const paths = raw.split('\0').filter((p) => p.length > 0 && relevantFile(p));
  for (const path of paths) {
    if (isEnvPhp(path)) {
      violations.push({ rule: 'ENC_ENV_CRYPT_KEY_CHANGE', file: path, line: 1, source: 'untracked' });
      continue;
    }
    const content = readWorkingFile(repoRoot, path);
    const addedLines = allLinesAdded(content);
    scanContent(path, content, addedLines, 'untracked', violations);
  }
}

// --- CLI -------------------------------------------------------------------------------

function parseArgs(argv) {
  let base = null;
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--base') {
      if (base !== null || i + 1 >= argv.length) throw new FailClosedError('Unsupported arguments: --base requires one value.');
      base = argv[i + 1];
      if (!base || base.startsWith('-')) throw new FailClosedError('Unsupported arguments: invalid --base value.');
      i += 2;
      continue;
    }
    if (arg.startsWith('--base=')) {
      if (base !== null) throw new FailClosedError('Unsupported arguments: --base requires one value.');
      base = arg.slice('--base='.length);
      if (!base || base.startsWith('-')) throw new FailClosedError('Unsupported arguments: invalid --base value.');
      i += 1;
      continue;
    }
    throw new FailClosedError('Unsupported arguments.');
  }
  return { base };
}

async function main() {
  const { base } = parseArgs(process.argv.slice(2));
  const repoRoot = resolveRepoRoot();
  const violations = [];
  try {
    ({ openAnchoredDirectory } = await import('./anchored-fs.mjs'));
  } catch {
    throw new FailClosedError('Unable to load the safe source reader. Reinstall the toolkit scripts.');
  }

  rejectUnmergedSources(repoRoot);
  scanVendorChanges(repoRoot, ['--cached'], 'staged', violations);
  scanVendorChanges(repoRoot, [], 'worktree', violations);
  scanUntrackedVendor(repoRoot, violations);

  // Staged: index vs HEAD. Content = index blob.
  scanDiffSource(
    repoRoot,
    ['--cached'],
    ['--cached'],
    (path) => readGitBlob(repoRoot, null, path),
    'staged',
    violations
  );

  // Working tree: working tree vs index. Content = file on disk.
  scanDiffSource(
    repoRoot,
    [],
    [],
    (path) => readWorkingFile(repoRoot, path),
    'worktree',
    violations
  );

  // Untracked files: whole file is "new".
  scanUntracked(repoRoot, violations);

  // Committed: merge-base(base, HEAD) .. HEAD, only when --base is given.
  if (base !== null) {
    const mergeBase = base === EMPTY_TREE_SHA ? EMPTY_TREE_SHA :
      git(['merge-base', base, 'HEAD'], repoRoot, 'Invalid or unresolvable --base reference.').trim();
    if (mergeBase !== EMPTY_TREE_SHA) {
      scanVendorChanges(repoRoot, [mergeBase, 'HEAD'], 'committed', violations);
    }
    scanDiffSource(
      repoRoot,
      [mergeBase, 'HEAD'],
      [mergeBase, 'HEAD'],
      (path) => readGitBlob(repoRoot, 'HEAD', path),
      'committed',
      violations
    );
  }

  if (violations.length > 0) {
    process.stdout.write(JSON.stringify({ status: 'blocked', violations }, null, 2) + '\n');
    process.exit(1);
  }

  process.stdout.write(JSON.stringify({ status: 'ok', violations: [] }, null, 2) + '\n');
  process.exit(0);
}

try {
  await main();
} catch (err) {
  if (err instanceof FailClosedError) {
    process.stderr.write(`check-encryption-changes: ${err.message}\n`);
    process.exit(2);
  }
  // Unexpected error — fail closed with a fixed sanitized message only, never the raw
  // error (which could incidentally contain git stderr or file-path-derived content).
  process.stderr.write('check-encryption-changes: Unexpected failure during scan.\n');
  process.exit(2);
}
