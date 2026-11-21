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
const { createInterface } = require('node:readline')
const path = require('path')
const fs = require('fs-extra')
const { spawn } = require('child_process')

const C = {
  BOLD: '\x1b[1m',
  DIM: '\x1b[2m',
  BLUE: '\x1b[0;34m',
  RESET: '\x1b[0m',
}

function showBanner () {
  const L = `${C.BOLD}${C.BLUE}`
  const R = C.RESET
  process.stdout.write('\n')
  process.stdout.write(`${L}  Adobe Commerce Upgrade Toolkit${R}\n`)
  process.stdout.write(`${C.DIM}  Choose which agent toolkit flavour to install${C.RESET}\n\n`)
}

function checkPrereqs () {
  const nodeMajor = parseInt(process.version.replace('v', '').split('.')[0], 10)
  if (nodeMajor < 18) {
    const { CLIError } = require('@oclif/core/errors')
    throw new CLIError(`node ${process.version} is too old — need >= 18`)
  }
}

const AGENT_CHOICES = {
  1: 'claude-code',
  2: 'github-copilot',
  'claude-code': 'claude-code',
  claudecode: 'claude-code',
  claude: 'claude-code',
  'github-copilot': 'github-copilot',
  githubcopilot: 'github-copilot',
  copilot: 'github-copilot',
}

async function promptForAgent () {
  process.stdout.write('Which agent toolkit would you like to install into this project?\n')
  process.stdout.write('  1. Claude Code\n')
  process.stdout.write('  2. GitHub Copilot\n')
  const prompt = createInterface({ input: process.stdin, output: process.stderr })
  let answer
  try {
    const response = await new Promise((resolve, reject) => {
      prompt.once('close', () => reject(new Error('No agent choice received. Use --agent to select a toolkit.')))
      prompt.once('SIGINT', () => prompt.close())
      prompt.question('Enter 1 or 2 (or a name) [1]: ', resolve)
    })
    answer = (response.trim() || '1').toLowerCase()
  } finally {
    prompt.close()
  }
  const agent = AGENT_CHOICES[answer]
  if (!agent) {
    throw new Error(`Unrecognised choice "${answer}". Expected 1, 2, "claude-code", or "github-copilot".`)
  }
  return agent
}

function runScript (scriptPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], { stdio: 'inherit' })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`setup-project.mjs exited with code ${code}`))
    })
  })
}

class AgentSelect extends Command {
  async run () {
    const { flags } = await this.parse(AgentSelect)
    const { validateCodegraphOptions } = await import('../../../../scripts/lib/codegraph-policy.mjs')
    validateCodegraphOptions({ enableCodegraph: flags['enable-codegraph'], skipCodegraph: flags['skip-codegraph'] })

    showBanner()
    checkPrereqs()

    const projectRoot = path.resolve(flags.project)
    if (!await fs.pathExists(projectRoot)) {
      this.error(`Project directory does not exist: ${projectRoot}`, { exit: 1 })
    }

    const agent = flags.agent ?? await promptForAgent()

    this.log(`\n> Installing the Adobe Commerce Upgrade Toolkit (${agent === 'github-copilot' ? 'GitHub Copilot' : 'Claude Code'}) into ${projectRoot} ...`)

    const pluginRoot = path.resolve(__dirname, '..', '..', '..', '..')
    const setupScript = path.join(pluginRoot, 'scripts', 'setup-project.mjs')
    if (!await fs.pathExists(setupScript)) {
      this.error('setup-project.mjs not found — reinstall the plugin', { exit: 1 })
    }

    const args = ['--project', projectRoot, '--agent', agent]
    if (flags['install-type']) args.push('--install-type', flags['install-type'])
    if (flags.environment) args.push('--environment', flags.environment)
    if (flags['enable-codegraph']) args.push('--enable-codegraph')
    if (flags['skip-codegraph']) args.push('--skip-codegraph')

    try {
      await runScript(setupScript, args)
    } catch (err) {
      this.error(err.message, { exit: 1 })
    }
  }
}

AgentSelect.description = 'Choose which agent toolkit to install (Claude Code or GitHub Copilot) and scaffold ' +
  'the matching .claude/ or .github/ structure into the target project. Prompts interactively if --agent is omitted.'

AgentSelect.examples = [
  '<%= config.bin %> ccua:agent:select',
  '<%= config.bin %> ccua:agent:select --agent github-copilot',
  '<%= config.bin %> ccua:agent:select --agent claude-code --project /path/to/commerce/project',
]

AgentSelect.flags = {
  'enable-codegraph': Flags.boolean({ description: 'Request CodeGraph activation (currently blocked: approved profile unavailable)' }),
  'skip-codegraph': Flags.boolean({ description: 'Keep CodeGraph disabled (the default)' }),
  agent: Flags.string({
    char: 'a',
    description: 'agent toolkit to install (skips the interactive prompt)',
    options: ['claude-code', 'github-copilot'],
  }),
  project: Flags.string({ char: 'p', description: 'target project root', default: process.cwd() }),
  'install-type': Flags.string({
    description: 'Pre-seed upgrade-state.md installType',
    options: ['fresh', 'existing'],
  }),
  environment: Flags.string({
    description: 'Pre-seed upgrade-state.md environment (only used when --install-type=fresh)',
    options: ['warden', 'markshust', 'cloud', 'bare-metal'],
  }),
}

module.exports = AgentSelect
