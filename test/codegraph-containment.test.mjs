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
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync,
  symlinkSync, linkSync, readlinkSync, readdirSync, lstatSync, chmodSync, unlinkSync, rmdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reconcileLegacyCodegraph, recoverLegacyCodegraph, parseSetupArgs, MAX_WORKSPACE_CONFIG_BYTES } from '../scripts/lib/codegraph-policy.mjs'
import { writeInstalledVersion, readInstalledVersion } from '../scripts/lib/sync-assets.mjs'
import { setupCodegraph } from '../scripts/setup-codegraph.mjs'
import { runClaudeCodeSetup } from '../scripts/lib/setup-claude.mjs'
import { runGithubCopilotSetup } from '../scripts/lib/setup-github.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (name) => readFileSync(join(root, name), 'utf8')
const legacy = { type: 'stdio', command: 'codegraph', args: ['serve', '--mcp'] }

function snapshot(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = join(dir, entry.name)
    return entry.isSymbolicLink() ? [[file, `link:${readlinkSync(file)}`]] :
      entry.isDirectory() ? snapshot(file) : [[file, readFileSync(file, 'utf8')]]
  }).sort(([a], [b]) => a.localeCompare(b))
}

async function fixture(run) {
  const dir = mkdtempSync(join(root, '.codegraph-test-'))
  try {
    const projectRoot = join(dir, 'project')
    const bin = join(dir, 'bin')
    mkdirSync(projectRoot)
    mkdirSync(bin)
    for (const name of ['codegraph', 'npm', 'npx']) {
      writeFileSync(join(bin, name),
        '#!/bin/sh\nprintf "%s\\n" "$0 $*" >> "$CCUA_UNEXPECTED"\nexit 97\n', { mode: 0o755 })
    }
    writeFileSync(join(bin, 'claude'),
      '#!/bin/sh\nprintf "probe\\n" >> "$CCUA_PROBE"\nprintf "inert-test-cli\\n"\n', { mode: 0o755 })
    const unexpected = join(dir, 'unexpected')
    const probe = join(dir, 'probe')
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`,
      CCUA_UNEXPECTED: unexpected, CCUA_PROBE: probe, HOME: join(dir, 'home') }
    mkdirSync(env.HOME)
    writeFileSync(join(env.HOME, 'mcp-config.json'), '{"global":"untouched"}')
    const homeBefore = snapshot(env.HOME)
    await run({ dir, projectRoot, env, probe })
    assert.equal(existsSync(unexpected), false, 'no CodeGraph or package-manager execution')
    assert.deepEqual(snapshot(env.HOME), homeBefore, 'no home configuration changes')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function script(projectRoot, env, flags = [], name = 'setup-project') {
  return spawnSync(process.execPath, [join(root, `scripts/${name}.mjs`),
    '--project', projectRoot, ...flags], { cwd: root, env, encoding: 'utf8', timeout: 30000 })
}

function command(name, projectRoot, env, flags = []) {
  const runner = 'const C=require(process.argv[1]);C.run(process.argv.slice(2),{root:process.cwd()}).catch(e=>{console.error(e.message);process.exitCode=1})'
  return spawnSync(process.execPath, ['-e', runner, join(root, `src/commands/ccua/${name}.js`),
    '--project', projectRoot, ...flags], { cwd: root, env, encoding: 'utf8', timeout: 30000 })
}

const entrypoints = {
  script: (p, e, f) => script(p, e, f),
  setup: (p, e, f) => command('setup', p, e, f),
  select: (p, e, f) => command('agent/select', p, e, f),
  wrapper: (p, e, f) => spawnSync('bash', [join(root, 'setup.sh'), '--project', p, ...f],
    { cwd: root, env: e, encoding: 'utf8', timeout: 30000 }),
}

for (const [name, entrypoint] of Object.entries(entrypoints)) {
  for (const [flags, error] of [
    [['--enable-codegraph'], /activation blocked.*approved profile/],
    [['--enable-codegraph', '--skip-codegraph'], /conflict/],
    [['--skip-codegraph', '--enable-codegraph'], /conflict/],
    [['--skip-codegraph', '--allow-codegraph'], /Unknown|Nonexistent|Unexpected/i],
  ]) {
    test(`${name} rejects ${flags.join(' ')} before probes or writes`, () => fixture(({ projectRoot, env, probe }) => {
      writeFileSync(join(projectRoot, '.mcp.json'), JSON.stringify({ mcpServers: { codegraph: legacy } }))
      const before = snapshot(projectRoot)
      const result = entrypoint(projectRoot, env, flags)
      assert.notEqual(result.status, 0, result.stdout)
      assert.match(`${result.stderr}${result.stdout}`, error)
      assert.deepEqual(snapshot(projectRoot), before)
      assert.equal(existsSync(probe), false, 'enable must fail before arbitrary CLI probes')
    }))
  }
  for (const flags of [[], ['--skip-codegraph']]) {
    test(`${name} default/skip setup uses direct fallback only (${flags})`, () => fixture(({ projectRoot, env }) => {
      const result = entrypoint(projectRoot, env, [...flags, '--agent', 'github-copilot'])
      assert.equal(result.status, 0, `${result.stderr}${result.stdout}`)
      assert.ok(existsSync(join(projectRoot, '.github/agents')))
      assert.equal(existsSync(join(projectRoot, '.mcp.json')), false)
      assert.equal(existsSync(join(projectRoot, '.vscode/mcp.json')), false)
      assert.match(result.stdout, /CodeGraph disabled/)
    }))
  }
}

for (const setup of [runClaudeCodeSetup, runGithubCopilotSetup]) {
  test(`${setup.name} rejects activation/conflict before copying`, () => fixture(async ({ projectRoot }) => {
    const before = snapshot(projectRoot)
    await assert.rejects(setup({ toolRoot: root, projectRoot, enableCodegraph: true }), /activation blocked/)
    await assert.rejects(setup({ toolRoot: root, projectRoot, enableCodegraph: true, skipCodegraph: true }), /conflict/)
    assert.deepEqual(snapshot(projectRoot), before)
  }))
}

function seedConfigs(projectRoot) {
  mkdirSync(join(projectRoot, '.vscode'), { recursive: true })
  mkdirSync(join(projectRoot, '.claude'), { recursive: true })
  const unrelated = { command: 'reviewed-other', args: ['local'] }
  writeFileSync(join(projectRoot, '.mcp.json'),
    JSON.stringify({ inputs: ['keep'], mcpServers: { codegraph: legacy, other: unrelated } }))
  writeFileSync(join(projectRoot, '.vscode/mcp.json'),
    JSON.stringify({ inputs: ['keep'], servers: { codegraph: { command: 'codegraph', args: ['serve', '--mcp'] }, other: unrelated } }))
  for (const name of ['settings.json', 'settings.local.json']) {
    writeFileSync(join(projectRoot, '.claude', name), JSON.stringify({
      enabledMcpjsonServers: ['codegraph', 'other'], custom: 'keep',
      permissions: { allow: ['mcp__codegraph__codegraph_explore', 'mcp__codegraph__*',
        'mcp__codegraph', 'Read', 'mcp__other__*'], deny: ['Write(vendor/**)'] },
    }))
  }
}

for (const [agent, setup] of [['claude-code', runClaudeCodeSetup], ['github-copilot', runGithubCopilotSetup]]) {
  for (const kind of ['symlink', 'dangling', 'hardlink', 'directory', 'context-link', 'empty', 'invalid', 'oversized']) {
    test(`${agent} setup rejects ${kind} markers before reconciliation/copies`, () => fixture(async ({ projectRoot, dir, env }) => {
      seedConfigs(projectRoot)
      const base = agent === 'claude-code' ? '.claude' : '.github'
      const context = join(projectRoot, base, 'context')
      const marker = join(context, '.ccua-version')
      const outside = join(dir, 'external-marker')
      mkdirSync(context, { recursive: true })
      writeFileSync(outside, '1.0.0\n')
      if (kind === 'symlink') symlinkSync(outside, marker)
      else if (kind === 'dangling') symlinkSync(join(dir, 'missing-marker'), marker)
      else if (kind === 'hardlink') linkSync(outside, marker)
      else if (kind === 'directory') mkdirSync(marker)
      else if (kind === 'context-link') {
        rmdirSync(context)
        mkdirSync(join(dir, 'external-context'))
        symlinkSync(join(dir, 'external-context'), context)
      } else writeFileSync(marker, kind === 'empty' ? '' : kind === 'invalid' ? 'untrusted' : '1'.repeat(101))
      const before = snapshot(projectRoot)
      const outsideSnapshot = () => snapshot(dir).filter(([file]) =>
        !file.startsWith(`${projectRoot}/`) && file !== join(dir, 'probe'))
      const outsideBefore = outsideSnapshot()
      await assert.rejects(setup({ toolRoot: root, projectRoot }), /Unsafe toolkit version marker|Invalid toolkit version/)
      await assert.rejects(writeInstalledVersion(projectRoot, '2.0.1', agent), /Unsafe toolkit version marker|Invalid toolkit version/)
      for (const entrypoint of Object.values(entrypoints)) {
        const result = entrypoint(projectRoot, env, ['--agent', agent])
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, /Unsafe toolkit version marker|Invalid toolkit version/)
        assert.deepEqual(snapshot(projectRoot), before)
      }
      assert.deepEqual(snapshot(projectRoot), before)
      assert.deepEqual(outsideSnapshot(), outsideBefore)
    }))
  }
  test(`${agent} fresh and repeated marker publication replaces inodes and cleans staging`, () => fixture(async ({ projectRoot }) => {
    const base = agent === 'claude-code' ? '.claude' : '.github'
    const marker = join(projectRoot, base, 'context/.ccua-version')
    await writeInstalledVersion(projectRoot, '1.0.0', agent)
    const before = lstatSync(marker)
    await writeInstalledVersion(projectRoot, '2.0.1', agent)
    assert.notEqual(lstatSync(marker).ino, before.ino)
    assert.equal(lstatSync(marker).nlink, 1)
    assert.equal(await readInstalledVersion(projectRoot, agent), '2.0.1')
    assert.deepEqual(readdirSync(dirname(marker)), ['.ccua-version'])
    await assert.rejects(writeInstalledVersion(projectRoot, '2.0.1\nuntrusted', agent), /Invalid toolkit version/)
    assert.equal(await readInstalledVersion(projectRoot, agent), '2.0.1')
  }))
}

test('workspace config limit accepts exact boundary and rejects oversized input before open', () => fixture(({ projectRoot, env }) => {
  const file = join(projectRoot, '.mcp.json')
  const prefix = '{"notes":"'; const suffix = '"}'
  const source = prefix + 'x'.repeat(MAX_WORKSPACE_CONFIG_BYTES - prefix.length - suffix.length) + suffix
  writeFileSync(file, source)
  reconcileLegacyCodegraph(projectRoot)
  assert.equal(readFileSync(file, 'utf8'), source)
  writeFileSync(file, source + ' ')
  const before = snapshot(projectRoot)
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const [modulePath, root] = process.argv.slice(1);
const original = fs.openSync;
fs.openSync = (file, ...args) => {
  if (file === root + '/.mcp.json') throw new Error('oversized config was opened');
  return original(file, ...args);
};
syncBuiltinESMExports();
const policy = await import(modulePath);
try { policy.reconcileLegacyCodegraph(root); throw new Error('oversized config accepted'); }
catch (error) { if (!/2000000-byte limit/.test(error.message)) throw error; }
`, join(root, 'scripts/lib/codegraph-policy.mjs'), projectRoot],
    { env, encoding: 'utf8', timeout: 10000 })
  assert.equal(result.status, 0, result.stderr)
  for (const entrypoint of Object.values(entrypoints)) {
    const blocked = entrypoint(projectRoot, env, ['--agent', 'github-copilot'])
    assert.notEqual(blocked.status, 0)
    assert.match(blocked.stderr, /2000000-byte limit/)
    assert.deepEqual(snapshot(projectRoot), before)
  }
}))

test('workspace config growth during read blocks instead of reading an unbounded stream', () => fixture(({ projectRoot, env }) => {
  writeFileSync(join(projectRoot, '.mcp.json'), '{"notes":"fixture"}')
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const [modulePath, root] = process.argv.slice(1);
const policy = await import(modulePath);
const file = root + '/.mcp.json'; const original = fs.readSync;
const size = fs.statSync(file).size; let reads = 0;
fs.readSync = (...args) => {
  if (++reads === 1) fs.appendFileSync(file, ' '.repeat(2000001));
  if (args[3] > size + 1) throw new Error('read was not bounded');
  return original(...args);
};
syncBuiltinESMExports();
try { policy.reconcileLegacyCodegraph(root); throw new Error('growth accepted'); }
catch (error) { if (!/changed during bounded read/.test(error.message)) throw error; }
if (fs.existsSync(root + '/.ccua')) throw new Error('metadata written before rejection');
`, join(root, 'scripts/lib/codegraph-policy.mjs'), projectRoot],
    { env, encoding: 'utf8', timeout: 10000 })
  assert.equal(result.status, 0, result.stderr)
}))

function assertReconciled(projectRoot) {
  for (const [file, key] of [['.mcp.json', 'mcpServers'], ['.vscode/mcp.json', 'servers']]) {
    const value = JSON.parse(readFileSync(join(projectRoot, file), 'utf8'))
    assert.deepEqual(value, { inputs: ['keep'], [key]: { other: { command: 'reviewed-other', args: ['local'] } } })
  }
  for (const name of ['settings.json', 'settings.local.json']) {
    const value = JSON.parse(readFileSync(join(projectRoot, '.claude', name), 'utf8'))
    assert.deepEqual(value.enabledMcpjsonServers, ['other'])
    assert.deepEqual(value.permissions, { allow: ['Read', 'mcp__other__*'], deny: ['Write(vendor/**)'] })
    assert.equal(value.custom, 'keep')
  }
}

test('reconciliation replaces inodes, preserves ownership/modes and cleans private staging', () => fixture(({ projectRoot }) => {
  seedConfigs(projectRoot)
  const files = ['.mcp.json', '.vscode/mcp.json', '.claude/settings.json', '.claude/settings.local.json']
  const before = files.map((file, i) => {
    chmodSync(join(projectRoot, file), i % 2 ? 0o640 : 0o600)
    return lstatSync(join(projectRoot, file))
  })
  reconcileLegacyCodegraph(projectRoot)
  assertReconciled(projectRoot)
  files.forEach((file, i) => {
    const after = lstatSync(join(projectRoot, file))
    assert.notEqual(after.ino, before[i].ino)
    assert.equal(after.mode & 0o777, before[i].mode & 0o777)
    assert.equal(after.uid, before[i].uid)
    assert.equal(after.gid, before[i].gid)
    assert.equal(after.nlink, 1)
    assert.ok(!readdirSync(dirname(join(projectRoot, file))).some(name => name.startsWith('.ccua-reconcile-')))
  })
}))

function faultReconciliation(projectRoot, env, mode, recovering = false) {
  const source = `
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const [policy, root, mode, recovering] = process.argv.slice(1);
const first = root + '/.mcp.json';
const original = fs.readFileSync(first, 'utf8');
const rename = fs.renameSync;
let count = 0;
fs.renameSync = (...args) => {
  count++;
  if (count === 2 && mode === 'throw') throw new Error('synthetic late publication failure');
  if (count === 2 && mode === 'exit') process.exit(98);
  const result = rename(...args);
  if (count === 4 && mode === 'verify') fs.writeFileSync(first, original);
  return result;
};
syncBuiltinESMExports();
try {
  const api = await import(policy);
  if (recovering === 'true') api.recoverLegacyCodegraph(root);
  else api.reconcileLegacyCodegraph(root);
} catch (error) { console.error(error.message); process.exitCode = 1; }
`
  return spawnSync(process.execPath, ['--input-type=module', '-e', source,
    join(root, 'scripts/lib/codegraph-policy.mjs'), projectRoot, mode, String(recovering)],
    { env, encoding: 'utf8', timeout: 10000 })
}

for (const mode of ['throw', 'exit', 'verify']) {
  test(`late reconciliation ${mode} blocks setup/update until explicit verified roll-forward`, () =>
    fixture(({ projectRoot, env }) => {
      seedConfigs(projectRoot)
      mkdirSync(join(projectRoot, '.claude/context'), { recursive: true })
      writeFileSync(join(projectRoot, '.claude/context/.ccua-version'), '0.0.0\n')
      const result = faultReconciliation(projectRoot, env, mode)
      assert.equal(result.error, undefined)
      assert.equal(result.status, mode === 'exit' ? 98 : 1)
      const journalPath = join(projectRoot, '.ccua/legacy-reconciliation.json')
      const lockPath = join(projectRoot, '.ccua/legacy-reconciliation.lock')
      assert.ok(existsSync(journalPath))
      assert.equal(existsSync(lockPath), mode === 'exit')
      const journalSource = readFileSync(journalPath, 'utf8')
      const journal = JSON.parse(journalSource)
      assert.deepEqual(Object.keys(journal).sort(), ['files', 'schemaVersion'])
      assert.equal(journal.files.length, 4)
      for (const item of journal.files) {
        assert.deepEqual(Object.keys(item).sort(), ['afterSha256', 'beforeSha256', 'path'])
        assert.match(item.beforeSha256, /^[a-f0-9]{64}$/)
        assert.match(item.afterSha256, /^[a-f0-9]{64}$/)
      }
      assert.doesNotMatch(journalSource, /reviewed-other|permissions|custom|approved/)
      const before = snapshot(projectRoot)
      for (const name of ['setup-project', 'update-project']) {
        const blocked = script(projectRoot, env, ['--agent', 'claude-code'], name)
        assert.notEqual(blocked.status, 0)
        assert.match(blocked.stderr, /recovery|reconciliation/i)
        assert.deepEqual(snapshot(projectRoot), before)
      }
      if (mode === 'exit') {
        assert.throws(() => recoverLegacyCodegraph(projectRoot), /lock exists/)
        assert.deepEqual(snapshot(projectRoot), before)
        rmdirSync(lockPath) // Simulate separately reviewed human stale-lock removal in this fixture.
      }
      const recovered = script(projectRoot, env, [], 'recover-legacy-codegraph')
      assert.equal(recovered.status, 0, recovered.stderr)
      assertReconciled(projectRoot)
      assert.equal(existsSync(journalPath), false)
      assert.equal(existsSync(lockPath), false)
      reconcileLegacyCodegraph(projectRoot)
    }))
}

test('interrupted explicit recovery remains blocked and can roll forward again', () =>
  fixture(({ projectRoot, env }) => {
    seedConfigs(projectRoot)
    assert.equal(faultReconciliation(projectRoot, env, 'throw').status, 1)
    assert.equal(faultReconciliation(projectRoot, env, 'exit', true).status, 98)
    assert.throws(() => reconcileLegacyCodegraph(projectRoot), /lock exists/)
    assert.throws(() => recoverLegacyCodegraph(projectRoot), /lock exists/)
    rmdirSync(join(projectRoot, '.ccua/legacy-reconciliation.lock'))
    recoverLegacyCodegraph(projectRoot)
    assertReconciled(projectRoot)
    assert.equal(existsSync(join(projectRoot, '.ccua/legacy-reconciliation.json')), false)
  }))

for (const kind of ['drift', 'malformed', 'unknown-path', 'hardlink', 'symlink', 'lock']) {
  test(`recovery rejects ${kind} without expanding scope or restoring old grants`, () =>
    fixture(({ projectRoot, env, dir }) => {
      seedConfigs(projectRoot)
      assert.equal(faultReconciliation(projectRoot, env, 'throw').status, 1)
      const journalPath = join(projectRoot, '.ccua/legacy-reconciliation.json')
      const original = readFileSync(journalPath, 'utf8')
      const outside = join(dir, 'outside-journal.json')
      if (kind === 'drift') {
        writeFileSync(join(projectRoot, '.claude/settings.json'), '{"human":"new unrelated content"}')
      } else if (kind === 'malformed') {
        writeFileSync(journalPath, '{"schemaVersion":1,"files":[]}')
      } else if (kind === 'unknown-path') {
        const journal = JSON.parse(original)
        journal.files[0].path = '../outside-journal.json'
        writeFileSync(journalPath, JSON.stringify(journal))
      } else if (kind === 'hardlink' || kind === 'symlink') {
        writeFileSync(outside, original)
        unlinkSync(journalPath)
        if (kind === 'hardlink') linkSync(outside, journalPath)
        else symlinkSync(outside, journalPath)
      } else {
        mkdirSync(join(projectRoot, '.ccua/legacy-reconciliation.lock'))
      }
      const before = snapshot(projectRoot)
      assert.throws(() => recoverLegacyCodegraph(projectRoot),
        /drift|Invalid legacy|Unsafe|lock exists/)
      assert.deepEqual(snapshot(projectRoot), before)
      if (kind === 'hardlink' || kind === 'symlink') {
        assert.equal(readFileSync(outside, 'utf8'), original)
      }
      assert.throws(() => reconcileLegacyCodegraph(projectRoot), /Pending|lock exists/)
      assert.deepEqual(snapshot(projectRoot), before)
    }))
}

test('invalid UTF-8 blocks before reconciliation metadata or config writes', () =>
  fixture(({ projectRoot }) => {
    seedConfigs(projectRoot)
    writeFileSync(join(projectRoot, '.claude/settings.json'),
      Buffer.concat([Buffer.from('{"custom":"'), Buffer.from([255]), Buffer.from('"}')]))
    const before = readFileSync(join(projectRoot, '.claude/settings.json'))
    assert.throws(() => reconcileLegacyCodegraph(projectRoot), /Invalid UTF-8/)
    assert.deepEqual(readFileSync(join(projectRoot, '.claude/settings.json')), before)
    assert.equal(existsSync(join(projectRoot, '.ccua')), false)
    assert.ok(JSON.parse(readFileSync(join(projectRoot, '.mcp.json'), 'utf8')).mcpServers.codegraph)
  }))

test('compatibility export removes both recognizable legacy formats/grants idempotently', () => fixture(async ({ projectRoot }) => {
  seedConfigs(projectRoot)
  await setupCodegraph(projectRoot)
  assertReconciled(projectRoot)
  const before = snapshot(projectRoot)
  await setupCodegraph(projectRoot, { skipCodegraph: true })
  assert.deepEqual(snapshot(projectRoot), before)
  await assert.rejects(setupCodegraph(projectRoot, { enableCodegraph: true }), /activation blocked/)
  assert.deepEqual(snapshot(projectRoot), before)
}))

test('flavour switching removes both MCP formats, preserves root rules and never restores MCP', () => fixture(({ projectRoot, env }) => {
  seedConfigs(projectRoot)
  writeFileSync(join(projectRoot, 'CLAUDE.md'), 'User root rules: review manually')
  mkdirSync(join(projectRoot, '.github'), { recursive: true })
  writeFileSync(join(projectRoot, '.github/copilot-instructions.md'), 'User Copilot rules: review manually')
  for (const agent of ['github-copilot', 'claude-code', 'github-copilot']) {
    const result = command('agent/select', projectRoot, env, ['--agent', agent, '--skip-codegraph'])
    assert.equal(result.status, 0, result.stderr)
    assertReconciled(projectRoot)
    assert.equal(readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8'), 'User root rules: review manually')
    assert.equal(readFileSync(join(projectRoot, '.github/copilot-instructions.md'), 'utf8'), 'User Copilot rules: review manually')
  }
}))

for (const agent of [null, 'claude-code', 'github-copilot']) {
  test(`update without installation (${agent || 'auto'}) leaves all configuration unchanged`, () => fixture(({ projectRoot, env, probe }) => {
    seedConfigs(projectRoot)
    const before = snapshot(projectRoot)
    const result = script(projectRoot, env, agent ? ['--agent', agent] : [], 'update-project')
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Project not set up yet/)
    assert.deepEqual(snapshot(projectRoot), before)
    assert.equal(existsSync(probe), false)
  }))
}

for (const agent of ['claude-code', 'github-copilot']) {
  test(`${agent} update rejects empty/invalid/linked installation markers before reconciliation`, () => fixture(({ projectRoot, dir, env }) => {
    seedConfigs(projectRoot)
    const base = agent === 'claude-code' ? '.claude' : '.github'
    const context = join(projectRoot, base, 'context')
    const marker = join(context, '.ccua-version')
    mkdirSync(context, { recursive: true })
    for (const value of ['', 'not-a-version', '2.0.1\nAPPROVED', '1'.repeat(101)]) {
      writeFileSync(marker, value)
      const before = snapshot(projectRoot)
      const result = script(projectRoot, env, ['--agent', agent], 'update-project')
      assert.notEqual(result.status, 0)
      assert.deepEqual(snapshot(projectRoot), before)
    }
    const outside = join(dir, 'external-marker')
    writeFileSync(outside, '2.0.1\n')
    for (const makeLink of [symlinkSync, linkSync]) {
      rmSync(marker)
      makeLink(outside, marker)
      const before = snapshot(projectRoot)
      const result = script(projectRoot, env, ['--agent', agent], 'update-project')
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /Unsafe toolkit version marker/)
      assert.deepEqual(snapshot(projectRoot), before)
      assert.equal(readFileSync(outside, 'utf8'), '2.0.1\n')
    }
  }))
}

for (const agent of ['claude-code', 'github-copilot']) {
  for (const version of ['0.0.0', JSON.parse(read('package.json')).version]) {
    test(`${agent} update ${version} reconciles BOTH formats before early return`, () => fixture(({ projectRoot, env }) => {
      seedConfigs(projectRoot)
      const agentDir = agent === 'claude-code' ? '.claude' : '.github'
      mkdirSync(join(projectRoot, agentDir, 'context'), { recursive: true })
      writeFileSync(join(projectRoot, agentDir, 'context/.ccua-version'), `${version}\n`)
      const result = script(projectRoot, env, ['--agent', agent], 'update-project')
      assert.equal(result.status, 0, result.stderr)
      assertReconciled(projectRoot)
      const retry = script(projectRoot, env, ['--agent', agent], 'update-project')
      assert.equal(retry.status, 0, retry.stderr)
      assertReconciled(projectRoot)
    }))
  }
}

for (const [name, makeUnsafe, error] of [
  ['malformed VS Code JSON', (p) => writeFileSync(join(p, '.vscode/mcp.json'), '{invalid'), /Malformed JSON/],
  ['duplicate server keys', (p) => writeFileSync(join(p, '.vscode/mcp.json'),
    '{"servers":{"other":{"keep":true},"other":{"keep":false},"codegraph":{"command":"codegraph","args":["serve","--mcp"]}}}'), /Malformed JSON/],
  ['escaped duplicate keys', (p) => writeFileSync(join(p, '.vscode/mcp.json'),
    '{"servers":{"codegraph":{"command":"codegraph","args":["serve","--mcp"]},"\\u0063odegraph":{"custom":"keep"}}}'), /Malformed JSON/],
  ['invalid root object', (p) => writeFileSync(join(p, '.vscode/mcp.json'), 'null'), /Expected JSON object/],
  ['invalid servers', (p) => writeFileSync(join(p, '.vscode/mcp.json'), '{"servers":[]}'), /Invalid servers/],
  ...[
    { ...legacy, env: { CUSTOM: 'keep' } }, { ...legacy, command: '/custom/codegraph' },
    { ...legacy, args: ['serve', '--mcp', '--custom'] }, { ...legacy, type: 'http' }, null,
  ].map((server, i) => [`customized entry ${i}`,
    (p) => writeFileSync(join(p, '.vscode/mcp.json'), JSON.stringify({ servers: { codegraph: server } })),
    /Customized CodeGraph/]),
  ['malformed settings', (p) => writeFileSync(join(p, '.claude/settings.json'), '{'), /Malformed JSON/],
  ['invalid settings allow', (p) => writeFileSync(join(p, '.claude/settings.local.json'), '{"permissions":{"allow":"unsafe"}}'), /Invalid permissions.allow/],
  ['invalid settings enablement', (p) => writeFileSync(join(p, '.claude/settings.json'), '{"enabledMcpjsonServers":true}'), /Invalid enabledMcpjsonServers/],
  ['invalid settings hooks', (p) => writeFileSync(join(p, '.claude/settings.json'), '{"hooks":{"SessionStart":"invalid"}}'), /Invalid hooks.SessionStart/],
  ...['.mcp.json', '.vscode/mcp.json', '.claude/settings.json', '.claude/settings.local.json']
    .map((file, i) => [`external hardlink ${file}`, (p, d) => {
      const external = join(d, `hardlink-${i}.json`)
      writeFileSync(external, readFileSync(join(p, file)))
      rmSync(join(p, file))
      linkSync(external, join(p, file))
    }, /Unsafe workspace config path/]),
  ['external file symlink', (p, d) => {
    writeFileSync(join(d, 'external.json'), '{never read malformed external}')
    rmSync(join(p, '.vscode/mcp.json'))
    symlinkSync(join(d, 'external.json'), join(p, '.vscode/mcp.json'))
  }, /Unsafe symlink/],
  ['external Claude MCP symlink', (p, d) => {
    writeFileSync(join(d, 'external.json'), '{never read malformed external}')
    rmSync(join(p, '.mcp.json'))
    symlinkSync(join(d, 'external.json'), join(p, '.mcp.json'))
  }, /Unsafe symlink/],
  ['external settings symlink', (p, d) => {
    writeFileSync(join(d, 'external.json'), '{never read malformed external}')
    rmSync(join(p, '.claude/settings.local.json'))
    symlinkSync(join(d, 'external.json'), join(p, '.claude/settings.local.json'))
  }, /Unsafe symlink/],
  ['external ancestor symlink', (p, d) => {
    mkdirSync(join(d, 'external'))
    writeFileSync(join(d, 'external/mcp.json'), '{never read malformed external}')
    rmSync(join(p, '.vscode'), { recursive: true })
    symlinkSync(join(d, 'external'), join(p, '.vscode'))
  }, /Unsafe symlink/],
  ['dangling settings ancestor', (p, d) => {
    rmSync(join(p, '.claude'), { recursive: true })
    symlinkSync(join(d, 'missing'), join(p, '.claude'))
  }, /Unsafe symlink|Unsafe toolkit version marker/],
]) {
  test(`${name} fails preflight without partial writes or external reads`, () => fixture(({ projectRoot, dir, env }) => {
    seedConfigs(projectRoot)
    mkdirSync(join(projectRoot, '.claude/context'), { recursive: true })
    writeFileSync(join(projectRoot, '.claude/context/.ccua-version'), '0.0.0\n')
    makeUnsafe(projectRoot, dir)
    const before = snapshot(projectRoot)
    const outsideBefore = snapshot(dir).filter(([file]) => !file.startsWith(`${projectRoot}/`))
    assert.throws(() => reconcileLegacyCodegraph(projectRoot), error)
    assert.deepEqual(snapshot(projectRoot), before)
    for (const runner of [
      () => script(projectRoot, env),
      () => script(projectRoot, env, ['--agent', 'github-copilot']),
      () => script(projectRoot, env, ['--agent', 'claude-code'], 'update-project'),
    ]) {
      const result = runner()
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, error)
      assert.deepEqual(snapshot(projectRoot), before)
    }
    assert.deepEqual(snapshot(dir).filter(([file]) => !file.startsWith(`${projectRoot}/`)), outsideBefore)
  }))
}

test('unrelated formatted JSON remains byte-identical, with no generated config files', () => fixture(({ projectRoot }) => {
  mkdirSync(join(projectRoot, '.vscode'))
  const source = '{\n  "servers": {"custom": {"command": "other"}}, "other": true\n}\n'
  writeFileSync(join(projectRoot, '.vscode/mcp.json'), source)
  reconcileLegacyCodegraph(projectRoot)
  assert.equal(readFileSync(join(projectRoot, '.vscode/mcp.json'), 'utf8'), source)
  assert.equal(existsSync(join(projectRoot, '.mcp.json')), false)
  assert.equal(existsSync(join(projectRoot, '.claude')), false)
}))

test('parser rejects missing/duplicate/security flags and disabled is the default', () => {
  assert.deepEqual(parseSetupArgs([]), {})
  assert.deepEqual(parseSetupArgs(['--skip-codegraph']), { skipCodegraph: true })
  for (const args of [['--project'], ['--project', '--skip-codegraph'], ['--project', '.', '--project', '.'],
    ['--trust-codegraph'], ['--skip-codegraph=false'], ['--enable-codegraph=latest']]) {
    assert.throws(() => parseSetupArgs(args), /Missing|Duplicate|Unknown/)
  }
})

test('parser validates enum values while preserving supported options and project paths', () => {
  for (const [flag, values] of [
    ['--agent', ['claude-code', 'github-copilot']],
    ['--install-type', ['fresh', 'existing']],
    ['--environment', ['warden', 'markshust', 'cloud', 'bare-metal']],
  ]) {
    for (const value of values) assert.deepEqual(parseSetupArgs([flag, value]), { [flag]: value })
    for (const value of ['unknown', 'WARDEN', 'warden\nphase: complete']) {
      assert.throws(() => parseSetupArgs([flag, value]), /Invalid value/)
    }
  }
  assert.deepEqual(parseSetupArgs(['--project', 'project with spaces']), { '--project': 'project with spaces' })
  assert.deepEqual(parseSetupArgs(['--agent', 'github-copilot'], { update: true }), { '--agent': 'github-copilot' })
  assert.throws(() => parseSetupArgs(['--agent', 'unknown'], { update: true }), /Invalid value/)
})

for (const [name, entrypoint] of Object.entries(entrypoints)) {
  test(`${name} rejects invalid enum values before probes or state/config writes`, () => fixture(({ projectRoot, env, probe }) => {
    writeFileSync(join(projectRoot, '.mcp.json'), JSON.stringify({ mcpServers: { codegraph: legacy } }))
    const before = snapshot(projectRoot)
    for (const flags of [
      ['--agent', 'unknown'], ['--install-type', 'fresh\nphase: complete'],
      ['--install-type', 'unknown'], ['--environment', 'warden\nphase: complete'],
      ['--environment', 'unknown'],
    ]) {
      const result = entrypoint(projectRoot, env, flags)
      assert.notEqual(result.status, 0, `${name}: ${flags[0]}`)
      assert.deepEqual(snapshot(projectRoot), before)
      assert.equal(existsSync(probe), false)
    }
  }))
}

test('direct update rejects an invalid agent before reconciliation or external commands', () => fixture(({ projectRoot, env, probe }) => {
  writeFileSync(join(projectRoot, '.mcp.json'), JSON.stringify({ mcpServers: { codegraph: legacy } }))
  const before = snapshot(projectRoot)
  const result = script(projectRoot, env, ['--agent', 'unknown'], 'update-project')
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Invalid value/)
  assert.deepEqual(snapshot(projectRoot), before)
  assert.equal(existsSync(probe), false)
}))

test('shipped containment guards prohibit provisioning, bare launch, mandatory rules and grants', () => {
  const runtime = ['scripts/setup-codegraph.mjs', 'scripts/lib/codegraph-policy.mjs',
    'scripts/lib/mcp-registry.mjs', 'scripts/lib/setup-claude.mjs', 'scripts/lib/setup-github.mjs',
    'scripts/setup-project.mjs', 'scripts/update-project.mjs', 'src/commands/ccua/setup.js',
    'src/commands/ccua/agent/select.js', 'setup.sh']
  for (const file of runtime) {
    const text = read(file)
    assert.doesNotMatch(text, /@colbymchenry\/codegraph|codegraph --version|codegraph init|mandatory:\s*true/)
    assert.doesNotMatch(text, /(?:spawn(?:Sync)?|exec(?:Sync)?)\(\s*['"`]codegraph/)
  }
  for (const file of ['scripts/setup-codegraph.mjs', 'scripts/lib/codegraph-policy.mjs']) {
    assert.doesNotMatch(read(file).split('*/').slice(1).join('*/'), /child_process|fetch\(|https?:\/\//)
  }
  for (const dir of ['.claude/agents', '.github/agents']) {
    for (const name of readdirSync(join(root, dir))) {
      const text = read(`${dir}/${name}`)
      const frontmatter = text.split('---')[1]
      assert.doesNotMatch(frontmatter, /mcp__codegraph|codegraph/i)
      if (!name.startsWith('commerce-documentation-engineer')) assert.match(frontmatter, /Grep|search/)
    }
  }
  for (const file of ['CLAUDE.md', '.github/copilot-instructions.md',
    '.claude/skills/upgrade-uca-scan.md', '.github/skills/upgrade-uca-scan/SKILL.md',
    '.claude/agents/commerce-upgrade-analyst.md', '.github/agents/commerce-upgrade-analyst.agent.md',
    '.claude/commands/upgrade-hop.md', '.github/skills/upgrade-hop/SKILL.md',
    '.claude/commands/upgrade-hop-execute.md', '.github/skills/upgrade-hop-execute/SKILL.md']) {
    const text = read(file)
    assert.doesNotMatch(text, /CodeGraph-first|mcp__codegraph__codegraph_explore|Do not issue a separate Read|Do not.*`Read`.*`grep`/)
    assert.match(text, /direct.*read\/search|directly read\/search|direct project read\/search|direct source reads/i)
    assert.match(text, /UNTRUSTED/)
  }
  const settings = JSON.parse(read('.claude/settings.json'))
  assert.ok(settings.permissions.allow.length > 0)
  assert.ok(settings.permissions.allow.every(rule =>
    !/codegraph|composer|setup:upgrade|setup:install/.test(rule)))
  assert.ok(!settings.permissions.allow.includes('Bash'))
  assert.ok(!settings.permissions.allow.includes('Bash(bin/magento *)'))
  assert.equal(settings.enabledMcpjsonServers, undefined)
  assert.doesNotMatch(read('README.md'), /copilot mcp add codegraph|codegraph serve|codegraph init/)
  const pkg = JSON.parse(read('package.json'))
  assert.equal(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some((name) => /codegraph/i.test(name)), false)
  assert.doesNotMatch(read('package-lock.json'), /@colbymchenry\/codegraph/)
  for (const file of readdirSync(join(root, '.github/workflows'))) {
    assert.doesNotMatch(read(`.github/workflows/${file}`), /@colbymchenry\/codegraph|codegraph serve|codegraph init|codegraph --version/)
  }
})
