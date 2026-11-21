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

// Human-run helper: converts an /upgrade-assess report into PDF and DOCX.
// It is NOT part of the agent workflow (agents never write binary documents or run
// converters) and is not copied into Commerce projects. Run it yourself from the toolkit.
//
// Usage:
//   node scripts/export-assessment.mjs --html <report.html> [--md <report.md>] [--out-dir <dir>]
//
// PDF  : headless Chrome/Chromium/Edge (set CHROME_PATH to override detection).
// DOCX : pandoc, from the Markdown report (install it yourself, e.g. `brew install pandoc`).
// Output goes to --out-dir (default: the directory of the input). Inputs are only read.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean)

export function parseArgs(argv) {
  const opts = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    if (!['--html', '--md', '--out-dir'].includes(key) || argv[i + 1] === undefined) {
      throw new Error(`unknown or incomplete option: ${key}`)
    }
    opts[key.slice(2)] = argv[i + 1]
  }
  if (!opts.html && !opts.md) throw new Error('provide --html and/or --md')
  return opts
}

export function findChrome(candidates = CHROME_CANDIDATES) {
  return candidates.find((candidate) => existsSync(candidate)) || null
}

function requireFile(path, ext) {
  const full = resolve(path)
  if (extname(full).toLowerCase() !== ext || !existsSync(full) || !statSync(full).isFile()) {
    throw new Error(`${path} must be an existing ${ext} file`)
  }
  return full
}

function hasPandoc() {
  try {
    execFileSync('pandoc', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export function run(argv) {
  const opts = parseArgs(argv)
  const html = opts.html && requireFile(opts.html, '.html')
  const md = opts.md && requireFile(opts.md, '.md')
  const outDir = resolve(opts['out-dir'] || dirname(html || md))
  mkdirSync(outDir, { recursive: true })
  const results = []

  if (html) {
    const chrome = findChrome()
    if (!chrome) {
      results.push('PDF skipped: no Chrome/Chromium/Edge found. Open the HTML and use Print > Save as PDF (A4, background graphics on).')
    } else {
      const out = join(outDir, `${basename(html, '.html')}.pdf`)
      execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer',
        `--print-to-pdf=${out}`, pathToFileURL(html).href], { stdio: 'ignore' })
      results.push(`PDF written: ${out}`)
    }
  }
  if (md) {
    if (!hasPandoc()) {
      results.push('DOCX skipped: pandoc not installed. Install it (brew install pandoc) or open the HTML in Word and Save As .docx.')
    } else {
      const out = join(outDir, `${basename(md, '.md')}.docx`)
      execFileSync('pandoc', [md, '-f', 'gfm', '-o', out], { stdio: 'ignore' })
      results.push(`DOCX written: ${out}`)
    }
  }
  return results
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    run(process.argv.slice(2)).forEach((line) => console.log(line))
  } catch (error) {
    console.error(`export-assessment: ${error.message}`)
    process.exitCode = 1
  }
}
