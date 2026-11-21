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
  process.stdout.write(`${C.DIM}  Set up this project for Claude Code upgrade workflows${C.RESET}\n\n`)
}

function checkPrereqs() {
  log.step('Checking prerequisites')
  const failures = []

  const nodeMajor = parseInt(process.version.replace('v', '').split('.')[0], 10)
  if (nodeMajor < 18) {
    log.warn(`node ${process.version} is too old — need >= 18`)
    failures.push('node')
  } else {
    log.success(`node ${process.version}`)
  }

  try {
    const v = execSync('claude --version', { stdio: 'pipe' }).toString().trim()
    log.success(`claude ${v}`)
  } catch {
    log.warn('claude CLI not found on PATH — install Claude Code before running `claude` in this project')
  }

  if (failures.length > 0) {
    const { CLIError } = require('@oclif/core/errors')
    throw new CLIError('Fix the issues above and re-run setup.')
  }
}

function runScript(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], { stdio: 'inherit' })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`setup-project.mjs exited with code ${code}`))
    })
  })
}

class SetupCommand extends Command {
  async run() {
    const { flags } = await this.parse(SetupCommand)
    const { validateCodegraphOptions } = await import('../../../scripts/lib/codegraph-policy.mjs')
    validateCodegraphOptions({ enableCodegraph: flags['enable-codegraph'], skipCodegraph: flags['skip-codegraph'] })

    showBanner()
    checkPrereqs()

    const projectRoot = path.resolve(flags.project || process.cwd())
    if (!await fs.pathExists(projectRoot)) {
      this.error(`Project directory does not exist: ${projectRoot}`, { exit: 1 })
    }

    const pluginRoot = path.resolve(__dirname, '..', '..', '..')
    const setupScript = path.join(pluginRoot, 'scripts', 'setup-project.mjs')
    if (!await fs.pathExists(setupScript)) {
      this.error('setup-project.mjs not found — reinstall the plugin', { exit: 1 })
    }

    const args = ['--project', projectRoot]
    if (flags['install-type']) args.push('--install-type', flags['install-type'])
    if (flags.environment) args.push('--environment', flags.environment)
    if (flags.agent) args.push('--agent', flags.agent)
    if (flags['enable-codegraph']) args.push('--enable-codegraph')
    if (flags['skip-codegraph']) args.push('--skip-codegraph')

    log.step('Installing toolkit into project')
    await runScript(setupScript, args)

    const agent = flags.agent || 'claude-code'
    log.step('Next steps')
    if (agent === 'github-copilot') {
      log.info(`Open ${projectRoot} in VS Code with GitHub Copilot Chat enabled`)
      log.info('Run the upgrade-hop skill — detect your environment and generate a hop roadmap')
      log.info('Run the upgrade-hop-execute skill with a target version — implement fixes for a hop')
    } else {
      log.info(`Open ${projectRoot} in your terminal`)
      log.info('Run: claude')
      log.info('Type: /upgrade-hop  — detect your environment and generate a hop roadmap')
      log.info('Type: /upgrade-hop-execute <version>  — implement fixes for a hop')
    }

    log.step('MCP servers')
    log.info('CodeGraph is disabled; activation awaits independent review. Use direct project read/search.')
  }
}

SetupCommand.description = 'Install the Adobe Commerce Upgrade Toolkit into a Commerce project (first-time setup). ' +
  'Use --agent to pick the toolkit flavour, or run `ccua:agent:select` for an interactive prompt.'

SetupCommand.flags = {
  'enable-codegraph': Flags.boolean({ description: 'Request CodeGraph activation (currently blocked: approved profile unavailable)' }),
  'skip-codegraph': Flags.boolean({ description: 'Keep CodeGraph disabled (the default)' }),
  project: Flags.string({
    description: 'Path to the target Commerce project (defaults to the current directory)',
  }),
  'install-type': Flags.string({
    description: 'Pre-seed upgrade-state.md installType',
    options: ['fresh', 'existing'],
  }),
  environment: Flags.string({
    description: 'Pre-seed upgrade-state.md environment (only used when --install-type=fresh)',
    options: ['warden', 'markshust', 'cloud', 'bare-metal'],
  }),
  agent: Flags.string({
    char: 'a',
    description: 'which agent toolkit flavour to install',
    options: ['claude-code', 'github-copilot'],
    default: 'claude-code',
  }),
}

SetupCommand.examples = [
  '$ aio ccua:setup',
  '$ aio ccua:setup --project /path/to/commerce/project',
  '$ aio ccua:setup --install-type fresh --environment warden',
  '$ aio ccua:setup --agent github-copilot',
]

module.exports = SetupCommand
