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

// AC-19140: fail CI when a toolkit doc tells the agent to run a shell command that prints
// secrets. Bounded heuristic over fenced bash/sh/shell/console blocks only. Findings print
// file:line and a reason, never the matched line.
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SECRET_FILE = /(env\.php|auth\.json|\.magento\.env\.yaml)/;
const READERS = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'sed', 'awk', 'grep', 'egrep', 'fgrep', 'php',
  'strings', 'xxd', 'base64', 'cut', 'sort', 'od', 'tee', 'cp', 'xargs',
]);
const GREPS = new Set(['grep', 'egrep', 'fgrep']);
const LONG_METADATA = new Set(['--files-with-matches', '--files-without-match', '--count', '--quiet', '--silent']);

// Index of the character closing the substitution that starts at `start` ("`" or "$(").
// Quotes, escapes and nested substitutions are tracked so a quoted ")" cannot end it early;
// anything the bounded parser cannot delimit is rejected rather than ignored.
function substitutionEnd(line, start) {
  if (line[start] === '`') {
    for (let i = start + 1; i < line.length; i++) {
      if (line[i] === '\\') i++;
      else if (line[i] === '`') return i;
    }
    throw new Error('UNPARSEABLE-SUBSTITUTION');
  }
  let depth = 1;
  for (let i = start + 2; i < line.length; i++) {
    const c = line[i];
    if (c === '\\') {
      i++;
    } else if (c === "'") {
      i = line.indexOf("'", i + 1);
      if (i < 0) break;
    } else if (c === '"') {
      for (i++; i < line.length && line[i] !== '"'; i++) {
        if (line[i] === '\\') i++;
        else if (line[i] === '`' || (line[i] === '$' && line[i + 1] === '(')) i = substitutionEnd(line, i);
      }
      if (i >= line.length) break;
    } else if (c === '`') {
      i = substitutionEnd(line, i);
    } else if (c === '(') {
      depth++;
    } else if (c === ')' && --depth === 0) {
      return i;
    }
  }
  throw new Error('UNPARSEABLE-SUBSTITUTION');
}

// Split one logical shell line into simple commands, each a list of unquoted-word tokens.
// Quoted text stays inside its token so a quoted pattern is never read as a flag or separator.
function parseCommands(line) {
  const commands = [];
  let words = [];
  let word = null;
  let quote = null;
  const endWord = () => { if (word !== null) words.push(word); word = null; };
  const endCommand = () => { endWord(); if (words.length) commands.push(words); words = []; };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote === "'") {
      if (c === "'") quote = null; else word += c;
    } else if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === '`' || (c === '$' && line[i + 1] === '(')) {
        // Parse the substitution with its own state; the outer quote resumes after it closes.
        const end = substitutionEnd(line, i);
        const inner = c === '`' ? line.slice(i + 1, end) : line.slice(i + 2, end);
        commands.push(...parseCommands(inner));
        i = end;
      }
      else if (c === '\\' && i + 1 < line.length) word += line[++i];
      else word += c;
    } else if (c === "'" || c === '"') {
      quote = c; word = word ?? '';
    } else if (c === '\\' && i + 1 < line.length) {
      word = (word ?? '') + line[++i];
    } else if (c === '#' && word === null) {
      break;
    } else if (/\s/.test(c)) {
      endWord();
    } else if (';&|()`\n'.includes(c)) {
      endCommand();
    } else if (c === '$' && line[i + 1] === '(') {
      endCommand(); i++;
    } else {
      word = (word ?? '') + c;
    }
  }
  endCommand();
  return commands;
}

// A grep is metadata-only only if ITS OWN options include -l/-L/-c/-q (or the long forms).
// -e/-f consume an argument, so text attached to them (e.g. -ecrypt) is pattern, not flags.
function grepIsMetadataOnly(args) {
  let metadata = false;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') break;
    if (arg.startsWith('--')) {
      if (LONG_METADATA.has(arg.split('=')[0])) metadata = true;
      if (arg === '--regexp' || arg === '--file') i++;
    } else if (arg.startsWith('-') && arg.length > 1) {
      for (let j = 1; j < arg.length; j++) {
        if ('lLcq'.includes(arg[j])) metadata = true;
        if ('ef'.includes(arg[j])) { if (j === arg.length - 1) i++; break; }
      }
    }
  }
  return metadata;
}

function checkCommand(words) {
  let k = 0;
  while (k < words.length && (/^[A-Za-z_]\w*=/.test(words[k]) || words[k] === 'sudo')) k++;
  const args = words.slice(k);
  if (!args.length) return null;
  const name = args[0].split('/').pop();
  if (!READERS.has(name)) return null;
  const metadataOnly = GREPS.has(name) && grepIsMetadataOnly(args);
  if (metadataOnly) return null;
  if (args.some((w) => SECRET_FILE.test(w))) return 'READS-SECRET-FILE';
  if (GREPS.has(name) && args.some((w, i) => i > 0 && /password/i.test(w))) return 'PRINTS-PASSWORD-MATCHES';
  return null;
}

export function checkMarkdown(text) {
  const findings = [];
  const lines = text.split('\n');
  let inShell = false;
  for (let index = 0; index < lines.length; index++) {
    const fence = lines[index].match(/^\s*```(\w*)/);
    if (fence) {
      inShell = !inShell && /^(bash|sh|shell|console)$/.test(fence[1]);
      continue;
    }
    if (!inShell) continue;
    const start = index;
    let logical = lines[index];
    while (/\\\s*$/.test(logical) && index + 1 < lines.length && !/^\s*```/.test(lines[index + 1])) {
      logical = logical.replace(/\\\s*$/, ' ') + lines[++index];
    }
    let commands;
    try {
      commands = parseCommands(logical);
    } catch {
      findings.push({ line: start + 1, reason: 'UNPARSEABLE-SUBSTITUTION' });
      continue;
    }
    for (const words of commands) {
      const reason = checkCommand(words);
      if (reason) { findings.push({ line: start + 1, reason }); break; }
    }
  }
  return findings;
}

function markdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    // Symlinks are rejected, not followed: a dangling one must not hide the rest of the tree.
    if (lstatSync(path).isSymbolicLink()) throw new Error(`symlink not allowed: ${path}`);
    if (entry.isDirectory()) return markdownFiles(path);
    return path.endsWith('.md') ? [path] : [];
  });
}

export function scan(root) {
  const results = [];
  for (const base of ['.claude', '.github']) {
    if (!existsSync(join(root, base))) continue;
    for (const file of markdownFiles(join(root, base))) {
      for (const finding of checkMarkdown(readFileSync(file, 'utf8'))) {
        results.push({ file: relative(root, file), ...finding });
      }
    }
  }
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  let results;
  try {
    results = scan(root);
  } catch (error) {
    console.error(`Secret-output gate failed: cannot inspect the tree (${error.message})`);
    process.exit(1);
  }
  for (const r of results) console.error(`${r.file}:${r.line} ${r.reason}`);
  if (results.length) {
    console.error('Secret-output gate failed: see .claude/guardrails/deployment-safety.md');
    process.exit(1);
  }
  console.log('Secret-output gate passed.');
}
