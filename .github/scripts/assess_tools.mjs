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
//   node assess_tools.mjs uct-prerequisite <live-probe-results.json>
//   node assess_tools.mjs patches <projectDir> --target <X.Y.Z>
//   node assess_tools.mjs custom-modules <projectDir>
//   node assess_tools.mjs third-party <projectDir> [--php 8.5.0] [--assessment <upgrade-assessment.json>]
//
// Exit codes: 0 = ok, 1 = validation errors or unreadable input, 2 = bad usage.

import { readFileSync, statSync, lstatSync, realpathSync, readdirSync, existsSync } from 'node:fs'
import { join, sep } from 'node:path'
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

export function uctPrerequisite({ inProjectExitCode = null, standaloneExitCode = null,
  installationOutcome = 'not-attempted', continueIncomplete = false } = {}) {
  for (const code of [inProjectExitCode, standaloneExitCode]) {
    if (code !== null && (!Number.isInteger(code) || code < 0 || code > 255)) {
      throw new Error('UCT probe exit codes must be null or integers from 0 to 255')
    }
  }
  if (!['not-attempted', 'completed', 'declined', 'failed'].includes(installationOutcome) ||
      typeof continueIncomplete !== 'boolean') {
    throw new Error('invalid UCT installation outcome or incomplete-report decision')
  }
  const mode = inProjectExitCode === 0 ? 'in-project'
    : standaloneExitCode === 0 ? 'standalone-fallback' : null
  if (mode) {
    return { status: 'available', mode, scanAllowed: true, incompleteReportAllowed: false,
      reason: 'UCT prerequisite verified; scan and normalization results are still required' }
  }
  const status = installationOutcome === 'declined' ? 'declined'
    : ['failed', 'completed'].includes(installationOutcome) ? 'failed' : 'missing'
  const reasons = {
    missing: 'No working UCT verified; offer the human-run installation procedure',
    declined: 'Human-run UCT installation declined; UCT compatibility is Not assessed',
    failed: 'Human-run UCT installation or post-install verification failed; UCT compatibility is Not assessed'
  }
  return { status, mode: null, scanAllowed: false,
    incompleteReportAllowed: continueIncomplete, reason: reasons[status] }
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
  const commerce = data.sections?.commerceCompatibility
  if (commerce?.status !== undefined) {
    if (!['assessed', 'not-assessed'].includes(commerce.status)) {
      errors.push('commerceCompatibility.status must be assessed or not-assessed')
    } else if (commerce.status === 'not-assessed') {
      if (typeof commerce.reason !== 'string' || !commerce.reason.trim()) {
        errors.push('commerceCompatibility.reason is required when UCT is Not assessed')
      }
      if (commerce.baselineRun !== null || commerce.targetRun !== null ||
          commerce.quarantineCount !== null || !Array.isArray(commerce.differentialRows) ||
          commerce.differentialRows.length !== 0 || !Array.isArray(commerce.debtCategories) ||
          commerce.debtCategories.length !== 0) {
        errors.push('Not assessed UCT must have null run/count evidence and no differential findings')
      }
      if (!Array.isArray(data.gaps) || data.gaps.length === 0) {
        errors.push('UCT is Not assessed but gaps is empty')
      }
    } else if (typeof commerce.baselineRun !== 'string' || !commerce.baselineRun.trim() ||
               typeof commerce.targetRun !== 'string' || !commerce.targetRun.trim() ||
               !Number.isInteger(commerce.quarantineCount) || commerce.quarantineCount < 0 ||
               !Array.isArray(commerce.differentialRows)) {
      errors.push('Assessed UCT requires both run references, differential rows and a verified quarantine count')
    } else if (commerce.quarantineCount > 0 && (!Array.isArray(data.gaps) || data.gaps.length === 0)) {
      errors.push('UCT quarantine blockers require gaps')
    }
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


// ---- Third-party package evidence (read-only; vendor/<pkg>/composer.json + composer.lock) ----
const PKG_NAME = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/

function vparts(v) {
  const m = /^v?(\d+)(?:\.(\d+|[x*]))?(?:\.(\d+|[x*]))?/i.exec(String(v).trim())
  if (!m) return null
  return [Number(m[1]), m[2] === undefined || /[x*]/i.test(m[2]) ? null : Number(m[2]),
    m[3] === undefined || /[x*]/i.test(m[3]) ? null : Number(m[3])]
}
function cmp(a, b) {
  for (let i = 0; i < 3; i++) { const d = (a[i] ?? 0) - (b[i] ?? 0); if (d) return d }
  return 0
}
function comparatorOk(token, ver) {
  const m = /^(\^|~|>=|<=|>|<|=|!=)?\s*v?(\d+(?:\.(?:\d+|[x*]))?(?:\.(?:\d+|[x*]))?)(?:-[\w.]+)?$/i.exec(token)
  if (!m) return null
  const op = m[1] || ''
  const p = vparts(m[2])
  if (!p) return null
  const full = p.map((x) => x ?? 0)
  const wild = p[1] === null || p[2] === null
  const segs = m[2].split('.').length
  if (op === '' || op === '=') {
    if (!wild && segs === 3) return cmp(ver, full) === 0
    const upper = p[1] === null ? [p[0] + 1, 0, 0] : [p[0], p[1] + 1, 0]
    return cmp(ver, full) >= 0 && cmp(ver, upper) < 0
  }
  if (op === '^') return cmp(ver, full) >= 0 && cmp(ver, [p[0] + 1, 0, 0]) < 0
  if (op === '~') {
    const upper = segs >= 3 ? [p[0], (p[1] ?? 0) + 1, 0] : [p[0] + 1, 0, 0]
    return cmp(ver, full) >= 0 && cmp(ver, upper) < 0
  }
  if (op === '>=') return cmp(ver, full) >= 0
  if (op === '>') return cmp(ver, full) > 0
  if (op === '<=') return cmp(ver, full) <= 0
  if (op === '<') return cmp(ver, full) < 0
  if (op === '!=') return cmp(ver, full) !== 0
  return null
}
// Returns true/false, or null when the constraint cannot be evaluated (never guessed).
export function satisfies(constraint, version) {
  const ver = vparts(version)
  if (!ver || typeof constraint !== 'string' || !constraint.trim()) return null
  let unknown = false
  for (const orPart of constraint.split(/\s*\|\|?\s*/)) {
    const part = orPart.replace(/\s+-\s+/g, ' - ').trim()
    if (part === '*') return true
    const range = /^(\S+) - (\S+)$/.exec(part)
    const tokens = range ? [`>=${range[1]}`, `<=${range[2]}`] : part.replace(/\s*(>=|<=|!=|>|<|=|\^|~)\s*/g, ' $1').split(/[\s,]+/).filter(Boolean)
    let ok = tokens.length > 0
    for (const t of tokens) {
      const r = comparatorOk(t.replace(/^(\S*?)\s+/, '$1'), ver)
      if (r === null) { unknown = true; ok = false; break }
      if (!r) { ok = false; break }
    }
    if (ok) return true
  }
  return unknown ? null : false
}

const DOMAIN_HINTS = [
  [/graph-?ql|pwa|upward|headless/, 'GraphQL / PWA'], [/checkout|one-step|onestep/, 'Checkout'],
  [/payment|stripe|paypal/, 'Payments'], [/mega-?menu|navigation/, 'Navigation'],
  [/blog|cms|page-?builder|content/, 'Content'], [/language-pack|translation|i18n/, 'Localization'],
  [/social-login|customer|login|attribute/, 'Customer'], [/gift|promo|coupon|discount|reward/, 'Promotions'],
  [/recommend|live-?search|search|catalog|merchandis/, 'Catalog / Search'],
  [/analytics|tracking|pixel|facebook|meta|dotdigital|yotpo|richpanel|klaviyo|datafeed|feed/, 'Marketing / Analytics'],
  [/shipping|matrixrate|rate|geoip|store-?locator|milestone/, 'Shipping / Store'], [/form/, 'Forms'],
  [/mcp|data-services|composer|base|core/, 'Platform / Framework']
]
function guessDomain(name, description) {
  const hay = `${name} ${description || ''}`.toLowerCase()
  for (const [re, label] of DOMAIN_HINTS) if (re.test(hay)) return label
  return 'Not classified'
}

function readVendorManifest(projectDir, name) {
  if (!PKG_NAME.test(name)) return null
  const vendorRoot = realpathSync(join(projectDir, 'vendor'))
  const file = join(vendorRoot, ...name.split('/'), 'composer.json')
  const st = lstatSync(file)
  if (!st.isFile() || st.isSymbolicLink() || st.size > 2 * 1024 * 1024) return null
  const real = realpathSync(file)
  if (!real.startsWith(vendorRoot + sep)) return null
  return JSON.parse(readFileSync(real, 'utf8'))
}

export function thirdPartyEvidence(projectDir, { php = '8.5.0', packages = null } = {}) {
  const lock = readJson(join(projectDir, 'composer.lock'))
  const locked = new Map([...(lock.packages || []), ...(lock['packages-dev'] || [])].map((p) => [p.name, p]))
  let names = packages
  if (!names) {
    const root = readJson(join(projectDir, 'composer.json'))
    names = Object.keys(root.require || {}).filter((n) => PKG_NAME.test(n) &&
      !/^magento\/(product-|magento-cloud|magento2-base|framework|ece-tools)/.test(n))
  }
  const rows = names.map((name) => {
    const lp = locked.get(name)
    let manifest = null
    try { manifest = readVendorManifest(projectDir, name) } catch { manifest = null }
    const req = manifest?.require || {}
    const phpConstraint = req.php || null
    const phpOk = phpConstraint ? satisfies(phpConstraint, php) : null
    const platform = Object.entries(req).filter(([k]) => /^magento\/(framework|magento2-base|product-)/.test(k))
      .map(([k, v]) => `${k} ${v}`)
    const abandoned = lp?.abandoned || manifest?.abandoned || false
    const flags = abandoned ? ['ABANDONED'] : []
    const description = (manifest?.description || lp?.description || '').toString().slice(0, 140)
    const row = {
      package: name,
      version: lp?.version || 'UNKNOWN',
      domain: guessDomain(name, description),
      purpose: description || 'Not declared in composer.json',
      phpConstraint: phpConstraint || 'not declared',
      phpCompatible: phpOk === null ? (phpConstraint ? 'Not evaluable' : 'Not declared') : (phpOk ? 'Yes' : 'No'),
      commerceConstraint: platform.length ? platform.join('; ') : 'not declared',
      conflicts: Object.keys(manifest?.conflict || {}).filter((k) => /^magento\//.test(k)),
      flags,
      evidence: manifest ? `vendor/${name}/composer.json (installed ${lp?.version || 'unknown'})` : 'vendor manifest not readable'
    }
    if (!manifest) {
      Object.assign(row, { decision: 'REVIEW', complexity: 'UNKNOWN', reason: 'Vendor manifest not readable; evidence missing.' })
    } else if (abandoned) {
      Object.assign(row, { decision: 'REPLACE', complexity: 'Medium', reason: 'Package is marked abandoned in Composer metadata.' })
    } else if (phpOk === false) {
      Object.assign(row, { decision: 'REVIEW', complexity: 'Medium',
        reason: `Installed release requires PHP ${phpConstraint}, which excludes ${php}; a newer release is needed (availability not verified).` })
    } else if (phpOk === true) {
      Object.assign(row, { decision: 'REVIEW', complexity: 'UNKNOWN',
        reason: `Installed release declares PHP ${phpConstraint} (includes ${php}); Commerce target support not verified.` })
    } else {
      Object.assign(row, { decision: 'REVIEW', complexity: 'UNKNOWN',
        reason: 'No evaluable PHP constraint in the installed release; vendor confirmation required.' })
    }
    return row
  })
  const count = (f) => rows.filter(f).length
  return {
    targetPhp: php,
    summary: {
      total: rows.length,
      phpIncluded: count((r) => r.phpCompatible === 'Yes'),
      phpExcluded: count((r) => r.phpCompatible === 'No'),
      phpUnknown: count((r) => r.phpCompatible !== 'Yes' && r.phpCompatible !== 'No'),
      abandoned: count((r) => r.flags.includes('ABANDONED'))
    },
    rows
  }
}

// ---- Custom module evidence (read-only; app/code structure, module.xml, composer.json) ----
const FOOTPRINT = [
  ['Controller', 'storefront controllers'], ['Block', 'blocks'], ['Model', 'models'],
  ['Plugin', 'plugins'], ['Observer', 'observers'], ['Cron', 'cron jobs'], ['Console', 'CLI commands'],
  ['Ui', 'UI components'], ['Setup/Patch', 'data/schema patches'], ['Setup', 'install/upgrade scripts'],
  ['etc/graphql', 'GraphQL schema'], ['etc/schema.graphqls', 'GraphQL schema'], ['etc/webapi.xml', 'REST API routes'],
  ['etc/db_schema.xml', 'database schema'], ['etc/adminhtml', 'admin configuration'],
  ['etc/events.xml', 'event observers'], ['view/frontend', 'storefront templates'], ['view/adminhtml', 'admin templates']
]
const humanize = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/Graph Ql/g, 'GraphQL')

function safeDir(base, ...parts) {
  const full = join(base, ...parts)
  try {
    const st = lstatSync(full)
    return st.isSymbolicLink() ? null : full
  } catch { return null }
}

export function customModuleEvidence(projectDir) {
  const root = join(projectDir, 'app', 'code')
  const modules = []
  const safeList = (d) => readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.isSymbolicLink() && !e.name.startsWith('.'))
  for (const vendor of safeList(root)) {
    for (const mod of safeList(join(root, vendor.name))) {
      const dir = join(root, vendor.name, mod.name)
      let setupVersion = null
      let sequence = []
      try {
        const xml = readFileSync(join(dir, 'etc', 'module.xml'), 'utf8').slice(0, 64 * 1024)
        setupVersion = /setup_version="([\d.]+)"/.exec(xml)?.[1] || null
        sequence = [...xml.matchAll(/<sequence>([\s\S]*?)<\/sequence>/g)]
          .flatMap((m) => [...m[1].matchAll(/<module\s+name="([A-Za-z0-9_]+)"/g)].map((x) => x[1]))
      } catch { /* module.xml unreadable; recorded below */ }
      let description = null
      try {
        const c = JSON.parse(readFileSync(join(dir, 'composer.json'), 'utf8'))
        description = typeof c.description === 'string' ? c.description.slice(0, 140) : null
      } catch { /* no composer.json */ }
      const features = []
      for (const [rel, label] of FOOTPRINT) {
        if (existsSync(join(dir, ...rel.split('/'))) && safeDir(dir, ...rel.split('/')) && !features.includes(label)) features.push(label)
      }
      modules.push({ module: `${vendor.name}_${mod.name}`, path: `app/code/${vendor.name}/${mod.name}`,
        setupVersion, dependsOn: sequence, description, features })
    }
  }
  const dependents = new Map()
  for (const m of modules) for (const dep of m.dependsOn) {
    dependents.set(dep, [...(dependents.get(dep) || []), m.module])
  }
  return modules.map((m) => {
    const by = dependents.get(m.module) || []
    const kind = humanize(m.module.split('_').slice(1).join(' '))
    const purpose = m.description ||
      (m.features.length ? `${kind}: ${m.features.slice(0, 4).join(', ')}` : `${kind}: no recognised module components`)
    return {
      ...m,
      purpose,
      purposeSource: m.description ? 'composer.json description' : 'derived from module structure',
      requiredBy: by,
      required: by.length ? `Yes - required by ${by.slice(0, 3).join(', ')}${by.length > 3 ? ` (+${by.length - 3})` : ''}`
        : 'Client to confirm (no other module depends on it)'
    }
  })
}

// ---- Patch inventory evidence (read-only; env yaml, hotfix dirs, composer extra, installed patch catalogs) ----
const HOTFIX_DIRS = ['m2-hotfixes', 'patches', 'hotfixes']
const UPSTREAM_ID = /\b((?:ACSD|MDVA|MC|AC|B2B|MAGECLOUD|VULN|CVE|APSB)-\d+(?:-\d+)*)/i

function readSmall(file, max = 1024 * 1024) {
  const st = lstatSync(file)
  if (!st.isFile() || st.isSymbolicLink() || st.size > max) return null
  return readFileSync(file, 'utf8')
}

function catalogEntry(projectDir, id) {
  for (const f of ['support-patches.json', 'community-patches.json']) {
    try {
      const data = JSON.parse(readSmall(join(projectDir, 'vendor', 'magento', 'quality-patches', f), 16 * 1024 * 1024))
      if (data[id]) return data[id]
    } catch { /* catalog not installed */ }
  }
  return null
}

function catalogApplicability(entry, target) {
  const ranges = []
  for (const [pkg, byRange] of Object.entries(entry.packages || {})) {
    if (!/^magento\/magento2(-ee|-b2b)?-base$/.test(pkg)) continue
    for (const range of Object.keys(byRange)) ranges.push(range)
  }
  if (!ranges.length) {
    const others = Object.entries(entry.packages || {}).map(([pkg, byRange]) => `${pkg} ${Object.keys(byRange).join(' | ')}`)
    return { known: false, ranges, others }
  }
  const results = ranges.map((r) => satisfies(r, target))
  if (results.some((r) => r === null)) return { known: false, ranges }
  return { known: true, applies: results.some(Boolean), ranges }
}

export function patchEvidence(projectDir, { target }) {
  const rows = []
  let lock = { packages: [] }
  try { lock = readJson(join(projectDir, 'composer.lock')) } catch { /* no lock */ }
  const locked = new Map((lock.packages || []).map((p) => [p.name, p.version]))
  const cloudVersion = locked.get('magento/magento-cloud-patches') || null

  // 1. Adobe quality patches configured in .magento.env.yaml
  let envText = null
  try { envText = readSmall(join(projectDir, '.magento.env.yaml'), 256 * 1024) } catch { /* not a Cloud project */ }
  const ids = new Set()
  if (envText) {
    const lines = envText.split('\n')
    lines.forEach((line, i) => {
      const m = /^(\s*)QUALITY_PATCHES:\s*(.*)$/.exec(line)
      if (!m) return
      for (const x of m[2].matchAll(/[A-Z][A-Z0-9]+-\d+/g)) ids.add(x[0])
      for (let j = i + 1; j < lines.length; j++) {
        const item = /^\s*-\s*['"]?([A-Z][A-Z0-9]+-\d+)/.exec(lines[j])
        if (!item) break
        ids.add(item[1])
      }
    })
  }
  for (const id of ids) {
    const entry = catalogEntry(projectDir, id)
    const row = { patch: id, type: 'adobe-quality', source: '.magento.env.yaml QUALITY_PATCHES', upstreamId: id,
      targetPackage: 'magento/magento2-base', purpose: entry?.title || 'Title not in installed patch catalog' }
    if (!entry) {
      Object.assign(row, { fixedInTarget: 'Unknown - ID not in installed quality-patches catalog; check target release notes',
        appliesToTarget: 'Check with Adobe Support or target patch catalog', evidence: 'vendor/magento/quality-patches (ID absent)', verdict: 'REVIEW' })
    } else {
      const a = catalogApplicability(entry, target)
      const rng = a.ranges.join(' | ')
      if (a.known && !a.applies) {
        Object.assign(row, { fixedInTarget: `Yes - Adobe patch metadata limits it to ${rng}; confirm in ${target} release notes`,
          appliesToTarget: 'No - not needed', evidence: `quality-patches catalog: ${rng}`, verdict: 'DROP' })
      } else if (a.known) {
        Object.assign(row, { fixedInTarget: `No - still listed for ${target} (${rng})`, appliesToTarget: 'Yes - delivered by quality-patches',
          evidence: `quality-patches catalog: ${rng}`, verdict: 'KEEP' })
      } else if (a.others?.length) {
        Object.assign(row, { fixedInTarget: `Unknown - patch targets ${a.others.join('; ')}; compare with the package version bundled in ${target}`,
          appliesToTarget: 'Check the bundled package version', evidence: `quality-patches catalog: ${a.others.join('; ')}`, verdict: 'REVIEW' })
      } else {
        Object.assign(row, { fixedInTarget: 'Unknown - catalog range not evaluable', appliesToTarget: 'Check target patch catalog',
          evidence: 'quality-patches catalog (range not evaluable)', verdict: 'REVIEW' })
      }
    }
    rows.push(row)
  }

  // 2. Cloud patches package delivered with the metapackage
  if (cloudVersion) {
    rows.push({ patch: `magento/magento-cloud-patches ${cloudVersion}`, type: 'cloud-patch', source: 'composer.lock',
      targetPackage: 'magento/magento-cloud-patches', purpose: 'Adobe Commerce Cloud patches package', fixedInTarget: 'n/a - package',
      appliesToTarget: 'Updated with the target metapackage', evidence: `composer.lock ${cloudVersion}`, verdict: 'UPGRADE_PACKAGE' })
  }

  // 3. Local hotfix files; documented reasons come from a README table in the same directory
  for (const dirName of HOTFIX_DIRS) {
    const dir = safeDir(projectDir, dirName)
    if (!dir) continue
    let readme = ''
    try { readme = readSmall(join(dir, 'README.md'), 256 * 1024) || '' } catch { /* none */ }
    const reasons = new Map()
    for (const m of readme.matchAll(/^\|\s*`([^`|]+)`\s*\|\s*([^|]*)\|\s*([^|]+)\|?\s*$/gm)) reasons.set(m[1].trim(), { module: m[2].trim(), reason: m[3].trim() })
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && !e.isSymbolicLink() && /\.(patch|diff)$/i.test(e.name)) } catch { /* unreadable */ }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      let text = ''
      try { text = readSmall(join(dir, e.name)) || '' } catch { /* skip */ }
      const files = [...new Set([...text.matchAll(/^(?:diff --git a\/|--- a\/)(\S+)/gm)].map((m) => m[1]))]
      const pkgOf = (f) => {
        const v = /^vendor\/([^/]+)\/([^/]+)\//.exec(f)
        if (v) return `${v[1]}/${v[2]}`
        const a = /^app\/code\/([^/]+)\/([^/]+)\//.exec(f)
        if (/^(setup|lib\/internal|app\/etc|pub|dev)\//.test(f)) return 'magento/magento2-base'
        return a ? `app/code/${a[1]}_${a[2]}` : 'project files'
      }
      const pkgs = [...new Set(files.map(pkgOf))]
      const targetPackage = pkgs.length ? pkgs.slice(0, 2).join(', ') + (pkgs.length > 2 ? ` (+${pkgs.length - 2})` : '') : 'not detected'
      const documented = reasons.get(e.name)
      const idMatch = UPSTREAM_ID.exec(e.name)
      const hint = /(\d\.\d\.\d+(?:-p\d+)?)/.exec(e.name)?.[1] || /(\d\.\d\.\d)x/.exec(e.name)?.[1] || null
      const isCustom = /^(CUSTOM|FIX|META|MP|RICHPANEL|MAGEPLAZA|MAGEFAN|DDG)/i.test(e.name) || !!documented
      const core = pkgs.some((p) => /^magento\//.test(p))
      const instVer = pkgs.length ? locked.get(pkgs[0]) : null
      const adobeId = idMatch && /^(ACSD|MDVA|MC|AC|B2B)-/i.test(idMatch[1]) ? idMatch[1].toUpperCase() : null
      const entry = adobeId ? catalogEntry(projectDir, adobeId) : null
      const cat = entry ? catalogApplicability(entry, target) : null
      const hintOld = hint && vparts(hint) && vparts(target) && cmp(vparts(hint), vparts(target)) < 0
      rows.push({
        patch: e.name, type: 'local-hotfix', source: `${dirName}/`, upstreamId: idMatch ? idMatch[1] : null,
        targetPackage: instVer ? `${pkgs[0]} ${instVer}` : targetPackage,
        purpose: documented ? `${documented.reason}`.slice(0, 220) : (text.match(/^#\s*(.+)$/m)?.[1] || `Changes ${files.length} file(s) in ${targetPackage}`).slice(0, 220),
        fixedInTarget: idMatch && !isCustom ? `Unknown - verify ${idMatch[1]} in ${target} release notes`
          : (core ? 'Unknown - verify against target release notes / Adobe Support' : 'Unknown - check vendor release notes for the target package version'),
        appliesToTarget: `Dry-run required on ${target} tree (git apply --check)${hintOld ? `; written for ${hint}` : ''}`,
        evidence: `${dirName}/${e.name}: ${files.length} file(s)`, verdict: 'REVIEW', versionHint: hint, documented: !!documented
      })
      const row = rows[rows.length - 1]
      if (entry) row.purpose = entry.title || row.purpose
      if (cat?.known && !cat.applies) {
        Object.assign(row, { fixedInTarget: `Yes - Adobe patch metadata limits ${adobeId} to ${cat.ranges.join(' | ')}; confirm in ${target} release notes`,
          appliesToTarget: 'No - not needed', evidence: `${row.evidence}; quality-patches catalog: ${cat.ranges.join(' | ')}`, verdict: 'DROP' })
      } else if (cat?.known) {
        Object.assign(row, { fixedInTarget: `No - still listed for ${target} (${cat.ranges.join(' | ')})`,
          appliesToTarget: `Dry-run required on ${target} tree`, verdict: 'REVIEW' })
      }
    }
  }

  // 3b. composer extra.patches (cweagans/composer-patches style)
  try {
    const root = readJson(join(projectDir, 'composer.json'))
    for (const [pkg, map] of Object.entries(root.extra?.patches || {})) {
      for (const [desc, file] of Object.entries(map)) {
        rows.push({ patch: String(file).split('/').pop(), type: PKG_NAME.test(pkg) && /^magento\//.test(pkg) ? 'composer-core' : 'composer-extension',
          source: 'composer.json extra.patches', targetPackage: `${pkg} ${locked.get(pkg) || ''}`.trim(), purpose: String(desc).slice(0, 220),
          fixedInTarget: `Unknown - check ${pkg} release notes for ${target}`, appliesToTarget: `Dry-run required on ${target} tree`,
          evidence: 'composer.json extra.patches', verdict: 'REVIEW' })
      }
    }
  } catch { /* no composer.json */ }

  const tally = {}
  for (const r of rows) tally[r.verdict] = (tally[r.verdict] || 0) + 1
  return { target, cloudPatchesVersion: cloudVersion, summary: { total: rows.length, byVerdict: tally }, rows }
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
    } else if (cmd === 'uct-prerequisite' && args.length === 1) {
      console.log(escaped(uctPrerequisite(readJson(args[0]))))
    } else if (cmd === 'patches' && args.length >= 1) {
      const i = args.indexOf('--target')
      const target = i > 0 ? args[i + 1] : undefined
      if (!target || !/^\d+\.\d+\.\d+(-p\d+)?$/.test(target)) throw new Error('--target X.Y.Z required')
      console.log(escaped(patchEvidence(args[0], { target })))
    } else if (cmd === 'custom-modules' && args.length === 1) {
      console.log(escaped(customModuleEvidence(args[0])))
    } else if (cmd === 'third-party' && args.length >= 1) {
      const opt = (flag) => { const i = args.indexOf(flag); return i > 0 ? args[i + 1] : undefined }
      const phpOpt = opt('--php') || '8.5.0'
      if (!/^\d+\.\d+\.\d+$/.test(phpOpt)) throw new Error('bad php version')
      const assessmentPath = opt('--assessment')
      const packages = assessmentPath ? readJson(assessmentPath).sections.thirdParty.rows.map((r) => r.package) : null
      console.log(escaped(thirdPartyEvidence(args[0], { php: phpOpt, packages })))
    } else {
      console.error('usage: assess_tools.mjs diff-uct <baseline> <target> | rollup <file> | validate <file> | uct-prerequisite <live-probes.json> | patches <projectDir> --target X.Y.Z | custom-modules <projectDir> | third-party <projectDir> [--php X.Y.Z] [--assessment <file>]')
      return 2
    }
    return 0
  } catch {
    console.error('assess_tools: unreadable or invalid input')
    return 1
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = main(process.argv.slice(2))
