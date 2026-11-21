/*
Copyright 2026 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0.
SPDX-License-Identifier: Apache-2.0
*/

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diffUct, classifyPatch, suggestComplexity, rollup, validate, isSensitivePath, satisfies, customModuleEvidence, patchEvidence } from '../.claude/scripts/assess_tools.mjs'

const f = (over = {}) => ({ code: 'MC-1', type: 'critical', file: 'a.php', line: 1, message: 'removed', ...over })

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
