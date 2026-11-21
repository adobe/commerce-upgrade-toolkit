/*
Copyright 2026 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0.
SPDX-License-Identifier: Apache-2.0
*/
import { constants, openSync, closeSync, fstatSync, statSync, lstatSync,
  mkdirSync, fsyncSync } from 'node:fs'
import { resolve, parse, relative, sep } from 'node:path'

// Held refs prevent following replacement symlinks, not same-UID actors moving held directories.
// Attachment checks diagnose drift; they are not locks or an OS permission boundary.
export function openAnchoredDirectory(directory, { create = false, createRoot } = {}) {
  if (process.platform !== 'linux' || !constants.O_DIRECTORY || !constants.O_NOFOLLOW) {
    throw new Error('Anchored publication requires Linux procfs; unsupported hosts must use reviewed human remediation.')
  }
  const chain = []
  const flags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  const reference = descriptor => `/proc/self/fd/${descriptor}`
  const entry = (descriptor, name) => {
    if (typeof name !== 'string' || !name || name === '.' || name === '..' ||
        name.includes('/') || name.includes('\0')) {
      throw new Error('Invalid anchored filesystem basename.')
    }
    return `${reference(descriptor)}/${name}`
  }
  const close = () => {
    const errors = []
    while (chain.length) {
      try { closeSync(chain.pop().descriptor) } catch (error) { errors.push(error) }
    }
    if (errors.length) throw new AggregateError(errors, 'Anchored directory descriptor cleanup failed.')
  }
  const assertAttached = () => {
    if (!chain.length) throw new Error('Anchored directory is closed.')
    for (const { descriptor, parent, name } of chain) {
      const held = fstatSync(descriptor, { bigint: true })
      const proc = statSync(reference(descriptor), { bigint: true })
      if (!held.isDirectory() || !proc.isDirectory() || held.dev !== proc.dev || held.ino !== proc.ino) {
        throw new Error('Held directory references unavailable; publication blocked.')
      }
      if (parent !== null) {
        const current = lstatSync(entry(parent, name), { bigint: true })
        if (!current.isDirectory() || current.isSymbolicLink() ||
            held.dev !== current.dev || held.ino !== current.ino) {
          throw new Error('Directory changed during anchored operation; review required.')
        }
      }
    }
  }
  try {
    const absolute = resolve(directory)
    const parts = relative(parse(absolute).root, absolute).split(sep).filter(Boolean)
    let creationDepth = parts.length
    if (create) {
      if (typeof createRoot !== 'string') throw new Error('Existing creation root required.')
      const root = resolve(createRoot)
      const rootParts = relative(parse(root).root, root).split(sep).filter(Boolean)
      if (!rootParts.length || rootParts.length > parts.length ||
          rootParts.some((name, index) => parts[index] !== name)) {
        throw new Error('Creation outside reviewed project root blocked.')
      }
      creationDepth = rootParts.length
    }
    let descriptor = openSync(parse(absolute).root, flags)
    chain.push({ descriptor, parent: null, name: null })
    assertAttached()
    for (const [index, name] of parts.entries()) {
      assertAttached()
      const child = entry(descriptor, name)
      if (create && index >= creationDepth) {
        try {
          mkdirSync(child, { mode: 0o700 })
          fsyncSync(descriptor)
        } catch (error) {
          if (error.code !== 'EEXIST') throw error
        }
      }
      const parent = descriptor
      descriptor = openSync(child, flags)
      chain.push({ descriptor, parent, name })
      assertAttached()
    }
    return {
      entry: name => {
        if (!chain.length) throw new Error('Anchored directory is closed.')
        return entry(descriptor, name)
      },
      assertAttached,
      sync: () => {
        if (!chain.length) throw new Error('Anchored directory is closed.')
        fsyncSync(descriptor)
      },
      close,
    }
  } catch (error) {
    try { close() } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Anchored directory initialization and cleanup failed.')
    }
    throw error
  }
}
