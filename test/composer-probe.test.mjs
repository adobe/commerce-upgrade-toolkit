// Copyright 2026 Adobe. All rights reserved.
// Licensed under the Apache License, Version 2.0.
// https://www.apache.org/licenses/LICENSE-2.0
// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const fake = `const fs = require('node:fs');
const path = require('node:path');
const argv = process.argv.slice(2);
fs.writeFileSync(path.join(__dirname, 'seen.json'), JSON.stringify({ argv, env: Object.keys(process.env) }));
const mode = fs.readFileSync(path.join(__dirname, 'mode.txt'), 'utf8');
if (mode === 'auth-failure') {
  process.stderr.write('HTTP 401 for https://user:hunter2@repo.example.com/packages.json');
  process.exit(1);
}
const outdated = { installed: [
  { name: 'vendor/ext', version: '1.0.0', latest: '2.0.0', 'latest-status': 'update-possible',
    description: 'Great extension', 'secret-field': 'leaked' },
  { name: 'vendor/odd', version: '1.0.0', latest: '1.1.0', 'latest-status': 'semver-safe-update',
    description: 'password: swordfish' }] };
const release = { name: 'vendor/ext', versions: ['2.0.0'], type: 'magento2-module',
  requires: { php: '>=8.2', 'magento/framework': mode === 'secret-require' ? 'token=ghp_' + 'a'.repeat(30) : '^103.0' },
  source: { reference: 'abc', url: 'https://user:pw@example.com' } };
process.stdout.write(JSON.stringify(argv.includes('outdated') ? outdated : release));`;

function run(mode, args, { prefix, env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'composer-probe-'));
  try {
    writeFileSync(join(dir, 'fake.cjs'), fake);
    writeFileSync(join(dir, 'mode.txt'), mode);
    const result = spawnSync('python3', ['-B', join(root, '.claude/scripts/composer_probe.py'),
      '--project-root', dir, ...args, '--', ...(prefix || [process.execPath, join(dir, 'fake.cjs')])],
    { encoding: 'utf8', timeout: 20000, env: { ...process.env, ...env } });
    let seen = null;
    try { seen = JSON.parse(readFileSync(join(dir, 'seen.json'), 'utf8')); } catch { /* never launched */ }
    return { result, seen };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('composer probe returns whitelisted metadata and runs a fixed, credential-free argv', () => {
  const { result, seen } = run('ok', ['--op', 'outdated'], {
    env: { COMPOSER_AUTH: '{"http-basic":{"repo.magento.com":{"username":"u","password":"p"}}}',
      GITHUB_TOKEN: 'ghp_' + 'b'.repeat(30), SSH_AUTH_SOCK: '/tmp/agent.sock' } });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, 'ok');
  assert.deepEqual(output.data.map(row => row.name), ['vendor/ext', 'vendor/odd']);
  assert.equal(output.data[0].latest, '2.0.0');
  assert.equal(output.data[1].description, null, 'credential-shaped description is dropped, not returned');
  assert.doesNotMatch(result.stdout, /leaked|secret-field|swordfish/);
  assert.deepEqual(seen.argv.slice(0, 2), ['composer', 'outdated']);
  for (const flag of ['--no-plugins', '--no-scripts', '--no-interaction', '--format=json']) assert.ok(seen.argv.includes(flag), flag);
  for (const name of ['COMPOSER_AUTH', 'GITHUB_TOKEN', 'SSH_AUTH_SOCK']) assert.ok(!seen.env.includes(name), `${name} must not be forwarded`);
});

test('composer probe release lookup returns requirements only', () => {
  const { result, seen } = run('ok', ['--op', 'release', '--package', 'vendor/ext', '--version', '2.0.0']);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.data.requires, { php: '>=8.2', 'magento/framework': '^103.0' });
  assert.doesNotMatch(result.stdout, /user:pw|reference/);
  assert.deepEqual(seen.argv.slice(0, 5), ['composer', 'show', '--all', '--format=json', 'vendor/ext']);
  assert.equal(seen.argv[5], '2.0.0');
});

test('composer probe rejects credential-bearing prefixes and unvalidated tokens before launching', () => {
  for (const prefix of [['docker', 'exec', '-e', 'COMPOSER_AUTH=x', 'php'], ['docker', 'exec', 'php', 'sh'],
    ['docker', 'run', '-v', '/Users/me/.composer:/root/.composer', 'img'], ['docker', 'exec', 'php', 'composer'],
    ['cat', '/home/www-data/.composer/auth.json'], ['x;rm', 'y'], ['docker', 'exec', '--user=root', 'php'],
    ['docker', 'exec', '/run/host-services/ssh-auth.sock']]) {
    const { result, seen } = run('ok', ['--op', 'outdated'], { prefix });
    assert.equal(result.status, 1, prefix.join(' '));
    assert.equal(seen, null);
    assert.match(result.stderr, /rejected/);
  }
  for (const args of [['--op', 'versions'], ['--op', 'versions', '--package', 'Vendor/Ext'],
    ['--op', 'versions', '--package', '../x/y'], ['--op', 'release', '--package', 'vendor/ext'],
    ['--op', 'release', '--package', 'vendor/ext', '--version', '2.0; rm'], ['--op', 'outdated', '--package', 'vendor/ext']]) {
    const { result, seen } = run('ok', args);
    assert.equal(result.status, 1, args.join(' '));
    assert.equal(seen, null);
  }
});

test('composer probe classifies failures without echoing raw output', () => {
  const { result } = run('auth-failure', ['--op', 'outdated']);
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout), { op: 'outdated', status: 'failed', kind: 'authentication', exit: 1 });
  assert.doesNotMatch(result.stdout + result.stderr, /hunter2|user:/);
});

test('composer probe withholds output containing credential-shaped values', () => {
  const { result } = run('secret-require', ['--op', 'release', '--package', 'vendor/ext', '--version', '2.0.0']);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).kind, 'output-withheld');
  assert.doesNotMatch(result.stdout, /ghp_/);
});

test('composer probe is mirrored exactly for both agent flavours', () => {
  assert.equal(readFileSync(join(root, '.claude/scripts/composer_probe.py'), 'utf8'),
    readFileSync(join(root, '.github/scripts/composer_probe.py'), 'utf8'));
});
