/*
Copyright 2026 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0.
SPDX-License-Identifier: Apache-2.0
*/

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseArgs, findChrome } from '../scripts/export-assessment.mjs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

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

test('report branding reaches every document flow without expanding agent permissions', () => {
  for (const prefix of ['.claude', '.github']) {
    const skill = name => prefix === '.claude' ? `${prefix}/skills/${name}.md`
      : `${prefix}/skills/${name}/SKILL.md`
    const agent = prefix === '.claude' ? `${prefix}/agents/commerce-documentation-engineer.md`
      : `${prefix}/agents/commerce-documentation-engineer.agent.md`
    for (const file of [agent, skill('upgrade-hop-report'), skill('upgrade-assessment'),
      skill('upgrade-assessment-pdf'), prefix === '.claude' ? 'CLAUDE.md' : '.github/copilot-instructions.md']) {
      assert.ok(read(file).includes(skill('report-branding')), file)
    }
    const branding = read(skill('report-branding'))
    assert.match(branding, /Planning only - not a compatibility assessment/)
    assert.match(branding, /Incomplete - UCT Not assessed/)
    assert.match(branding, /non-dismissible summary near the title/)
    assert.match(branding, /plain-language\n  quarantine blocker/)
    assert.match(branding, /print all report content/i)
    assert.match(branding, /Document report persistence\n  handoff/)
    assert.doesNotMatch(read(agent).match(/^tools: (.*)$/m)[1], /Bash|\bexecute\b/)
    assert.match(read(skill('upgrade-assessment')), /never hide them behind collapsed detail/)
    assert.match(read(skill('upgrade-assessment-pdf')), /Not assessed[\s\S]*counts stay unavailable, not zero/)
    assert.doesNotMatch(read(skill('upgrade-assessment-pdf')), /Sections with no data:.*"None identified/)
  }
})

test('roadmap branding is self-contained, printable and identical in both agent flavors', () => {
  const template = read('.claude/context/upgrade-report-template.html')
  assert.equal(read('.github/skills/upgrade-hop-report/assets/upgrade-report-template.html'), template)
  const tokens = read('.claude/skills/report-branding.md').match(/```css\n([\s\S]*?)\n```/)[1]
  const embeddedTokens = template.match(/:root \{[\s\S]*?\n  \}/)[0]
    .split('\n').map(line => line.startsWith('  ') ? line.slice(2) : line).join('\n')
  assert.equal(embeddedTokens, tokens)
  assert.ok(template.indexOf('Planning only - not a compatibility assessment') < template.indexOf('id="hop-plan"'))
  assert.match(template, /This report is not proof of production readiness/)
  assert.doesNotMatch(template, /Commerce Compass|Adobe Confidential|Internal Only/)
  assert.doesNotMatch(template, /<(?:link|script|img)\b[^>]*(?:href|src)=["'](?:https?:)?\/\/|@import|url\s*\(/i)
  const print = template.split('@media print {')[1].split('</style>')[0]
  assert.match(print, /\.section-body, \.section-body\.collapsed \{ display: block;/)
  assert.match(print, /thead \{ display: table-header-group;/)
  assert.doesNotMatch(print, /(?:report-status|report-limitation)[^}]*display:\s*none/)
  for (const name of new Set([...template.matchAll(/\{\{([A-Z_]+)\}\}/g)].map(match => match[1]))) {
    for (const file of ['.claude/commands/upgrade-hop.md', '.github/skills/upgrade-hop/SKILL.md']) {
      assert.ok(read(file).includes(`{{${name}}}`), `Missing ${name} dispatch value in ${file}`)
    }
  }
})

test('shared report text and status badges meet the 4.5:1 contrast requirement', () => {
  const branding = read('.claude/skills/report-branding.md')
  const luminance = hex => {
    const channels = hex.slice(1).match(/../g).map(value => {
      const channel = parseInt(value, 16) / 255
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  }
  const pairs = [...branding.matchAll(/\|[^|\n]+\| `(#\w{6})` \| `(#\w{6})` \|/g)]
    .map(match => [match[1], match[2]])
  const token = name => branding.match(new RegExp(`--${name}: (#[a-f0-9]{6});`))[1]
  for (const text of ['report-ink', 'report-muted']) {
    for (const background of ['report-surface', 'report-background']) {
      pairs.push([token(text), token(background)])
    }
  }
  assert.ok(pairs.length > 4, 'Status badge pairs must be checked, not only body text')
  for (const [text, background] of pairs) {
    const values = [luminance(text), luminance(background)].sort((a, b) => a - b)
    const ratio = (values[1] + 0.05) / (values[0] + 0.05)
    assert.ok(ratio >= 4.5, `${text} on ${background}: ${ratio.toFixed(2)}:1`)
  }
})
