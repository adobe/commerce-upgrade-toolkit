/*
Copyright 2026 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0.
SPDX-License-Identifier: Apache-2.0
*/

import test from 'node:test'
import assert from 'node:assert/strict'
import { diffUct, classifyPatch, suggestComplexity, rollup, validate, isSensitivePath } from '../.claude/scripts/assess_tools.mjs'

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
