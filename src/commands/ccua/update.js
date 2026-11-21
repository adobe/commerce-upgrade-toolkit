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

'use strict'

const { Command, Flags } = require('@oclif/core')
const path   = require('path')
const fs     = require('fs-extra')
const { execSync, spawn } = require('child_process')

const C = {
  BOLD:   '\x1b[1m',
  DIM:    '\x1b[2m',
  GREEN:  '\x1b[0;32m',
  CYAN:   '\x1b[0;36m',
  YELLOW: '\x1b[1;33m',
  BLUE:   '\x1b[0;34m',
  RESET:  '\x1b[0m',
}

const log = {
  info:    (msg) => process.stdout.write(`  ${C.CYAN}>${C.RESET} ${msg}\n`),
  success: (msg) => process.stdout.write(`  ${C.GREEN}✓${C.RESET} ${msg}\n`),
  warn:    (msg) => process.stdout.write(`  ${C.YELLOW}!${C.RESET} ${msg}\n`),
  step:    (msg) => process.stdout.write(`\n${C.BOLD}${C.BLUE}── ${msg} ${C.RESET}\n`),
}

function showBanner() {
  const L = `${C.BOLD}${C.BLUE}`
  const R = C.RESET
  process.stdout.write('\n')
  process.stdout.write(`${L}  Adobe Commerce Upgrade Toolkit${R}\n`)
  process.stdout.write(`${C.DIM}  Update an already-set-up project${C.RESET}\n\n`)
}

function checkPrereqs() {
  log.step('Checking prerequisites')
  const failures = []

  try {
    const v = execSync('git --version', { stdio: 'pipe' }).toString().match(/[\d.]+/)?.[0]
    log.success(`git ${v}`)
  } catch {
    log.warn('git not found — install git and retry')
    failures.push('git')
  }

  const nodeMajor = parseInt(process.version.replace('v', '').split('.')[0], 10)
  if (nodeMajor < 18) {
    log.warn(`node ${process.version} is too old — need >= 18`)
    failures.push('node')
  } else {
    log.success(`node ${process.version}`)
  }

  if (failures.length > 0) {
    const { CLIError } = require('@oclif/core/errors')
    throw new CLIError('Fix the issues above and re-run update.')
  }
}

function runScript(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], { stdio: 'inherit' })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`update-project.mjs exited with code ${code}`))
    })
  })
}

class UpdateCommand extends Command {
  async run() {
    const { flags } = await this.parse(UpdateCommand)

    showBanner()
    checkPrereqs()

    const pluginRoot = path.resolve(__dirname, '..', '..', '..')
    const { name: pkgName, version: installedPluginVersion } = await fs.readJson(
      path.join(pluginRoot, 'package.json')
    )

    log.step('Checking for a newer toolkit version')
    let latestPublished = installedPluginVersion
    try {
      latestPublished = execSync(`npm view ${pkgName} version`, { stdio: 'pipe' }).toString().trim()
    } catch {
      log.warn(`Could not reach npm registry — using locally installed plugin (v${installedPluginVersion})`)
    }

    if (latestPublished !== installedPluginVersion) {
      log.warn(`A newer plugin version is published (v${latestPublished}), but v${installedPluginVersion} is installed.`)
      log.info(`Run: npm update -g ${pkgName}`)
      log.info('Then re-run `aio ccua:update` so the new toolkit files are used.')
    } else {
      log.success(`Plugin is current (v${installedPluginVersion})`)
    }

    log.step('Syncing project files')
    const updateScript = path.join(pluginRoot, 'scripts', 'update-project.mjs')
    if (!await fs.pathExists(updateScript)) {
      this.error('update-project.mjs not found — reinstall the plugin', { exit: 1 })
    }

    const args = ['--project', process.cwd()]
    if (flags.agent) args.push('--agent', flags.agent)

    await runScript(updateScript, args)
  }
}

UpdateCommand.description = 'Update an already-set-up project to the latest Adobe Commerce Upgrade Toolkit version. ' +
  'Detects the installed agent flavour (Claude Code or GitHub Copilot) automatically; use --agent to override.'

UpdateCommand.flags = {
  agent: Flags.string({
    char: 'a',
    description: 'override the auto-detected agent toolkit flavour',
    options: ['claude-code', 'github-copilot'],
  }),
}

UpdateCommand.examples = [
  '$ aio ccua:update',
  '$ aio ccua:update --agent github-copilot',
]

module.exports = UpdateCommand
