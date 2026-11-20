#!/usr/bin/env node
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

// Dependency-free, read-only helpers for /upgrade-assess. Output is JSON on stdout, with
// < > & escaped. Inputs are untrusted data: parsed as JSON only, never executed.
//
// Usage:
//   node assess_tools.mjs diff-uct <baseline.json> <target.json>
//   node assess_tools.mjs rollup   <upgrade-assessment.json>
//   node assess_tools.mjs validate <upgrade-assessment.json>
//
// Exit codes: 0 = ok, 1 = validation errors or unreadable input, 2 = bad usage.

import { readFileSync, statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const MAX_BYTES = 64 * 1024 * 1024
export const LEVELS = ['Small', 'Medium', 'High', 'UNKNOWN']
const PATCH_ACTIONS = ['REVIEW', 'DROP', 'KEEP_AND_REBASE', 'REWORK', 'REPLACE_WITH_VENDOR_RELEASE', 'UPGRADE_PACKAGE']
const MODULE_DECISIONS = ['KEEP', 'UPGRADE_MINOR', 'UPGRADE_MAJOR', 'REPLACE', 'REMOVE', 'BLOCKED', 'REVIEW']
const SECTIONS = ['phpCompatibility', 'commerceCompatibility', 'services', 'core', 'thirdParty',
  'customModules', 'patches', 'composer', 'delivery']
const FORBIDDEN_KEYS = /^(effort|effortPoints|points|hours|days|sprints?|velocity|cost|duration|weeks?)$/i
const SENSITIVE_PATH = /(payment|auth|login|vault|encrypt|crypt|password|token)/i

function escaped(value) {
  return JSON.stringify(value, null, 2)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
}

export function readJson(path) {
  const stat = statSync(path)
  if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('input is not a regular file within the size limit')
  return JSON.parse(readFileSync(path, 'utf8'))
}

function findingKey(f) {
  // Line numbers shift between versions of the same file, so they are not part of identity.
  return [f.code, f.type, f.file, f.message].join('\u0000')
}

export function diffUct(baseline, target) {
  if (!Array.isArray(baseline) || !Array.isArray(target)) throw new Error('both inputs must be arrays of findings')
  const seen = new Map()
  for (const f of baseline) seen.set(findingKey(f), (seen.get(findingKey(f)) || 0) + 1)
  const introduced = []
  for (const f of target) {
    const key = findingKey(f)
    const left = seen.get(key) || 0
    if (left > 0) seen.set(key, left - 1)
    else introduced.push(f)
  }
  const remaining = new Map()
  for (const f of target) remaining.set(findingKey(f), (remaining.get(findingKey(f)) || 0) + 1)
  const resolved = baseline.filter((f) => {
    const left = remaining.get(findingKey(f)) || 0
    if (left > 0) { remaining.set(findingKey(f), left - 1); return false }
    return true
  })
  return {
    baselineCount: baseline.length,
    targetCount: target.length,
    introducedCount: introduced.length,
    resolvedCount: resolved.length,
    introduced,
    resolved
  }
}

export function suggestComplexity({ businessLogic = false, schemaChange = false, integration = false,
  sensitive = false, blocked = false, evidence = true } = {}) {
  if (!evidence) return { level: 'UNKNOWN', reason: 'insufficient evidence; never defaulted to Small' }
  if (sensitive) return { level: 'High', reason: 'payment/auth/encryption code is never below High' }
  if (blocked) return { level: 'High', reason: 'blocked component with no known compatible release' }
  if (integration) return { level: 'High', reason: 'external or third-party integration impact' }
  if (businessLogic && schemaChange) return { level: 'High', reason: 'business logic and database schema change' }
  if (businessLogic) return { level: 'Medium', reason: 'touches business logic with minimal or no schema impact' }
  return { level: 'Small', reason: 'configuration change or mechanical replacement' }
}

// Deterministic patch triage. `fixedUpstream` and `applies` are true/false/'offset'/null (unknown).
export function classifyPatch({ type, fixedUpstream = null, applies = null, vendorReleaseHasFix = false,
  obsolete = false } = {}) {
  if (obsolete) return { action: 'DROP', reason: 'patch is obsolete for the target platform' }
  if (type === 'cloud') return { action: 'UPGRADE_PACKAGE', reason: 'delivered by the upgraded Cloud package' }
  if (vendorReleaseHasFix) return { action: 'REPLACE_WITH_VENDOR_RELEASE', reason: 'target extension release contains the fix' }
  if (fixedUpstream === true) return { action: 'DROP', reason: 'fix is included in the target release' }
  if (applies === true || applies === 'offset') {
    return { action: 'KEEP_AND_REBASE', reason: applies === 'offset' ? 'applies with offsets; re-test' : 'still needed; re-test' }
  }
  if (applies === false && fixedUpstream === false) return { action: 'REWORK', reason: 'still needed but no longer applies' }
  return { action: 'REVIEW', reason: 'upstream status or dry-run result missing (NOT ASSESSED); add to gaps' }
}

export function isSensitivePath(file) {
  return typeof file === 'string' && SENSITIVE_PATH.test(file)
}

export function rollup(data) {
  const counts = { small: 0, medium: 0, high: 0, unknown: 0 }
  const rows = [
    ...(data.sections?.thirdParty?.rows || []),
    ...(data.sections?.customModules?.rows || []),
    ...(data.sections?.patches?.rows || [])
  ]
  for (const row of rows) {
    const key = String(row.complexity || 'UNKNOWN').toLowerCase()
    counts[key in counts ? key : 'unknown']++
  }
  const patchRows = data.sections?.patches?.rows || []
  const patchActions = {}
  for (const row of patchRows) patchActions[row.action] = (patchActions[row.action] || 0) + 1
  return { counts, total: rows.length, patchActions }
}

export function validate(data) {
  const errors = []
  const walk = (node, path) => {
    if (Array.isArray(node)) node.forEach((item, i) => walk(item, `${path}[${i}]`))
    else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (FORBIDDEN_KEYS.test(key)) errors.push(`${path}.${key}: effort/duration figures are not allowed`)
        walk(value, `${path}.${key}`)
      }
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ['root must be an object']
  if (data.schemaVersion !== 1) errors.push('schemaVersion must be 1')
  for (const name of ['project', 'versions', 'sections', 'complexity', 'gaps']) {
    if (data[name] === undefined) errors.push(`missing ${name}`)
  }
  for (const name of SECTIONS) {
    if (data.sections && data.sections[name] === undefined) errors.push(`missing sections.${name}`)
  }
  const rowChecks = [
    ['thirdParty', 'decision', MODULE_DECISIONS],
    ['customModules', null, null],
    ['patches', 'action', PATCH_ACTIONS]
  ]
  for (const [section, field, allowed] of rowChecks) {
    const rows = data.sections?.[section]?.rows
    if (rows === undefined) continue
    if (!Array.isArray(rows)) { errors.push(`sections.${section}.rows must be an array`); continue }
    rows.forEach((row, i) => {
      const at = `sections.${section}.rows[${i}]`
      if (!LEVELS.includes(row.complexity)) errors.push(`${at}.complexity must be one of ${LEVELS.join('/')}`)
      if (!row.reason) errors.push(`${at}.reason is required`)
      if (field && !allowed.includes(row[field])) errors.push(`${at}.${field} must be one of ${allowed.join('/')}`)
      if (row.complexity === 'UNKNOWN' && Array.isArray(data.gaps) && data.gaps.length === 0) {
        errors.push(`${at} is UNKNOWN but gaps is empty`)
      }
    })
  }
  const roll = rollup(data)
  for (const key of Object.keys(roll.counts)) {
    if (data.complexity && typeof data.complexity[key] === 'number' && data.complexity[key] !== roll.counts[key]) {
      errors.push(`complexity.${key} is ${data.complexity[key]} but rows give ${roll.counts[key]}`)
    }
  }
  walk(data, '$')
  return errors
}

function main(argv) {
  const [cmd, ...args] = argv
  try {
    if (cmd === 'diff-uct' && args.length === 2) {
      console.log(escaped(diffUct(readJson(args[0]), readJson(args[1]))))
    } else if (cmd === 'rollup' && args.length === 1) {
      console.log(escaped(rollup(readJson(args[0]))))
    } else if (cmd === 'validate' && args.length === 1) {
      const errors = validate(readJson(args[0]))
      console.log(escaped({ valid: errors.length === 0, errors }))
      return errors.length ? 1 : 0
    } else {
      console.error('usage: assess_tools.mjs diff-uct <baseline> <target> | rollup <file> | validate <file>')
      return 2
    }
    return 0
  } catch {
    console.error('assess_tools: unreadable or invalid input')
    return 1
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = main(process.argv.slice(2))
