/*
Copyright 2026 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0.
SPDX-License-Identifier: Apache-2.0
*/

import test from 'node:test'
import assert from 'node:assert/strict'
import { parseArgs, findChrome } from '../scripts/export-assessment.mjs'

test('parseArgs requires an input and rejects unknown options', () => {
  assert.deepEqual(parseArgs(['--html', 'a.html', '--out-dir', 'o']), { html: 'a.html', 'out-dir': 'o' })
  assert.throws(() => parseArgs([]), /provide --html/)
  assert.throws(() => parseArgs(['--exec', 'x']), /unknown or incomplete/)
  assert.throws(() => parseArgs(['--html']), /unknown or incomplete/)
})

test('findChrome returns the first existing candidate or null', () => {
  assert.equal(findChrome([process.execPath, '/nonexistent']), process.execPath)
  assert.equal(findChrome(['/nonexistent']), null)
})
