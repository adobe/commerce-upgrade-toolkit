/*
Copyright 2026 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0.
SPDX-License-Identifier: Apache-2.0
*/

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diffUct, classifyPatch, suggestComplexity, rollup, validate, isSensitivePath, satisfies, customModuleEvidence, patchEvidence, uctPrerequisite, nextSteps } from '../.claude/scripts/assess_tools.mjs'

const f = (over = {}) => ({ code: 'MC-1', type: 'critical', file: 'a.php', line: 1,
  symbol: 'Magento\\Example\\Model::removedMethod', message: 'removed', ...over })

test('UCT prerequisites accept verified installed modes but do not declare a scan clean', () => {
  for (const [probe, mode] of [
    [{ inProjectExitCode: 0 }, 'in-project'],
    [{ inProjectExitCode: 1, composerExitCode: 0 }, 'composer'],
    [{ inProjectExitCode: 1, standaloneExitCode: 0 }, 'standalone-fallback']
  ]) {
    const result = uctPrerequisite(probe)
    assert.equal(result.status, 'available')
    assert.equal(result.mode, mode)
    assert.equal(result.scanAllowed, true)
    assert.equal(result.incompleteReportAllowed, false)
    assert.match(result.reason, /scan and normalization results are still required/)
  }
});

test('missing, declined and failed UCT require an explicit incomplete-report decision', () => {
  for (const [installationOutcome, status] of [
    ['not-attempted', 'missing'], ['declined', 'declined'],
    ['failed', 'failed'], ['completed', 'failed']
  ]) {
    const input = { inProjectExitCode: 1, standaloneExitCode: 1, installationOutcome }
    const paused = uctPrerequisite(input)
    assert.equal(paused.status, status)
    assert.equal(paused.scanAllowed, false)
    assert.equal(paused.mode, null)
    assert.equal(paused.incompleteReportAllowed, false)
    const incomplete = uctPrerequisite({ ...input, continueIncomplete: true })
    assert.equal(incomplete.scanAllowed, false)
    assert.equal(incomplete.incompleteReportAllowed, true)
    assert.ok(incomplete.reason)
  }
  assert.equal(uctPrerequisite().status, 'missing', 'unrun probes do not prove availability')
  assert.equal(uctPrerequisite({ standaloneExitCode: 0, installationOutcome: 'completed' }).status,
    'available', 'human installation must be reverified')
  const external = uctPrerequisite({ inProjectExitCode: 1, standaloneExitCode: 255, externalRunnerExitCode: 0 })
  assert.equal(external.mode, 'external-runner')
  assert.equal(external.scanAllowed, true)
  assert.equal(uctPrerequisite({ inProjectExitCode: 0, externalRunnerExitCode: 0 }).mode, 'in-project')
  assert.throws(() => uctPrerequisite({ externalRunnerExitCode: '0' }), /exit codes/)
  assert.throws(() => uctPrerequisite({ inProjectExitCode: true }), /exit codes/)
  assert.throws(() => uctPrerequisite({ composerExitCode: '0' }), /exit codes/)
  assert.throws(() => uctPrerequisite({ continueIncomplete: 'yes' }), /incomplete-report decision/)
});

test('UCT probe execution failures do not suggest reinstalling a missing tool', () => {
  const result = uctPrerequisite({ inProjectExitCode: 1, composerExitCode: 1,
    standaloneExitCode: 1, probeFailure: 'execution-failed', continueIncomplete: true })
  assert.equal(result.status, 'execution-failed')
  assert.equal(result.scanAllowed, false)
  assert.equal(result.incompleteReportAllowed, true)
  assert.match(result.reason, /repair the PHP\/environment\/access failure/)
  assert.equal(uctPrerequisite({ composerExitCode: 0, probeFailure: 'execution-failed' }).status,
    'available', 'one working executable avoids unnecessary installation')
  assert.throws(() => uctPrerequisite({ probeFailure: 'guess' }), /invalid UCT/)
});

test('UCT prerequisite CLI classifies live evidence without modifying project dependencies', () => {
  const root = mkdtempSync(join(tmpdir(), 'uct-prerequisite-'))
  const helper = new URL('../.claude/scripts/assess_tools.mjs', import.meta.url)
  try {
    const composer = join(root, 'composer.json'), lock = join(root, 'composer.lock')
    writeFileSync(composer, '{"require":{"magento/product-enterprise-edition":"2.4.8-p5"}}')
    writeFileSync(lock, '{"packages":[]}')
    const before = [readFileSync(composer, 'utf8'), readFileSync(lock, 'utf8')]
    const probes = join(root, 'probes.json')
    for (const installationOutcome of ['not-attempted', 'declined', 'failed']) {
      writeFileSync(probes, JSON.stringify({ inProjectExitCode: 1, standaloneExitCode: null,
        installationOutcome, continueIncomplete: true }))
      const result = spawnSync(process.execPath, [fileURLToPath(helper), 'uct-prerequisite', probes],
        { cwd: root, encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
      const evidence = JSON.parse(result.stdout)
      assert.equal(evidence.scanAllowed, false)
      assert.equal(evidence.incompleteReportAllowed, true)
      assert.deepEqual([readFileSync(composer, 'utf8'), readFileSync(lock, 'utf8')], before)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
});

test('diffUct ignores line shifts and keeps only target-introduced findings', () => {
  const result = diffUct([f({ line: 5 })], [f({ line: 9 }), f({ file: 'b.php' })])
  assert.equal(result.introducedCount, 1)
  assert.equal(result.introduced[0].file, 'b.php')
  assert.equal(result.resolvedCount, 0)
})

test('diffUct reports resolved findings and respects duplicates', () => {
  const result = diffUct([f(), f()], [f()])
  assert.equal(result.resolvedCount, 1)
  assert.equal(result.introducedCount, 0)
})

test('diffUct uses code, file and strict symbol, not wording or classification', () => {
  const result = diffUct([f()], [f({ line: 99, type: 'renamed-classification',
    message: 'different wording' }), f({ symbol: 'Magento\\Example\\Model::anotherMethod' })])
  assert.equal(result.introducedCount, 1)
  assert.equal(result.introduced[0].symbol, 'Magento\\Example\\Model::anotherMethod')
  assert.equal(result.resolvedCount, 0)
  for (const change of [{ code: 'MC-2' }, { file: 'other.php' }]) {
    const changed = diffUct([f()], [f(change)])
    assert.equal(changed.introducedCount, 1)
    assert.equal(changed.resolvedCount, 1)
  }
})

test('diffUct rejects raw or malformed identity fields instead of matching undefined symbols', () => {
  for (const value of [null, [], f({ symbol: undefined }), f({ symbol: 'Class::method(); run()' }),
    f({ file: '../a.php' }), f({ file: '/a.php' }), f({ code: '' })]) {
    assert.throws(() => diffUct([value], []), /normalized code/)
    assert.throws(() => diffUct([], [value]), /normalized code/)
  }
  assert.equal(diffUct([], []).introducedCount, 0)
})

test('suggestComplexity follows the High/Medium/Small rules', () => {
  assert.equal(suggestComplexity({}).level, 'Small')
  assert.equal(suggestComplexity({ businessLogic: true }).level, 'Medium')
  assert.equal(suggestComplexity({ businessLogic: true, schemaChange: true }).level, 'High')
  assert.equal(suggestComplexity({ integration: true }).level, 'High')
  assert.equal(suggestComplexity({ sensitive: true }).level, 'High')
  assert.equal(suggestComplexity({ evidence: false }).level, 'UNKNOWN')
})

test('isSensitivePath flags payment and auth code', () => {
  assert.equal(isSensitivePath('app/code/Acme/Payment/Model/X.php'), true)
  assert.equal(isSensitivePath('app/code/Acme/Banner/Model/X.php'), false)
})

const doc = () => ({
  schemaVersion: 1,
  project: {},
  versions: {},
  complexity: { small: 1, medium: 0, high: 0, unknown: 0 },
  gaps: [],
  sections: Object.fromEntries(['phpCompatibility', 'commerceCompatibility', 'services', 'core', 'thirdParty',
    'customModules', 'patches', 'composer', 'delivery'].map((k) => [k, {}]))
})

test('validate accepts a consistent document and rollup counts rows', () => {
  const d = doc()
  d.sections.customModules.rows = [{ complexity: 'Small', reason: 'mechanical' }]
  assert.deepEqual(validate(d), [])
  assert.equal(rollup(d).counts.small, 1)
})

test('validate rejects effort figures, bad enums, unreasoned and mismatched ratings', () => {
  const d = doc()
  d.sections.patches.rows = [{ complexity: 'Huge', action: 'NOPE' }]
  d.sections.delivery.sprints = 3
  d.complexity.small = 4
  const errors = validate(d).join('\n')
  assert.match(errors, /complexity must be one of/)
  assert.match(errors, /action must be one of/)
  assert.match(errors, /reason is required/)
  assert.match(errors, /effort\/duration figures/)
  assert.match(errors, /complexity\.small/)
})

test('validate requires gaps for UNKNOWN rows', () => {
  const d = doc()
  d.complexity = { small: 0, medium: 0, high: 0, unknown: 1 }
  d.sections.thirdParty.rows = [{ complexity: 'UNKNOWN', reason: 'no vendor data', decision: 'REVIEW' }]
  assert.match(validate(d).join('\n'), /gaps is empty/)
})

test('incomplete UCT assessments validate only with explicit gaps and unavailable evidence', () => {
  const d = doc()
  d.complexity.small = 0
  d.sections.commerceCompatibility = {
    status: 'not-assessed', reason: 'UCT installation declined; install manually and rerun',
    baselineRun: null, targetRun: null, differentialRows: [], debtCategories: [],
    quarantineCount: null
  }
  d.gaps = ['UCT: Not assessed; human-run installation declined']
  assert.deepEqual(validate(d), [])
  d.sections.commerceCompatibility.quarantineCount = 0
  assert.match(validate(d).join('\n'), /null run\/count evidence/)
  d.sections.commerceCompatibility.quarantineCount = null
  d.sections.commerceCompatibility.targetRun = 'old-scan.json'
  assert.match(validate(d).join('\n'), /null run\/count evidence/)
  d.sections.commerceCompatibility.targetRun = null
  d.gaps = []
  assert.match(validate(d).join('\n'), /UCT is Not assessed but gaps is empty/)
});

test('assessed UCT requires both scans and retains quarantine evidence gaps', () => {
  const d = doc()
  d.complexity.small = 0
  d.sections.commerceCompatibility = {
    status: 'assessed', baselineRun: 'baseline-normalized.json', targetRun: 'target-normalized.json',
    differentialRows: [], quarantineCount: 1
  }
  assert.match(validate(d).join('\n'), /quarantine blockers require gaps/)
  d.gaps = ['UCT: one quarantined finding needs review']
  assert.deepEqual(validate(d), [])
  d.sections.commerceCompatibility.baselineRun = null
  assert.match(validate(d).join('\n'), /requires both run references/)
});

test('single-scan UCT mode needs only a target run and rejects a baseline reference', () => {
  const d = doc()
  d.complexity.small = 0
  d.sections.commerceCompatibility = {
    status: 'assessed', scanMode: 'ignore-current-flag', baselineRun: null,
    targetRun: 'target-normalized.json', differentialRows: [], quarantineCount: 0
  }
  assert.deepEqual(validate(d), [])
  d.sections.commerceCompatibility.baselineRun = 'baseline-normalized.json'
  assert.match(validate(d).join('\n'), /ignore-current-flag mode requires a null baselineRun/)
  d.sections.commerceCompatibility.baselineRun = null
  d.sections.commerceCompatibility.targetRun = null
  assert.match(validate(d).join('\n'), /ignore-current-flag mode requires/)
  d.sections.commerceCompatibility.scanMode = 'guess'
  assert.match(validate(d).join('\n'), /scanMode must be one of/)
});

test('both agent flavors gate scan reports without adding UCT to roadmap planning', () => {
  const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')
  for (const prefix of ['.claude', '.github']) {
    const command = name => prefix === '.claude'
      ? `${prefix}/commands/${name}.md` : `${prefix}/skills/${name}/SKILL.md`
    const skill = prefix === '.claude' ? '.claude/skills/uct-install.md'
      : '.github/skills/uct-install/SKILL.md'
    const assess = read(command('upgrade-assess'))
    assert.ok(assess.indexOf('### Step 0a: UCT prerequisite') < assess.indexOf('## Step 2: Collect evidence'))
    assert.match(assess, /never install dependencies in this command/)
    assert.match(assess, /quarantineCount: null/)
    const hop = read(command('upgrade-hop'))
    const analysis = hop.split('## ANALYSIS MODE')[1]
    assert.ok(analysis.indexOf('**UCT prerequisite') < analysis.indexOf('Apply the `upgrade-uca-scan`'))
    assert.doesNotMatch(hop.split('## ANALYSIS MODE')[0], /Assessment prerequisite|uctPrerequisite/)
    assert.match(analysis, /Leave the hop unanalysed/)
    assert.match(analysis, /Do not mark an incomplete hop analysed/)
    assert.doesNotMatch(analysis, /skill to install and run the scan|falls back automatically to a\nstandalone install/)
    assert.match(read(command('upgrade-hop-execute')), /currentHop\.uctAssessment\.status.*`not-assessed`/)
    assert.match(read(skill), /human-run installation procedure/)
    assert.match(read(skill), /Set `continueIncomplete: true` only after that explicit live choice/)
    assert.match(read(skill), /php vendor\/bin\/uct --version/)
    assert.match(read(skill), /composerExitCode/)
    assert.match(read(skill), /UCT is required for a completed compatibility assessment\. Choose:/)
    for (const failure of ['execution-failed', 'normalization-unsupported']) {
      assert.ok(read(skill).includes(failure))
      assert.ok(assess.includes(failure))
      assert.ok(analysis.includes(failure))
    }
  }
});

test('classifyPatch triages patches and never guesses when evidence is missing', () => {
  assert.equal(classifyPatch({ fixedUpstream: true }).action, 'DROP')
  assert.equal(classifyPatch({ type: 'cloud' }).action, 'UPGRADE_PACKAGE')
  assert.equal(classifyPatch({ fixedUpstream: false, applies: 'offset' }).action, 'KEEP_AND_REBASE')
  assert.equal(classifyPatch({ fixedUpstream: false, applies: false }).action, 'REWORK')
  assert.equal(classifyPatch({ vendorReleaseHasFix: true }).action, 'REPLACE_WITH_VENDOR_RELEASE')
  assert.equal(classifyPatch({}).action, 'REVIEW')
})

test('satisfies evaluates composer PHP constraints and never guesses', () => {
  assert.equal(satisfies('~8.1.0||~8.2.0||~8.3.0', '8.5.0'), false)
  assert.equal(satisfies('>=7.3', '8.5.0'), true)
  assert.equal(satisfies('^8.1', '8.5.0'), true)
  assert.equal(satisfies('~5.5.0|~5.6.0|>=7.0.0', '8.5.0'), true)
  assert.equal(satisfies('8.4.*', '8.5.0'), false)
  assert.equal(satisfies('dev-master', '8.5.0'), null)
  assert.equal(satisfies('', '8.5.0'), null)
})

test('customModuleEvidence derives purpose and required-by from module structure', () => {
  const root = mkdtempSync(join(tmpdir(), 'cm-'))
  const mk = (v, m, seq) => {
    mkdirSync(join(root, 'app/code', v, m, 'etc'), { recursive: true })
    mkdirSync(join(root, 'app/code', v, m, 'Plugin'))
    const dep = seq ? `<sequence><module name="${seq}"/></sequence>` : ''
    writeFileSync(join(root, 'app/code', v, m, 'etc/module.xml'), `<config><module name="${v}_${m}" setup_version="1.0.0">${dep}</module></config>`)
  }
  mk('Acme', 'Base')
  mk('Acme', 'Child', 'Acme_Base')
  const rows = customModuleEvidence(root)
  const base = rows.find((r) => r.module === 'Acme_Base')
  assert.match(base.required, /^Yes - required by Acme_Child/)
  assert.match(base.purpose, /plugins/)
  assert.match(rows.find((r) => r.module === 'Acme_Child').required, /^Client to confirm/)
})

test('patchEvidence drops catalog patches whose range excludes the target and keeps hotfixes for dry-run', () => {
  const root = mkdtempSync(join(tmpdir(), 'pt-'))
  mkdirSync(join(root, 'vendor/magento/quality-patches'), { recursive: true })
  mkdirSync(join(root, 'm2-hotfixes'))
  writeFileSync(join(root, '.magento.env.yaml'), 'stage:\n  build:\n    QUALITY_PATCHES:\n      - ACSD-1\n      - ACSD-2\n')
  writeFileSync(join(root, 'vendor/magento/quality-patches/support-patches.json'), JSON.stringify({
    'ACSD-1': { title: 'Old fix', packages: { 'magento/magento2-base': { '>=2.4.0 <2.4.6': { file: 'x' } } } },
    'ACSD-2': { title: 'Current fix', packages: { 'magento/magento2-base': { '>=2.4.5': { file: 'y' } } } }
  }))
  writeFileSync(join(root, 'm2-hotfixes/CUSTOM-X.patch'), '--- a/vendor/acme/mod/A.php\n+++ b/vendor/acme/mod/A.php\n')
  const { rows } = patchEvidence(root, { target: '2.4.9' })
  assert.equal(rows.find((r) => r.patch === 'ACSD-1').verdict, 'DROP')
  assert.equal(rows.find((r) => r.patch === 'ACSD-2').verdict, 'KEEP')
  const hot = rows.find((r) => r.patch === 'CUSTOM-X.patch')
  assert.equal(hot.verdict, 'REVIEW')
  assert.match(hot.appliesToTarget, /Dry-run required/)
  assert.match(hot.targetPackage, /acme\/mod/)
})

test('next-steps reports stale files, unset choices and UCT state, and only proposes actions', () => {
  const root = mkdtempSync(join(tmpdir(), 'next-steps-'))
  const home = mkdtempSync(join(tmpdir(), 'next-steps-home-'))
  try {
    const project = join(root, 'shop')
    mkdirSync(join(project, '.github/context'), { recursive: true })
    mkdirSync(join(project, 'context'), { recursive: true })
    mkdirSync(join(project, '.ccua/review'), { recursive: true })
    writeFileSync(join(project, '.github/context/.ccua-version'), '1.0.10')
    writeFileSync(join(project, '.github/context/upgrade-state.md'), 'fromVersion: ~\nphase: new\nhopStrategy: ~\n')
    writeFileSync(join(project, 'context/upgrade-state.md'), 'fromVersion: 2.4.4\n')
    mkdirSync(join(project, '.github/context/.uct-capture-' + 'a'.repeat(32)))
    const first = nextSteps(project, { home })
    assert.equal(first.agent, 'github-copilot')
    assert.equal(first.next.id, 'cleanup')
    const status = Object.fromEntries(first.steps.map((s) => [s.id, s.status]))
    assert.equal(status.plan, 'todo')
    assert.equal(status['hop-strategy'], 'todo')
    assert.equal(status.uct, 'todo')
    assert.match(first.steps.find((s) => s.id === 'uct').action, /Step 3b/)
    const byId = Object.fromEntries(first.options.map((o) => [o.id, o]))
    assert.equal(byId.cleanup.mode, 'human')
    assert.ok(byId.cleanup.humanCommands.some((c) => c === 'mv context/upgrade-state.md /tmp/ccua-old-upgrade-state.md'))
    assert.ok(byId.cleanup.humanCommands.some((c) => /^rm -rf \.github\/context\/\.uct-capture-a{32}$/.test(c)))
    assert.equal(byId.plan.mode, 'agent')
    assert.equal(byId.plan.invoke, 'planning-mode')
    assert.equal(byId['hop-strategy'].mode, 'decision')
    assert.equal(byId.uct.invoke, 'uct-prerequisite-probe')
    assert.ok(!first.options.some((o) => o.mode === 'agent' && o.id === 'cleanup'), 'cleanup is never agent-run')

    mkdirSync(join(home, '.claude/tools/uct-standalone/shop/bin'), { recursive: true })
    writeFileSync(join(home, '.claude/tools/uct-standalone/shop/bin/uct'), '')
    assert.match(nextSteps(project, { home }).steps.find((s) => s.id === 'uct').title, /external PHP 8.4 runner/)

    writeFileSync(join(project, '.ccua/review/uct-prerequisite.json'), JSON.stringify({ externalRunnerExitCode: 0 }))
    rmSync(join(project, 'context'), { recursive: true })
    rmSync(join(project, '.github/context/.uct-capture-' + 'a'.repeat(32)), { recursive: true })
    writeFileSync(join(project, '.github/context/upgrade-state.md'),
      'fromVersion: 2.4.4-p9\ntoVersion: 2.4.9\nimplementationType: luma\nphase: planned\nhopStrategy: single-hop\n')
    const clean = nextSteps(project, { home })
    assert.equal(clean.steps.find((s) => s.id === 'cleanup').status, 'done')
    assert.equal(clean.steps.find((s) => s.id === 'uct').title, 'UCT verified (external-runner)')
    assert.equal(clean.next.id, 'scan')
    assert.deepEqual(clean.options.map((o) => o.id), ['scan'])
    assert.equal(clean.options[0].target, '2.4.9')
    assert.throws(() => nextSteps(join(root, 'missing')), /flavour/)
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) }
})
