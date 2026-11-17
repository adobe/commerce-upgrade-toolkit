// Copyright 2026 Adobe. All rights reserved.
// Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const prefixes = ['.claude', '.github'];
const snippets = ['\\ExEc("fixture");', 'namespace\\exec("fixture");',
  'Vendor\\handler($value);', '$callback($value);', 'eval($value);',
  'file_get_contents("https://example.invalid");', 'file_get_contents("/absolute");',
  'file_get_contents("../relative");', 'include "missing.php";',
  'new \\ReflectionFunction("exec");'];
const input = after => JSON.stringify({ before: '<?php\n', after: '<?php\n' + after });
const php74 = spawnSync('php7.4', ['-r', 'echo PHP_VERSION;'], { encoding: 'utf8', timeout: 10000 });

test('PHP inspection avoids unguarded PHP 8 tokens and string functions', () => {
  for (const prefix of prefixes) {
    const source = readFileSync(join(root, prefix, 'scripts/inspect_changed_php.php'), 'utf8');
    assert.doesNotMatch(source, /\bstr_(?:contains|starts_with)\s*\(/);
    assert.doesNotMatch(source, /(?:\[|,)\s*T_NAME_(?:FULLY_QUALIFIED|QUALIFIED|RELATIVE)\b/);
    assert.match(source, /defined\(\$constant\)/);
    assert.match(source, /constant\(\$constant\)/);
  }
});

test('PHP 7-style split name tokens preserve current-runtime risk detection and baseline accounting', () => {
  const shim = `namespace Php74Fixture;
function token_get_all($source) {
    $out = [];
    foreach (\\token_get_all($source) as $token) {
        if (is_array($token) && in_array(token_name($token[0]),
            ['T_NAME_FULLY_QUALIFIED', 'T_NAME_QUALIFIED', 'T_NAME_RELATIVE'], true)) {
            $parts = explode(chr(92), $token[1]);
            foreach ($parts as $index => $part) {
                if ($index) $out[] = [T_NS_SEPARATOR, chr(92)];
                if ($part !== '') $out[] = [$part === 'namespace' ? T_NAMESPACE : T_STRING, $part];
            }
        } else $out[] = $token;
    }
    return $out;
}
`;
  for (const prefix of prefixes) {
    const file = join(root, prefix, 'scripts/inspect_changed_php.php');
    const source = readFileSync(file, 'utf8').replace(/^<\?php/, '');
    for (const snippet of [...snippets, 'file_get_contents("local.txt");', '$object->exec("local");']) {
      const normal = spawnSync('php', ['-n', '-d', 'extension=tokenizer', file],
        { input: input(snippet), encoding: 'utf8', timeout: 10000 });
      const split = spawnSync('php', ['-n', '-d', 'extension=tokenizer', '-r', shim + source],
        { input: input(snippet), encoding: 'utf8', timeout: 10000 });
      assert.equal(normal.status, 0, normal.stderr);
      assert.equal(split.status, 0, split.stderr);
      assert.deepEqual(JSON.parse(split.stdout), JSON.parse(normal.stdout), snippet);
      if (snippets.includes(snippet)) assert.ok(JSON.parse(split.stdout).introduced.length > 0, snippet);
      else assert.deepEqual(JSON.parse(split.stdout).introduced, []);
      const unchanged = spawnSync('php', ['-n', '-d', 'extension=tokenizer', '-r', shim + source],
        { input: JSON.stringify({ before: '<?php\n' + snippet, after: '<?php\n' + snippet + '\n// unchanged' }),
          encoding: 'utf8', timeout: 10000 });
      assert.equal(unchanged.status, 0, unchanged.stderr);
      assert.deepEqual(JSON.parse(unchanged.stdout).introduced, []);
    }
  }
});

test('actual PHP 7.4 inspects both helpers without executing submitted source',
  { skip: php74.status !== 0 || !/^7\.4\./.test(php74.stdout) ? 'PHP 7.4 executable unavailable' : false }, () => {
    for (const prefix of prefixes) for (const snippet of snippets) {
      const result = spawnSync('php7.4', ['-n', '-d', 'extension=tokenizer',
        join(root, prefix, 'scripts/inspect_changed_php.php')],
        { input: input(snippet), encoding: 'utf8', timeout: 10000 });
      assert.equal(result.status, 0, result.stderr);
      assert.ok(JSON.parse(result.stdout).introduced.length > 0, snippet);
    }
  });
