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

import { accessSync, constants, lstatSync, readSync, fstatSync, writeFileSync,
  renameSync, unlinkSync, rmdirSync, fchmodSync, fchownSync, mkdirSync,
  openSync, closeSync, fsyncSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { resolve, join, parse, relative, sep, dirname, basename } from 'node:path'
import { openAnchoredDirectory } from './anchored-fs.mjs'

export const MAX_WORKSPACE_CONFIG_BYTES = 2_000_000

export const CODEGRAPH_BLOCKED = 'CodeGraph activation blocked: no independently reviewed approved profile exists. Use direct project read/search; see docs/security-migration.md for pending requirements.'

export function validateCodegraphOptions({ enableCodegraph = false, skipCodegraph = false } = {}) {
  if (enableCodegraph && skipCodegraph) {
    throw new Error('--enable-codegraph and --skip-codegraph conflict')
  }
  if (enableCodegraph) throw new Error(CODEGRAPH_BLOCKED)
}

export function parseSetupArgs(args, { update = false } = {}) {
  const values = new Set(update ? ['--project', '--agent'] :
    ['--project', '--agent', '--install-type', '--environment'])
  const options = {}
  const allowedValues = {
    '--agent': ['claude-code', 'github-copilot'],
    '--install-type': ['fresh', 'existing'],
    '--environment': ['warden', 'markshust', 'cloud', 'bare-metal'],
  }
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    if (flag === '--enable-codegraph' || flag === '--skip-codegraph') {
      options[flag === '--enable-codegraph' ? 'enableCodegraph' : 'skipCodegraph'] = true
    } else if (values.has(flag)) {
      if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error(`Missing value for ${flag}`)
      if (options[flag] !== undefined) throw new Error(`Duplicate flag: ${flag}`)
      const value = args[++i]
      if (allowedValues[flag] && !allowedValues[flag].includes(value)) {
        throw new Error(`Invalid value for ${flag}: ${JSON.stringify(value)}`)
      }
      options[flag] = value
    } else {
      throw new Error(`Unknown flag or argument: ${flag}`)
    }
  }
  validateCodegraphOptions(options)
  return options
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function rejectDuplicateKeys(source) {
  // JSON.parse alone silently drops earlier duplicate fields when a config is rewritten.
  const stack = []
  for (const [token] of source.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\],:]/g)) {
    if (token === '{') stack.push({ keys: new Set(), expectsKey: true })
    else if (token === '[') stack.push(null)
    else if (token === '}' || token === ']') stack.pop()
    else {
      const current = stack[stack.length - 1]
      if (!current) continue
      if (token === ',') current.expectsKey = true
      else if (token.startsWith('"') && current.expectsKey) {
        const key = JSON.parse(token)
        if (current.keys.has(key)) throw new Error('duplicate JSON key')
        current.keys.add(key)
        current.expectsKey = false
      }
    }
  }
}

function checkedRead(file, heldDirectory) {
  // Check every ancestor before opening: never follow a config link outside the workspace.
  const absolute = resolve(file)
  let current = parse(absolute).root
  let expected
  for (const part of relative(current, absolute).split(sep)) {
    current = join(current, part)
    let stat
    try { stat = lstatSync(current) } catch (error) {
      if (error.code === 'ENOENT') return undefined
      throw new Error(`Cannot inspect workspace config ${file}: ${error.message}`)
    }
    if (stat.isSymbolicLink()) throw new Error(`Unsafe symlink in workspace config path: ${current}`)
    if (current === absolute ? !stat.isFile() || stat.nlink !== 1 : !stat.isDirectory()) {
      throw new Error(`Unsafe workspace config path: ${current}`)
    }
    if (current === absolute) {
      if (stat.size > MAX_WORKSPACE_CONFIG_BYTES) {
        throw new Error(`Workspace config exceeds ${MAX_WORKSPACE_CONFIG_BYTES}-byte limit: ${file}`)
      }
      expected = stat
    }
  }
  const directory = heldDirectory ?? openAnchoredDirectory(dirname(absolute))
  let descriptor
  let bytes
  try {
    directory.assertAttached()
    descriptor = openSync(directory.entry(basename(absolute)),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const before = fstatSync(descriptor)
    if (!before.isFile() || before.nlink !== 1 || before.dev !== expected.dev || before.ino !== expected.ino) {
      throw new Error(`Unsafe workspace config path: ${file}`)
    }
    if (before.size > MAX_WORKSPACE_CONFIG_BYTES) {
      throw new Error(`Workspace config exceeds ${MAX_WORKSPACE_CONFIG_BYTES}-byte limit: ${file}`)
    }
    const buffer = Buffer.alloc(before.size + 1)
    let length = 0
    while (length < buffer.length) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, length)
      if (!count) break
      length += count
    }
    const after = fstatSync(descriptor)
    if (length !== before.size || after.size !== before.size || after.nlink !== 1 ||
        after.mtimeMs !== before.mtimeMs) {
      throw new Error(`Workspace config changed during bounded read: ${file}`)
    }
    bytes = buffer.subarray(0, length)
    directory.assertAttached()
  } finally {
    try { if (descriptor !== undefined) closeSync(descriptor) } finally {
      if (!heldDirectory) directory.close()
    }
  }
  const source = bytes.toString('utf8')
  if (!Buffer.from(source, 'utf8').equals(bytes)) {
    throw new Error(`Invalid UTF-8 in workspace config: ${file}; repair manually before retrying`)
  }
  let config
  try {
    config = JSON.parse(source)
    rejectDuplicateKeys(source)
  } catch {
    throw new Error(`Malformed JSON in workspace config: ${file}; repair manually before retrying`)
  }
  if (!object(config)) throw new Error(`Expected JSON object in workspace config: ${file}`)
  return { file: absolute, source, config }
}

function cleanServer(config, key, file) {
  if (!(key in config)) return
  if (!object(config[key])) throw new Error(`Invalid ${key} in workspace config: ${file}`)
  if (!Object.hasOwn(config[key], 'codegraph')) return
  const server = config[key].codegraph
  const recognizable = object(server) &&
    Object.keys(server).every((field) => ['type', 'command', 'args'].includes(field)) &&
    (!Object.hasOwn(server, 'type') || server.type === 'stdio') &&
    server.command === 'codegraph' &&
    Array.isArray(server.args) && server.args.length === 2 &&
    server.args[0] === 'serve' && server.args[1] === '--mcp'
  if (!recognizable) {
    throw new Error(`Customized CodeGraph entry in ${file}; disable/review it manually before retrying`)
  }
  delete config[key].codegraph
}

const LEGACY_ALLOW = new Set([
  'mcp__codegraph__codegraph_explore', 'mcp__codegraph__*', 'mcp__codegraph',
])

function cleanSettings(config, file) {
  if ('enabledMcpjsonServers' in config) {
    if (!Array.isArray(config.enabledMcpjsonServers) ||
        !config.enabledMcpjsonServers.every((item) => typeof item === 'string')) {
      throw new Error(`Invalid enabledMcpjsonServers in ${file}`)
    }
    config.enabledMcpjsonServers = config.enabledMcpjsonServers.filter((item) => item !== 'codegraph')
  }
  if ('permissions' in config) {
    if (!object(config.permissions)) throw new Error(`Invalid permissions in ${file}`)
    if ('allow' in config.permissions) {
      if (!Array.isArray(config.permissions.allow) ||
          !config.permissions.allow.every((item) => typeof item === 'string')) {
        throw new Error(`Invalid permissions.allow in ${file}`)
      }
      config.permissions.allow = config.permissions.allow.filter((item) => !LEGACY_ALLOW.has(item))
    }
  }
  if ('hooks' in config && (!object(config.hooks) ||
      ('SessionStart' in config.hooks && (!Array.isArray(config.hooks.SessionStart) ||
       !config.hooks.SessionStart.every((entry) => object(entry) &&
         (!('hooks' in entry) || (Array.isArray(entry.hooks) && entry.hooks.every(object)))))))) {
    throw new Error(`Invalid hooks.SessionStart in ${file}`)
  }
}

const CANDIDATES = [
  ['.mcp.json', 'mcpServers'],
  ['.vscode/mcp.json', 'servers'],
  ['.claude/settings.json', null],
  ['.claude/settings.local.json', null],
]

const hash = (source) => source === undefined ? null :
  createHash('sha256').update(source).digest('hex')

function inspectConfigs(projectRoot) {
  return CANDIDATES.map(([name, key]) => {
    const entry = checkedRead(join(projectRoot, name))
    if (!entry) return { name }
    const before = JSON.stringify(entry.config)
    if (key) cleanServer(entry.config, key, entry.file)
    else cleanSettings(entry.config, entry.file)
    const after = JSON.stringify(entry.config) === before ? entry.source :
      `${JSON.stringify(entry.config, null, 2)}\n`
    return { ...entry, name, after }
  })
}

function checkedDirectory(directory) {
  const absolute = resolve(directory)
  let current = parse(absolute).root
  for (const part of relative(current, absolute).split(sep)) {
    current = join(current, part)
    let metadata
    try { metadata = lstatSync(current) } catch (error) {
      if (error.code === 'ENOENT' && current === absolute) return false
      throw error
    }
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(`Unsafe workspace config path: ${current}`)
    }
  }
  return true
}

function recoveryPaths(projectRoot) {
  const directory = join(resolve(projectRoot), '.ccua')
  checkedDirectory(directory)
  return { directory, lock: join(directory, 'legacy-reconciliation.lock'),
    journal: join(directory, 'legacy-reconciliation.json') }
}

function exists(file) {
  try { lstatSync(file); return true } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

function withRecoveryLock(paths, operation) {
  const anchor = openAnchoredDirectory(paths.directory,
    { create: true, createRoot: dirname(paths.directory) })
  let locked = false
  let failure
  try {
    anchor.assertAttached()
    try { mkdirSync(anchor.entry(basename(paths.lock)), { mode: 0o700 }) } catch (error) {
      if (error.code === 'EEXIST') {
        throw new Error('Legacy reconciliation lock exists; stop sessions and review recovery before retrying.')
      }
      throw error
    }
    locked = true
    anchor.sync()
    anchor.assertAttached()
    return operation({ ...paths, anchor })
  } catch (error) {
    failure = error
    throw error
  } finally {
    const errors = []
    if (locked) {
      try {
        rmdirSync(anchor.entry(basename(paths.lock)))
        anchor.sync()
      } catch (error) { errors.push(error) }
    }
    try { anchor.close() } catch (error) { errors.push(error) }
    if (errors.length) {
      throw new AggregateError(failure ? [failure, ...errors] : errors,
        'Legacy reconciliation or lock cleanup failed; review required.')
    }
  }
}

function verifyHashes(projectRoot, files, field) {
  for (const item of files) {
    const source = checkedRead(join(projectRoot, item.path))?.source
    if (hash(source) !== item[field]) {
      throw new Error(`Workspace config changed during reconciliation: ${item.path}; recovery required.`)
    }
  }
}

function publishReconciliation(projectRoot, paths, entries, journal, recovering) {
  const changes = entries.filter(entry => entry.source !== entry.after)
  const staged = []
  let failure
  try {
    for (const { file, source, after } of changes) {
      const anchor = openAnchoredDirectory(dirname(file))
      const item = { file, anchor, temporary: `.ccua-reconcile-${randomUUID()}`,
        created: false, descriptor: undefined, mode: undefined }
      staged.push(item)
      if (checkedRead(file, anchor)?.source !== source) {
        throw new Error(`Workspace config changed during preflight: ${file}`)
      }
      anchor.assertAttached()
      const target = anchor.entry(basename(file))
      try { accessSync(target, constants.W_OK) } catch {
        throw new Error(`Workspace config is not writable: ${file}; reconciliation blocked`)
      }
      const metadata = lstatSync(target)
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
        throw new Error(`Unsafe workspace config during staging: ${file}`)
      }
      const descriptor = openSync(anchor.entry(item.temporary),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
      item.created = true
      item.descriptor = descriptor
      item.mode = metadata.mode & 0o777
      writeFileSync(descriptor, after)
      const stagedMetadata = fstatSync(descriptor)
      if (stagedMetadata.uid !== metadata.uid || stagedMetadata.gid !== metadata.gid) {
        fchownSync(descriptor, metadata.uid, metadata.gid)
      }
      fsyncSync(descriptor)
      anchor.sync()
      anchor.assertAttached()
    }
    const current = entries.map(entry => ({ path: entry.name, sha256: hash(entry.source) }))
    verifyHashes(projectRoot, current, 'sha256')
    if (!recovering) {
      paths.anchor.assertAttached()
      const descriptor = openSync(paths.anchor.entry(basename(paths.journal)),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
      try {
        writeFileSync(descriptor, `${JSON.stringify(journal)}\n`)
        fsyncSync(descriptor)
      } finally { closeSync(descriptor) }
      paths.anchor.sync()
      paths.anchor.assertAttached()
    }
    for (const { file, temporary, anchor, descriptor, mode } of staged) {
      anchor.assertAttached()
      paths.anchor.assertAttached()
      fchmodSync(descriptor, mode)
      fsyncSync(descriptor)
      renameSync(anchor.entry(temporary), anchor.entry(basename(file)))
      anchor.sync()
      try { anchor.assertAttached() } catch (error) {
        throw new Error('Config published to held directory; attachment changed; verify state before recovery.',
          { cause: error })
      }
    }
    verifyHashes(projectRoot, journal.files, 'afterSha256')
    if (inspectConfigs(projectRoot).some(entry => entry.source !== entry.after)) {
      throw new Error('Legacy registrations/grants remain; recovery required.')
    }
    paths.anchor.assertAttached()
    unlinkSync(paths.anchor.entry(basename(paths.journal)))
    paths.anchor.sync()
  } catch (error) {
    failure = error
    throw error
  } finally {
    const errors = []
    for (const { anchor, temporary, created, descriptor } of staged) {
      try {
        if (created) {
          try { unlinkSync(anchor.entry(temporary)) } catch (error) {
            if (error.code !== 'ENOENT') throw error
          }
        }
      } catch (error) {
        errors.push(error)
      }
      if (descriptor !== undefined) {
        try { closeSync(descriptor) } catch (error) { errors.push(error) }
      }
      try { anchor.close() } catch (error) { errors.push(error) }
    }
    if (errors.length) {
      throw new AggregateError(failure ? [failure, ...errors] : errors,
        'Legacy reconciliation or staging cleanup failed; review required.')
    }
  }
}

export function reconcileLegacyCodegraph(projectRoot, options = {}) {
  validateCodegraphOptions(options)
  const paths = recoveryPaths(projectRoot)
  if (exists(paths.lock)) throw new Error('Legacy reconciliation lock exists; stop sessions and review recovery.')
  if (exists(paths.journal)) {
    throw new Error('Pending legacy reconciliation; stop sessions and run reviewed roll-forward recovery.')
  }
  // Preflight all configurations before creating metadata or modifying any file.
  const entries = inspectConfigs(projectRoot)
  if (entries.some(entry => entry.source !== entry.after)) {
    withRecoveryLock(paths, securedPaths => {
      if (exists(paths.journal)) throw new Error('Pending legacy reconciliation; recovery required.')
      const journal = { schemaVersion: 1, files: entries.map(entry => ({
        path: entry.name, beforeSha256: hash(entry.source), afterSha256: hash(entry.after),
      })) }
      publishReconciliation(projectRoot, securedPaths, entries, journal, false)
    })
    console.log('Removed recognizable legacy workspace CodeGraph registrations/grants.')
  }
  console.log('CodeGraph disabled; use direct project read/search. Review preserved root rules and global registrations manually (docs/security-migration.md).')
}

export function recoverLegacyCodegraph(projectRoot) {
  const paths = recoveryPaths(projectRoot)
  return withRecoveryLock(paths, securedPaths => {
    securedPaths.anchor.assertAttached()
    const record = checkedRead(paths.journal, securedPaths.anchor)
    if (!record) throw new Error('No pending legacy reconciliation journal; no recovery applied.')
    const journal = record.config
    const keys = (value, expected) => object(value) &&
      Object.keys(value).sort().join(',') === [...expected].sort().join(',')
    const validHash = value => value === null || (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))
    if (!keys(journal, ['schemaVersion', 'files']) || journal.schemaVersion !== 1 ||
        !Array.isArray(journal.files) || journal.files.length !== CANDIDATES.length ||
        journal.files.some((item, index) => !keys(item, ['path', 'beforeSha256', 'afterSha256']) ||
          item.path !== CANDIDATES[index][0] || !validHash(item.beforeSha256) || !validHash(item.afterSha256) ||
          (item.beforeSha256 === null) !== (item.afterSha256 === null))) {
      throw new Error('Invalid legacy reconciliation journal; manual review required.')
    }
    const entries = inspectConfigs(projectRoot)
    entries.forEach((entry, index) => {
      const item = journal.files[index]
      const current = hash(entry.source)
      if ((current !== item.beforeSha256 && current !== item.afterSha256) ||
          hash(entry.after) !== item.afterSha256) {
        throw new Error(`Workspace config/journal drift blocks recovery: ${entry.name}`)
      }
    })
    publishReconciliation(projectRoot, securedPaths, entries, journal, true)
    console.log('Verified roll-forward legacy cleanup complete; review effective host permissions before restarting.')
  })
}
