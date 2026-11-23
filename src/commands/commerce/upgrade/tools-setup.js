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
const { access, lstat, mkdtemp, readFile, rm } = require('node:fs/promises')
const { spawn } = require('node:child_process')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { promptForAgent } = require('../../ccua/agent/select')

const TOOLKIT_PACKAGE = '@adobe/commerce-upgrade-toolkit'
const AGENTS = {
  'GitHub Copilot': 'github-copilot',
  'Claude Code': 'claude-code'
}

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}.`))
    })
  })
}

class ToolsSetupCommand extends Command {
  async run() {
    const { flags } = await this.parse(ToolsSetupCommand)
    const toolsVersion = flags['tools-version']
    if (!/^(?:[a-zA-Z][a-zA-Z0-9-]*|\d+\.\d+\.\d+)$/.test(toolsVersion)) {
      this.error('Use an exact release version (e.g. 1.0.1) or npm tag (e.g. latest) for --tools-version.')
    }

    let downloadDir
    let currentStep = 'project validation'
    try {
      const projectRoot = path.resolve(flags.project || process.cwd())
      this.log('\nAdobe Commerce Upgrade Tools Setup\n')
      this.log(`Working directory: ${projectRoot}`)
      for (const relative of ['composer.json', 'bin/magento']) {
        const stat = await lstat(path.join(projectRoot, relative))
        if (!stat.isFile()) throw new Error(`Expected a Commerce project file: ${relative}`)
      }
      if (Number(process.versions.node.split('.')[0]) < 22) {
        throw new Error('The toolkit requires Node.js 22 or later.')
      }
      if (process.platform !== 'linux') {
        throw new Error('The toolkit installer requires Linux /proc. Run this command in your Linux development container, or use the temporary-container setup in docs/setup-guide.md.')
      }
      await access('/proc/self/fd')

      currentStep = 'agent selection'
      const agent = flags.agent ? AGENTS[flags.agent] : await promptForAgent()
      const selectedAgent = agent === 'github-copilot' ? 'GitHub Copilot' : 'Claude Code'

      currentStep = 'package download'
      downloadDir = await mkdtemp(path.join(tmpdir(), 'commerce-upgrade-tools-'))
      this.log(`Downloading ${TOOLKIT_PACKAGE}@${toolsVersion} from npm...`)
      await runCommand('npm', [
        'install', '--prefix', downloadDir, '--no-save', '--no-package-lock',
        '--ignore-scripts', '--no-audit', '--no-fund', `${TOOLKIT_PACKAGE}@${toolsVersion}`
      ], downloadDir)

      const toolRoot = path.join(downloadDir, 'node_modules', TOOLKIT_PACKAGE)
      const pkg = JSON.parse(await readFile(path.join(toolRoot, 'package.json'), 'utf8'))
      if (pkg.name !== TOOLKIT_PACKAGE || !/^\d+\.\d+\.\d+$/.test(pkg.version)) {
        throw new Error('Downloaded package has an unsupported toolkit name or version.')
      }
      if (pkg.commerceUpgradeToolkit?.installerApiVersion !== 1) {
        throw new Error(`Toolkit v${pkg.version} does not support this setup command. A toolkit release with installer API v1 is required.`)
      }
      for (const script of ['setup-project.mjs', 'update-project.mjs', 'verify-integrity.mjs']) {
        const stat = await lstat(path.join(toolRoot, 'scripts', script))
        if (!stat.isFile()) throw new Error(`Downloaded toolkit is missing its installer entry point: ${script}`)
      }
      this.log(`Downloaded toolkit v${pkg.version} for ${selectedAgent}`)

      const agentDir = agent === 'github-copilot' ? '.github' : '.claude'
      const marker = path.join(projectRoot, agentDir, 'context', '.ccua-version')
      let installed = false
      try {
        await lstat(marker)
        installed = true
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      const script = installed ? 'update-project.mjs' : 'setup-project.mjs'
      currentStep = installed ? 'toolkit update' : 'toolkit installation'
      this.log(`${installed ? 'Updating' : 'Installing'} toolkit in ${projectRoot}...`)
      await runCommand(process.execPath, [
        path.join(toolRoot, 'scripts', script), '--project', projectRoot,
        '--agent', agent, '--skip-codegraph'
      ], projectRoot)

      currentStep = 'installation verification'
      const installedVersion = (await readFile(marker, 'utf8')).trim()
      if (installedVersion !== pkg.version) {
        throw new Error(`Expected toolkit v${pkg.version}, but project has v${installedVersion}. Downgrades are not supported.`)
      }
      await runCommand(process.execPath, [
        path.join(toolRoot, 'scripts', 'verify-integrity.mjs'), '--project', projectRoot, '--agent', agent
      ], projectRoot)

      this.log(`\nCommerce Upgrade Tools setup complete (v${pkg.version})!`)
      this.log(`Project: ${projectRoot}`)
      this.log(`Agent: ${selectedAgent}`)
      this.log('Restart your coding agent, then run /upgrade-hop to begin.')
    } catch (error) {
      this.error(`Commerce Upgrade Tools setup failed during ${currentStep}: ${error.message}`, { exit: 1 })
    } finally {
      if (downloadDir) await rm(downloadDir, { recursive: true, force: true })
    }
  }
}

ToolsSetupCommand.description = 'Download the Adobe Commerce Upgrade Toolkit and install or update its verified agent workflows in a Commerce project.'

ToolsSetupCommand.flags = {
  agent: Flags.string({
    char: 'a',
    description: 'Coding agent to install for (prompts if omitted)',
    options: Object.keys(AGENTS)
  }),
  project: Flags.string({
    char: 'p',
    description: 'Existing Commerce project (defaults to the current directory)'
  }),
  'tools-version': Flags.string({
    char: 'v',
    description: 'Exact toolkit version or npm tag',
    default: 'latest'
  })
}

ToolsSetupCommand.examples = [
  '$ aio commerce upgrade tools-setup',
  '$ aio commerce upgrade tools-setup --agent "GitHub Copilot"',
  '$ aio commerce upgrade tools-setup --agent "Claude Code" --tools-version 1.0.1',
  '$ aio commerce upgrade tools-setup --project /path/to/commerce/project'
]

module.exports = ToolsSetupCommand
