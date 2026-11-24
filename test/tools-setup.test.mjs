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

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const oclif = require.resolve('@oclif/core')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

function fixture(run) {
  const dir = mkdtempSync(join(root, '.ccua-tools-test-'))
  try {
    const project = join(dir, 'commerce project')
    const source = join(dir, 'package source')
    const bin = join(dir, 'bin')
    const downloads = join(dir, 'downloads')
    const calls = join(dir, 'calls.jsonl')
    for (const path of [project, source, bin, downloads, join(dir, 'home')]) mkdirSync(path)
    mkdirSync(join(project, 'bin'))
    writeFileSync(join(project, 'bin/magento'), '<?php\n')
    writeFileSync(join(project, 'composer.json'), '{"name":"test/commerce"}\n')
    writeFileSync(join(project, 'package.json'), '{"name":"customer-project"}\n')
    writeFileSync(join(project, 'package-lock.json'), '{"lockfileVersion":3}\n')
    for (const file of ['.claude', '.github', 'scripts', 'package.json', 'CLAUDE.md', 'docs', 'LICENSE', 'COPYRIGHT']) {
      cpSync(join(root, file), join(source, file), { recursive: true })
    }
    writeFileSync(join(bin, 'npm'), `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CCUA_CALLS, JSON.stringify(args) + '\\n');
assert.equal(args[0], 'install');
for (const flag of ['--no-save', '--no-package-lock', '--ignore-scripts', '--no-audit', '--no-fund']) assert(args.includes(flag));
if (process.env.CCUA_FAIL_DOWNLOAD) { console.error('Simulated npm failure'); process.exit(42); }
const prefix = args[args.indexOf('--prefix') + 1];
const target = path.join(prefix, 'node_modules', '@adobe', 'commerce-upgrade-toolkit');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.cpSync(process.env.CCUA_PACKAGE_SOURCE, target, { recursive: true });
`, { mode: 0o755 })
    const env = {
      ...process.env,
      HOME: join(dir, 'home'),
      TMPDIR: downloads,
      PATH: `${bin}:${process.env.PATH}`,
      CCUA_CALLS: calls,
      CCUA_PACKAGE_SOURCE: source
    }
    run({ project, source, bin, downloads, calls, env })
    assert.equal(readFileSync(join(project, 'package.json'), 'utf8'), '{"name":"customer-project"}\n')
    assert.equal(readFileSync(join(project, 'package-lock.json'), 'utf8'), '{"lockfileVersion":3}\n')
    assert.deepEqual(readdirSync(downloads), [], 'temporary downloads must be removed')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function cli(project, env, args = [], input) {
  const runner = `require(${JSON.stringify(oclif)}).run(process.argv.slice(1), ${JSON.stringify(root)})
    .catch(error => { console.error(error.message); process.exitCode = 1 })`
  return spawnSync(process.execPath, [
    '-e', runner, 'commerce', 'upgrade', 'tools-setup', ...args
  ], { cwd: project, env, input, encoding: 'utf8', timeout: 30000 })
}

for (const [agent, agentDir, instruction] of [
  ['GitHub Copilot', '.github', '.github/copilot-instructions.md'],
  ['Claude Code', '.claude', 'CLAUDE.md']
]) {
  test(`toolkit-owned command installs and updates ${agent} through npm`, () => fixture(({ project, env, calls }) => {
    mkdirSync(join(project, agentDir), { recursive: true })
    writeFileSync(join(project, instruction), 'Customer instructions\n')
    const setup = cli(project, env, ['--agent', agent])
    assert.equal(setup.status, 0, setup.stderr + setup.stdout)
    assert.match(setup.stdout, /Commerce Upgrade Tools setup complete/)
    const marker = join(project, agentDir, 'context/.ccua-version')
    assert.equal(readFileSync(marker, 'utf8'), `${version}\n`)
    assert.equal(readFileSync(join(project, instruction), 'utf8'), 'Customer instructions\n')
    assert.equal(existsSync(join(project, '.mcp.json')), false)
    assert.equal(existsSync(join(project, '.vscode/mcp.json')), false)
    writeFileSync(marker, '0.0.0\n')
    const update = cli(project, env, ['--agent', agent, '--tools-version', version, '--project', project])
    assert.equal(update.status, 0, update.stderr + update.stdout)
    assert.match(update.stdout, /Updating toolkit/)
    assert.equal(readFileSync(marker, 'utf8'), `${version}\n`)
    assert.equal(readFileSync(join(project, instruction), 'utf8'), 'Customer instructions\n')
    const invocations = readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    assert.equal(invocations.length, 2)
    assert.equal(invocations[0].at(-1), '@adobe/commerce-upgrade-toolkit@latest')
    assert.equal(invocations[1].at(-1), `@adobe/commerce-upgrade-toolkit@${version}`)
  }))
}

test('toolkit-owned command prompts for the agent before installation', () => fixture(({ project, env }) => {
  const result = cli(project, env, [], '2\n')
  assert.equal(result.status, 0, result.stderr + result.stdout)
  assert.match(result.stdout, /Which agent toolkit/)
  assert.equal(readFileSync(join(project, '.github/context/.ccua-version'), 'utf8'), `${version}\n`)
}))

test('invalid project or version is rejected before downloading', () => fixture(({ project, env, calls }) => {
  const invalidVersion = cli(project, env, ['--agent', 'GitHub Copilot', '--tools-version', 'latest; echo unsafe'])
  assert.equal(invalidVersion.status, 1)
  assert.match(invalidVersion.stderr, /exact release version/)
  assert.equal(existsSync(calls), false)
  rmSync(join(project, 'bin/magento'))
  const invalidProject = cli(project, env, ['--agent', 'GitHub Copilot'])
  assert.equal(invalidProject.status, 1)
  assert.match(invalidProject.stderr, /project validation/)
  assert.equal(existsSync(calls), false)
}))

for (const [label, change, message] of [
  ['wrong package identity', pkg => { pkg.name = '@adobe-commerce/commerce-upgrade-toolkit' }, /unsupported toolkit name/],
  ['missing installer API', pkg => { delete pkg.commerceUpgradeToolkit }, /installer API v1/]
]) {
  test(`download with ${label} is rejected without project installation`, () => fixture(({ project, source, env }) => {
    const manifest = join(source, 'package.json')
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
    change(pkg)
    writeFileSync(manifest, JSON.stringify(pkg))
    const result = cli(project, env, ['--agent', 'GitHub Copilot'])
    assert.equal(result.status, 1)
    assert.match(result.stderr, message)
    assert.equal(existsSync(join(project, '.github')), false)
  }))
}

test('a project path containing a symbolic link is rejected before any file is written',
  { skip: !['linux', 'darwin'].includes(process.platform) }, () => fixture(({ project, env }) => {
    const link = join(project, '..', 'linked project')
    symlinkSync(project, link, 'dir')
    const result = cli(project, env, ['--agent', 'GitHub Copilot', '--project', link])
    assert.equal(result.status, 1, result.stderr + result.stdout)
    assert.match(result.stderr, /host support check/)
    assert.match(result.stderr, /contains a symbolic link/)
    assert.match(result.stderr, /setup-guide\.md/)
    assert.equal(existsSync(join(project, '.github')), false)
    assert.equal(existsSync(join(project, '.claude')), false)
  }))

test('npm failure is reported and the temporary download is cleaned up', () => fixture(({ project, env }) => {
  const result = cli(project, { ...env, CCUA_FAIL_DOWNLOAD: '1' }, ['--agent', 'GitHub Copilot'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Simulated npm failure/)
  assert.match(result.stderr, /package download.*exit code 42/)
  assert.equal(existsSync(join(project, '.github')), false)
}))

test('missing npm executable is reported without leaving a temporary download', () => fixture(({ project, bin, env }) => {
  rmSync(join(bin, 'npm'))
  const result = cli(project, { ...env, PATH: bin }, ['--agent', 'GitHub Copilot'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /package download.*ENOENT/)
  assert.equal(existsSync(join(project, '.github')), false)
}))
