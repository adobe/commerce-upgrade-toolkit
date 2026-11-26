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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const oclif = require.resolve('@oclif/core')
const { name: packageName, version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const commands = ['upgrade-hop', 'upgrade-hop-execute', 'upgrade-deploy-prep', 'upgrade-assess']
const flavours = [['claude-code', '.claude'], ['github-copilot', '.github']]

function fixture(run) {
  const dir = mkdtempSync(join(root, '.ccua-functional-test-'))
  try {
    const project = join(dir, 'commerce-project')
    const bin = join(dir, 'bin')
    const home = join(dir, 'home')
    for (const path of [project, bin, home]) mkdirSync(path)
    const calls = join(dir, 'calls')
    for (const command of ['npm', 'npx', 'codegraph', 'claude', 'git']) {
      const body = command === 'npm'
        ? `if [ "$1" = view ] && [ "$2" = "${packageName}" ] && [ "$3" = version ]; then printf "${version}\\n"; exit 0; fi`
        : command === 'claude' || command === 'git'
          ? 'if [ "$1" = --version ]; then printf "test-cli 1.0.0\\n"; exit 0; fi'
          : ''
      writeFileSync(join(bin, command),
        `#!/bin/sh\nprintf "%s %s\\n" "${command}" "$*" >> "$CCUA_CALLS"\n${body}\nexit 97\n`,
        { mode: 0o755 })
    }
    writeFileSync(join(project, 'composer.json'), JSON.stringify({
      name: 'test/commerce-project',
      require: { 'magento/product-community-edition': '2.4.7' },
    }))
    mkdirSync(join(project, 'app/etc'), { recursive: true })
    writeFileSync(join(project, 'app/etc/env.php'), '<?php return ["testFixture" => true];\n')
    writeFileSync(join(project, '.gitignore'), '# Customer rules\ncustomer-cache/\n')
    const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CCUA_CALLS: calls }
    run({ dir, project, env })
    const invocations = existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : []
    assert.ok(invocations.every((line) => line === 'claude --version' ||
      line === 'git --version' || line === `npm view ${packageName} version`),
    `Unexpected external execution: ${invocations.join(', ')}`)
    assert.equal(readFileSync(join(project, 'app/etc/env.php'), 'utf8'),
      '<?php return ["testFixture" => true];\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function cli(project, env, command, args = [], { input, expectedStatus = 0 } = {}) {
  const runner = `require(${JSON.stringify(oclif)}).run(process.argv.slice(1), ${JSON.stringify(root)})
    .catch(error => { console.error(error.message); process.exitCode = 1 })`
  const result = spawnSync(process.execPath, ['-e', runner, command, ...args], {
    cwd: project, env, input, encoding: 'utf8', timeout: 30000,
  })
  assert.equal(result.status, expectedStatus, `${result.stderr}\n${result.stdout}`)
  return result
}

function workflowFile(agentDir, command) {
  return agentDir === '.claude' ? `${agentDir}/commands/${command}.md`
    : `${agentDir}/skills/${command}/SKILL.md`
}

function assertInstalled(project, agentDir) {
  for (const command of commands) {
    const relative = workflowFile(agentDir, command)
    assert.equal(readFileSync(join(project, relative), 'utf8'),
      readFileSync(join(root, relative), 'utf8'), `${command} installed intact`)
  }
  for (const script of ['normalize_uct.py', 'json_to_toon.py', 'research_url.py',
    'review_change_plan.py', 'inspect_changed_php.php', 'write-policy.json', 'anchored-fs.mjs']) {
    assert.equal(readFileSync(join(project, agentDir, 'scripts', script), 'utf8'),
      readFileSync(join(root, agentDir, 'scripts', script), 'utf8'))
  }
  assert.equal(readFileSync(join(project, agentDir, 'context/.ccua-version'), 'utf8'), `${version}\n`)
  assert.ok(existsSync(join(project, agentDir, 'agents')))
  assert.ok(existsSync(join(project, 'docs/security-migration.md')))
  assert.ok(existsSync(join(project, 'docs/upgrade-workflow.md')))
  assert.ok(readFileSync(join(project, '.gitignore'), 'utf8').includes('/.ccua/'))
  const guardrail = agentDir === '.claude' ? '.claude/guardrails/write-scope.md'
    : '.github/instructions/write-scope.instructions.md'
  assert.equal(readFileSync(join(project, guardrail), 'utf8'), readFileSync(join(root, guardrail), 'utf8'))
  assert.equal(existsSync(join(project, '.mcp.json')), false)
  assert.equal(existsSync(join(project, '.vscode/mcp.json')), false)
}

for (const [label, settings] of [
  ['empty hooks', { hooks: {} }],
  ['no hooks', { model: 'customer-fixture', custom: 'preserve' }],
  ['customer hooks', { hooks: { SessionStart: [{ hooks: [
    { type: 'command', command: 'customer-owned-hook --fixture-only' },
  ] }] }, permissions: { allow: ['Read'], deny: ['Bash'] } }],
  ['previous toolkit hook', { hooks: { SessionStart: [{ hooks: [
    { type: 'command', command: 'node .claude/hooks/check-toolkit-version.mjs' },
    { type: 'command', command: 'customer-owned-hook --fixture-only' },
  ] }] } }],
  ['missing settings', null],
]) {
  test(`Claude update preserves ${label} without provisioning command hooks`, () => fixture(({ project, env }) => {
    cli(project, env, 'ccua:setup', ['--agent', 'claude-code'])
    const file = join(project, '.claude/settings.json')
    const before = settings === null ? null : JSON.stringify(settings, null, 4) + '\n'
    if (before === null) rmSync(file)
    else writeFileSync(file, before)
    writeFileSync(join(project, '.claude/context/.ccua-version'), '0.0.0\n')
    const updated = cli(project, env, 'ccua:update', ['--agent', 'claude-code'])
    assert.match(updated.stdout, /Toolkit updated/)
    assert.equal(existsSync(file), before !== null)
    if (before !== null) assert.equal(readFileSync(file, 'utf8'), before)
    const repeated = cli(project, env, 'ccua:update', ['--agent', 'claude-code'])
    assert.match(repeated.stdout, /Already up to date/)
    assert.equal(existsSync(file), before !== null)
    if (before !== null) assert.equal(readFileSync(file, 'utf8'), before)
  }))
}

test('updater has no automatic hook merge or obsolete provisioning helper', () => {
  const updater = readFileSync(join(root, 'scripts/update-project.mjs'), 'utf8')
  assert.doesNotMatch(updater, /mergeSessionStartHook|hooks\.SessionStart|check-toolkit-version\.mjs/)
  assert.equal(existsSync(join(root, 'scripts/lib/merge-settings.mjs')), false)
})

test('container setup runner exposes tools-setup when the user has no passwd entry', () => {
  const dir = mkdtempSync(join(root, '.ccua-functional-test-'))
  try {
    const preload = join(dir, 'no-passwd.cjs')
    writeFileSync(preload, "require('node:os').userInfo = () => { throw new Error('no passwd entry') }\n")
    const env = { PATH: process.env.PATH, HOME: dir }
    const result = spawnSync(process.execPath, ['--require', preload,
      join(root, 'scripts/run-tools-setup.js'), '--help'], { env, encoding: 'utf8', timeout: 30000 })
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`)
    assert.match(result.stdout, /--agent/)
    assert.match(result.stdout, /--tools-version/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

for (const [, agentDir] of flavours) {
  test(`${agentDir} version notice checks the official package and recommends npm-backed setup`, () => fixture(({ project, env }) => {
    mkdirSync(join(project, agentDir, 'context'), { recursive: true })
    writeFileSync(join(project, agentDir, 'context/.ccua-version'), '0.0.0\n')
    const result = spawnSync(process.execPath, [join(root, agentDir, 'hooks/check-toolkit-version.mjs')], {
      cwd: project, env, encoding: 'utf8', timeout: 10000,
    })
    assert.equal(result.status, 0, result.stderr)
    const notice = JSON.parse(result.stdout)
    assert.match(notice.systemMessage, /aio commerce upgrade tools-setup/)
    assert.match(notice.hookSpecificOutput.additionalContext, /select the same agent/)
    const repeated = spawnSync(process.execPath, [join(root, agentDir, 'hooks/check-toolkit-version.mjs')], {
      cwd: project, env, encoding: 'utf8', timeout: 10000,
    })
    assert.equal(repeated.status, 0, repeated.stderr)
    assert.equal(repeated.stdout, '')
  }))
}

function checkIgnored(project, paths, initialize = false) {
  const git = (args, input) => spawnSync('git', ['-c', 'core.excludesFile=/dev/null', ...args], {
    cwd: project, env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    input, encoding: 'utf8', timeout: 10000,
  })
  if (initialize) {
    const initialized = git(['-c', 'init.templateDir=', 'init', '--quiet'])
    assert.equal(initialized.status, 0, initialized.stderr)
  }
  const result = git(['check-ignore', '--no-index', '--stdin'], paths.join('\n') + '\n')
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim().split('\n')
}

const privatePaths = ['.claude/context/.uct-capture-example/report.json',
  '.github/context/.uct-capture-example/stderr.log', '.ccua-reconcile-example/config.json',
  '.vscode/.ccua-reconcile-example/config.json', '.claude/.ccua-reconcile-example/config.json',
  '.ccua/audit-log.jsonl']
const managedPaths = ['.claude/context/upgrade-state.md', '.github/context/upgrade-state.md',
  '.claude/scripts/inspect_changed_php.php', '.github/skills/upgrade-hop/SKILL.md',
  'app/code/Vendor/Module/.ccua/source.php']

test('repository ignores private captures/staging without hiding managed upgrade assets', () => {
  assert.deepEqual(checkIgnored(root, [...privatePaths, ...managedPaths]), privatePaths)
})

for (const [choice, agentDir] of [
  ['\n', '.claude'],
  ['1\n', '.claude'],
  ['2\n', '.github'],
  [' Claude \n', '.claude'],
  [' COPILOT \n', '.github'],
]) {
  test(`CLI interactive selection accepts ${JSON.stringify(choice)}`, () => fixture(({ project, env }) => {
    const result = cli(project, env, 'ccua:agent:select', [], { input: choice })
    assert.match(result.stdout, /Which agent toolkit/)
    assert.match(result.stderr, /Enter 1 or 2/)
    assertInstalled(project, agentDir)
  }))
}

for (const [input, message] of [
  ['unknown\n', /Unrecognised choice/],
  ['', /No agent choice received/],
]) {
  test(`CLI interactive selection rejects ${JSON.stringify(input)} without installing`, () => fixture(({ project, env }) => {
    const result = cli(project, env, 'ccua:agent:select', [], { input, expectedStatus: 1 })
    assert.match(result.stderr, message)
    for (const [, agentDir] of flavours) assert.equal(existsSync(join(project, agentDir)), false)
  }))
}

for (const [agent, agentDir] of flavours) {
  test(`${agent} installer ignores real failed captures through reinstall and flavor switching`, () => fixture(({ project, env }) => {
    cli(project, env, 'ccua:setup', ['--agent', agent])
    const capture = spawnSync('python3', ['-B', `${agentDir}/scripts/capture_uct.py`, '--project-root', '.',
      '--agent', agent, '--mode', 'stdout', '--', process.execPath, '-e',
      'process.stdout.write(JSON.stringify({errors:[],warnings:[]})); process.stderr.write("private audit text"); process.exit(7)'],
      { cwd: project, env, encoding: 'utf8', timeout: 10000 })
    assert.equal(capture.status, 1)
    assert.doesNotMatch(capture.stdout + capture.stderr, /private audit text/)
    const captures = readdirSync(join(project, agentDir, 'context')).filter(name => /^\.uct-capture-[a-f0-9]{32}$/.test(name))
    assert.equal(captures.length, 1)
    const actual = [`${agentDir}/context/${captures[0]}/report.json`, `${agentDir}/context/${captures[0]}/stderr.log`]
    const ignored = [...privatePaths, ...actual]
    assert.deepEqual(checkIgnored(project, [...ignored, ...managedPaths], true), ignored)
    const other = agent === 'claude-code' ? 'github-copilot' : 'claude-code'
    for (const selected of [agent, other, agent]) {
      cli(project, env, 'ccua:setup', ['--agent', selected])
      assert.deepEqual(checkIgnored(project, [...ignored, ...managedPaths]), ignored)
      const ignore = readFileSync(join(project, '.gitignore'), 'utf8')
      assert.match(ignore, /customer-cache\//)
      assert.equal(ignore.split('# --- Adobe Commerce Upgrade Toolkit ---').length - 1, 1)
      assert.equal(readFileSync(join(project, actual[1]), 'utf8'), 'private audit text')
    }
  }))

  for (const [label, flags, installType, environment] of [
    ['default', [], '~', '~'],
    ['existing', ['--install-type', 'existing'], 'existing', '~'],
    ['fresh', ['--install-type', 'fresh', '--environment', 'warden'], 'fresh', 'warden'],
  ]) {
    test(`CLI dispatcher installs ${agent} with ${label} state and all main workflows`, () => fixture(({ project, env }) => {
      cli(project, env, 'ccua:setup', ['--agent', agent, ...flags])
      assertInstalled(project, agentDir)
      const state = readFileSync(join(project, agentDir, 'context/upgrade-state.md'), 'utf8')
      assert.match(state, new RegExp(`^installType: ${installType}$`, 'm'))
      assert.match(state, new RegExp(`^environment: ${environment}$`, 'm'))
      assert.match(readFileSync(join(project, '.gitignore'), 'utf8'), /customer-cache\//)
    }))
  }

  test(`CLI selection and updates preserve ${agent} progress and refresh managed workflows`, () => fixture(({ project, env }) => {
    cli(project, env, 'ccua:agent:select', ['--agent', agent, '--install-type', 'existing'])
    assertInstalled(project, agentDir)
    const instruction = agentDir === '.claude' ? 'CLAUDE.md' : '.github/copilot-instructions.md'
    const owned = {
      [instruction]: 'Customer instructions\n',
      [`${agentDir}/context/upgrade-state.md`]: 'installType: existing\nphase: fixing\ncompletedChunks: [1,2]\n',
      [`${agentDir}/context/upgrade-mcp-cache.json`]: '{"trust":"untrusted-candidate","customer":"preserve"}\n',
      [`${agentDir}/context/.ccua-last-notified`]: '1.0.0\n',
    }
    for (const [file, contents] of Object.entries(owned)) writeFileSync(join(project, file), contents)
    writeFileSync(join(project, agentDir, 'context/.ccua-version'), '0.0.0\n')
    writeFileSync(join(project, workflowFile(agentDir, 'upgrade-hop')), 'Outdated workflow\n')
    writeFileSync(join(project, agentDir, 'scripts/stale-managed.mjs'), 'obsolete\n')

    const updated = cli(project, env, 'ccua:update')
    assert.match(updated.stdout, /Toolkit updated/)
    assertInstalled(project, agentDir)
    assert.equal(existsSync(join(project, agentDir, 'scripts/stale-managed.mjs')), false)
    for (const [file, contents] of Object.entries(owned)) {
      assert.equal(readFileSync(join(project, file), 'utf8'), contents)
    }
    const repeat = cli(project, env, 'ccua:update', ['--agent', agent])
    assert.match(repeat.stdout, /Already up to date/)
    for (const [file, contents] of Object.entries(owned)) {
      assert.equal(readFileSync(join(project, file), 'utf8'), contents)
    }
    cli(project, env, 'ccua:setup', ['--agent', agent])
    for (const [file, contents] of Object.entries(owned)) {
      assert.equal(readFileSync(join(project, file), 'utf8'), contents)
    }
    assert.equal(readFileSync(join(project, '.gitignore'), 'utf8')
      .split('# --- Adobe Commerce Upgrade Toolkit ---').length - 1, 1)
  }))

  for (const targetVersion of ['2.4.8', '2.4.9', '2.4.9-p1']) {
    test(`installed ${agent} fixture pipeline accepts target ${targetVersion} without MCP`, () => fixture(({ project, env }) => {
      cli(project, env, 'ccua:setup', ['--agent', agent])
      const file = 'app/code/Test/Plugin.php'
      mkdirSync(join(project, 'app/code/Test'), { recursive: true })
      writeFileSync(join(project, file), '<?php // Documented UCT fixture source\n')
      const context = `${agentDir}/context`
      const raw = `${context}/upgrade-findings.json`
      const normalized = `${context}/upgrade-findings.normalized.json`
      const evidence = `${context}/upgrade-findings.quarantine.json`
      const toon = `${context}/upgrade-findings.toon`
      const report = {
        errors: [{
          code: 'MC-43', type: 'PLUGIN_INTERSECTION', file, line: 1,
          message: 'Method Magento\\Catalog\\Model\\Product::getUrlKey() was removed',
        }],
        warnings: [],
      }
      const python = (script, args) => spawnSync('python3', [`${agentDir}/scripts/${script}`, ...args],
        { cwd: project, env, encoding: 'utf8', timeout: 10000 })
      const captured = python('capture_uct.py', ['--project-root', '.', '--agent', agent,
        '--mode', 'stdout', '--', process.execPath, '-e', 'process.stdout.write(process.argv[1])',
        '--', JSON.stringify(report)])
      assert.equal(captured.status, 0, captured.stderr)
      assert.equal(readFileSync(join(project, raw), 'utf8'), JSON.stringify(report))
      assert.equal(existsSync(join(project, agentDir, 'scripts/__pycache__')), false)
      const normalizedResult = python('normalize_uct.py', [
        raw, normalized, evidence, '--project-root', '.', '--target-version', targetVersion,
      ])
      assert.equal(normalizedResult.status, 0, normalizedResult.stderr)
      const data = JSON.parse(readFileSync(join(project, normalized), 'utf8'))
      assert.equal(data.targetVersion, targetVersion)
      assert.deepEqual(data.counts, { accepted: 1, quarantined: 0, total: 1 })
      assert.equal(data.accepted[0].symbol, 'Magento\\Catalog\\Model\\Product::getUrlKey')
      assert.equal(readFileSync(join(project, data.accepted[0].file), 'utf8'),
        '<?php // Documented UCT fixture source\n')
      const converted = python('json_to_toon.py', [normalized, toon])
      assert.equal(converted.status, 0, converted.stderr)
      assert.match(readFileSync(join(project, toon), 'utf8'), /PLUGIN_INTERSECTION/)
      const validated = python('research_url.py', ['validate', 'https://developer.adobe.com/commerce/php/tutorials/'])
      assert.equal(validated.status, 0, validated.stderr)

      report.errors[0].code = 'UNSUPPORTED'
      writeFileSync(join(project, raw), JSON.stringify(report))
      const blocked = python('normalize_uct.py', [
        raw, normalized, evidence, '--project-root', '.', '--target-version', targetVersion,
      ])
      assert.equal(blocked.status, 2, 'unsupported UCT findings must block, not disappear')
      assert.equal(JSON.parse(readFileSync(join(project, normalized), 'utf8')).blocked, true)
    }))
  }

  test(`installed ${agent} fixture pipeline normalizes UCT 3.x {issues, stats} reports strictly`, () => fixture(({ project, env }) => {
    cli(project, env, 'ccua:setup', ['--agent', agent])
    const file = 'app/code/Test/Model/Publisher.php'
    mkdirSync(join(project, 'app/code/Test/Model'), { recursive: true })
    writeFileSync(join(project, file), '<?php // UCT 3 fixture source\n')
    const context = `${agentDir}/context`
    const raw = `${context}/upgrade-findings.json`
    const normalized = `${context}/upgrade-findings.normalized.json`
    const evidence = `${context}/upgrade-findings.quarantine.json`
    const issue = (code, message, extra = {}) => ({
      lineNumber: 3, level: 'CRITICAL', message, code, fileName: join(realpathSync(project), file),
      validationType: 'php', ...extra,
    })
    const report = {
      issues: [
        issue(1114, "Using class 'Magento\\Framework\\Stomp\\Connection\\Factory' that does not exist on version '2.4.8'"),
        issue(1134, "Using class 'Magento\\Foo\\Bar' that is @deprecated on version '2.4.8' use Baz instead", { level: 'WARNING' }),
      ],
      stats: { currentVersion: '2.4.6', targetVersion: '2.4.8', critical: 1, errors: 0, warnings: 1 },
    }
    const python = (script, args) => spawnSync('python3', [`${agentDir}/scripts/${script}`, ...args],
      { cwd: project, env, encoding: 'utf8', timeout: 10000 })
    const run = (target = '2.4.8') => python('normalize_uct.py', [
      raw, normalized, evidence, '--project-root', '.', '--target-version', target])
    const capture = () => python('capture_uct.py', ['--project-root', '.', '--agent', agent,
      '--mode', 'stdout', '--', process.execPath, '-e', 'process.stdout.write(process.argv[1])',
      '--', JSON.stringify(report)])
    assert.equal(capture().status, 0)
    assert.equal(capture().status, 0, 'a previous UCT 3.x raw report is a recognized overwrite target')
    const accepted = run()
    assert.equal(accepted.status, 0, accepted.stderr)
    assert.match(accepted.stdout, /"rawIssueCount": 2/)
    const data = JSON.parse(readFileSync(join(project, normalized), 'utf8'))
    assert.deepEqual(data.counts, { accepted: 2, quarantined: 0, total: 2 })
    assert.deepEqual(data.accepted.map(({ file, code, type, severity, symbol }) => [file, code, type, severity, symbol]), [
      [file, '1114', 'UCT3_PHP', 'error', 'Magento\\Framework\\Stomp\\Connection\\Factory'],
      [file, '1134', 'UCT3_PHP', 'warning', 'Magento\\Foo\\Bar'],
    ])

    const blockers = [
      issue(5087, 'Private methods should not be declared as final since PHP 8.0'),
      issue(1114, "Using class 'Magento\\Foo' that does not exist on version '2.4.8'", { fileName: '/etc/passwd' }),
      issue(1114, "Using class 'A\\B; DROP' that does not exist on version '2.4.8'"),
      issue(1114, "Using class 'A\\B' that does not exist on version '2.4.8'", { fileName: `${join(realpathSync(project), file)}/../../../.env` }),
      issue(1114, "Using class 'A\\B' that does not exist on version '2.4.8'", { extra: 'x' }),
      issue(1114, "Using class 'A\\B' that does not exist on version '2.4.8'", { level: 'INFO' }),
    ]
    writeFileSync(join(project, raw), JSON.stringify({ ...report, issues: blockers }))
    const blocked = run()
    assert.equal(blocked.status, 2, 'unsupported UCT 3.x findings must block, not disappear')
    const blockedData = JSON.parse(readFileSync(join(project, normalized), 'utf8'))
    assert.deepEqual(blockedData.counts, { accepted: 0, quarantined: blockers.length, total: blockers.length })

    writeFileSync(join(project, raw), JSON.stringify(report))
    assert.equal(run('2.4.9').status, 2, 'a conflicting stats.targetVersion must block')
  }))
}

test('npm distribution includes every runtime dependency file and workflow asset', () => fixture(({ dir, env }) => {
  const args = ['pack', '--dry-run', '--ignore-scripts', '--json']
  const result = spawnSync(process.env.npm_execpath ? process.execPath : 'npm',
    process.env.npm_execpath ? [process.env.npm_execpath, ...args] : args, {
    cwd: root, env: { ...env, PATH: process.env.PATH, npm_config_cache: join(dir, 'npm-cache') },
    encoding: 'utf8', timeout: 30000,
  })
  assert.equal(result.status, 0, result.stderr)
  const files = new Set(JSON.parse(result.stdout)[0].files.map(({ path }) => path))
  for (const path of ['scripts/lib/codegraph-policy.mjs', 'scripts/setup-project.mjs',
    'scripts/update-project.mjs', 'src/commands/ccua/setup.js', 'src/commands/ccua/agent/select.js',
    'src/commands/ccua/update.js', 'docs/security-migration.md', 'CLAUDE.md']) {
    assert.ok(files.has(path), `Missing packaged runtime file: ${path}`)
  }
  for (const [, agentDir] of flavours) {
    for (const command of commands) assert.ok(files.has(workflowFile(agentDir, command)))
    for (const script of ['normalize_uct.py', 'json_to_toon.py', 'research_url.py']) {
      assert.ok(files.has(`${agentDir}/scripts/${script}`))
    }
  }
  assert.ok(![...files].some((path) => path.includes('.ccua-functional-test-')))
}))

test('upgrade-hop lets the user choose the hop strategy and records it unset until chosen', () => {
  const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')
  for (const [command, state] of [['.claude/commands/upgrade-hop.md', '.claude/context/upgrade-state.md'],
    ['.github/skills/upgrade-hop/SKILL.md', '.github/context/upgrade-state.md']]) {
    const text = read(command)
    for (const option of ['`risk-based`', '`single-hop`', '`every-minor`']) assert.ok(text.includes(option), option)
    assert.match(text, /never choose for the user/)
    assert.match(text, /a single hop never waives an infrastructure floor/)
    assert.match(text, /never authorizes execution/)
    assert.match(read(state), /^hopStrategy: ~$/m)
  }
})

test('guided next steps is a user selection that acts on the choice without granting approval', () => {
  const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')
  for (const [hop, assess, agent] of [
    ['.claude/commands/upgrade-hop.md', '.claude/commands/upgrade-assess.md', 'claude-code'],
    ['.github/skills/upgrade-hop/SKILL.md', '.github/skills/upgrade-assess/SKILL.md', 'github-copilot']]) {
    const text = read(hop)
    assert.ok(text.includes(`assess_tools.mjs next-steps . --agent ${agent}`))
    assert.match(text, /decision point, not a printout/)
    assert.match(text, /structured \*\*multi-select\*\* question/)
    assert.match(text, /never pre-select or\s+choose for the user/)
    for (const invoke of ['show-cleanup-commands', 'planning-mode', 'strategy-question', 'uct-prerequisite-probe', 'analysis-mode', 'intake']) {
      assert.ok(text.includes('`' + invoke + '`'), invoke)
    }
    assert.match(text, /It is \*\*not\*\* approval/)
    assert.match(text, /never executed by an agent/)
    assert.match(text, /built by hand/)
    assert.match(read(assess), /What would you like to do\s+now\?/)
  }
})

test('write-scope defines the single approval wording and both commands point to it', () => {
  const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')
  for (const [scope, hop, assess] of [
    ['.claude/guardrails/write-scope.md', '.claude/commands/upgrade-hop.md', '.claude/commands/upgrade-assess.md'],
    ['.github/instructions/write-scope.instructions.md', '.github/skills/upgrade-hop/SKILL.md', '.github/skills/upgrade-assess/SKILL.md']]) {
    const text = read(scope)
    assert.match(text, /Required approval wording/)
    for (const item of ['exact instance', 'version pair', 'routine commands', 'ambient developer mounts', 'local/dev non-production', 'files this run will write']) {
      assert.ok(text.includes(item), item)
    }
    assert.match(text, /not chained with/)
    assert.match(text, /status helper, until this approval/)
    assert.match(text, /`assess_tools\.mjs next-steps` status helper/)
    assert.match(read(hop), /Required approval wording/)
    assert.match(read(assess), /Required approval\s+wording/)
  }
})
