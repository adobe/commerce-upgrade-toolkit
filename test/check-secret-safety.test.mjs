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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkMarkdown, scan } from '../scripts/check-secret-safety.mjs';

const block = (cmd) => '```bash\n' + cmd + '\n```\n';

test('flags commands that print secrets', () => {
  for (const cmd of [
    'grep -A2 "crypt" app/etc/env.php',
    'cat app/etc/env.php | grep -A5 "db"',
    'php -r "$e=include \'app/etc/env.php\'; echo $e[\'crypt\'][\'key\'];"',
    'grep -rn "password\\s*=\\s*[\'\\"]" app/code/',
    'cat auth.json',
  ]) {
    assert.equal(checkMarkdown(block(cmd)).length, 1, cmd);
  }
});

test('allows metadata-only commands, comments and non-shell fences', () => {
  for (const cmd of [
    'grep -rln "password\\s*=\\s*[\'\\"]" app/code/',
    'test -f app/etc/env.php && echo present',
    '# cat app/etc/env.php',
  ]) {
    assert.deepEqual(checkMarkdown(block(cmd)), [], cmd);
  }
  assert.deepEqual(checkMarkdown('```text\ncat app/etc/env.php\n```\n'), []);
});

test('a metadata-only grep elsewhere on the line does not exempt a secret-printing command', () => {
  for (const cmd of [
    'cat app/etc/env.php; grep -q password app/code/Example.php',
    'grep -q x app/code/A.php && cat app/etc/env.php',
    'grep -ecrypt app/etc/env.php',
    'grep -e "-l" crypt app/etc/env.php',
    'echo $(cat app/etc/env.php) | grep -c x',
    'grep -A2 crypt \\\n  app/etc/env.php',
  ]) {
    assert.equal(checkMarkdown(block(cmd)).length, 1, cmd);
  }
});

test('metadata-only flags on the secret-reading grep itself are allowed', () => {
  for (const cmd of ['grep -q crypt app/etc/env.php', 'grep -lr password app/code/', 'grep --count db app/etc/env.php']) {
    assert.deepEqual(checkMarkdown(block(cmd)), [], cmd);
  }
});

test('findings never include the matched line', () => {
  const [finding] = checkMarkdown(block('grep -A2 SECRET-CANARY app/etc/env.php'));
  assert.ok(!JSON.stringify(finding).includes('SECRET-CANARY'));
});

test('toolkit docs contain no secret-printing commands', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  assert.deepEqual(scan(root), []);
});

test('secret-reading commands inside command substitutions are flagged, quoted or not', () => {
  for (const cmd of [
    'echo "$(cat app/etc/env.php)"',
    'echo "x `cat auth.json` y"',
    'echo $(cat app/etc/env.php)',
    'echo "$(echo "$(cat app/etc/env.php)")"',
    `echo "$(printf ')'; cat app/etc/env.php)"`,
    'echo "$(printf \'(\' ; cat app/etc/env.php)"',
    'echo "$(printf "\\)"; cat app/etc/env.php)"',
  ]) {
    assert.equal(checkMarkdown(block(cmd)).length, 1, cmd);
  }
  assert.equal(checkMarkdown(block('echo "$(date)"')).length, 0);
});

test('a substitution the parser cannot delimit is rejected', () => {
  assert.deepEqual(checkMarkdown(block('echo "$(cat app/etc/env.php"')).map((f) => f.reason),
    ['UNPARSEABLE-SUBSTITUTION']);
});

test('a dangling symlink makes the scan fail instead of hiding the tree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccua-secret-'));
  try {
    mkdirSync(join(dir, '.claude'));
    writeFileSync(join(dir, '.claude', 'a.md'), block('cat app/etc/env.php'));
    symlinkSync(join(dir, 'missing'), join(dir, '.claude', 'dangling.md'));
    assert.throws(() => scan(dir), /symlink/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
