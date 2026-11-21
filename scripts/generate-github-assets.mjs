#!/usr/bin/env node
// Generates the canonical .github/* GitHub Copilot toolkit tree from the .claude/* source
// of truth, mirroring the same block-by-block mapping used by the sibling App Builder
// toolkit (project-ccma) to port its Claude Code assets to Copilot:
//
//   agents/*.md              -> .github/agents/*.agent.md      (tools frontmatter translated)
//   skills/<name>.md         -> .github/skills/<name>/SKILL.md (same format, add frontmatter)
//   commands/*.md            -> .github/skills/<name>/SKILL.md (all ccua commands in
//                                SKILL_COMMANDS below are phase-gated/resumable
//                                orchestrations, not one-shot prompts)
//   guardrails/*.md           -> .github/instructions/*.instructions.md
//   context/*.html            -> owning skill's assets/ folder (upgrade-hop-report)
//   context/*.md (rest)       -> .github/context/*.md (flat mirror)
//   scripts/*.py               -> .github/scripts/*.py (flat mirror — json_to_toon.py)
//   hooks/*.mjs               -> .github/hooks/*.mjs + a *.json wrapper (documented, not
//                                enforced — Copilot has no equivalent hook runtime)
//   settings.json             -> .github/copilot-settings-notes.md (no single Copilot
//                                equivalent for the Bash permissions allow/deny lists)
//   CLAUDE.md                 -> .github/copilot-instructions.md
//
// Re-runnable: safe to run again whenever .claude/* changes to regenerate .github/* from scratch.
import fs from 'fs-extra'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const claudeDir = path.join(root, '.claude')
const githubDir = path.join(root, '.github')

// All ccua commands in SKILL_COMMANDS are phase-gated / resumable orchestrations with bundled
// report assets, so all become Skills rather than Prompts — there is no simple one-shot command
// in this toolkit that maps cleanly to a Copilot .prompt.md file.
const SKILL_COMMANDS = new Set([
  'upgrade-hop', 'upgrade-hop-execute', 'upgrade-deploy-prep', 'upgrade-assess', 'upgrade-rollback'
])

// context/*.html templates that move under their owning skill's assets/ folder.
const CONTEXT_ASSET_OWNERS = {
  'upgrade-report-template.html': 'upgrade-hop-report'
}

// applyTo scoping for converted guardrails -> instructions (avoid "**" overreach).
const GUARDRAIL_APPLY_TO = {
  'deployment-safety': '.magento.env.yaml,.magento/services.yaml,app/etc/env.php,scripts/**',
  'frontend-upgrade-safety': 'app/design/**,view/*/web/**,**/*.css,**/*.less,**/*.scss',
  'no-core-overrides': 'vendor/**',
  'pii-protection': 'app/code/**/Model/**,app/code/**/Observer/**,app/code/**/Plugin/**',
  'websearch-scope': '**/*.md',
  'untrusted-data': '**',
  'write-scope': '**',
  'encryption-safety': '**',
  'secure-code-generation': '**'
}

const TOOL_ALIAS_MAP = {
  Read: 'read',
  Write: 'edit',
  Edit: 'edit',
  Grep: 'search',
  Glob: 'search',
  WebSearch: 'web',
  WebFetch: 'web',
  Agent: 'agent',
  TodoWrite: 'todo'
}

// Claude Code's agent frontmatter accepts short model aliases (sonnet/opus/haiku) that its own
// harness resolves internally. GitHub Copilot's agent runtime has no such alias table — it
// validates `model:` against its own catalog of real model IDs, so the alias must be translated,
// not copied verbatim. Update this map if the alias's target generation changes.
const GITHUB_MODEL_MAP = {
  sonnet: 'claude-sonnet-5',
  opus: 'claude-opus-5',
  haiku: 'claude-haiku-4.5'
}

// Descriptions may contain ': ' or '#', which break unquoted YAML and make Copilot skip the skill.
function yamlScalar (value = '') {
  return JSON.stringify(String(value))
}

function convertModel (model) {
  if (!model) return model
  return GITHUB_MODEL_MAP[model.trim().toLowerCase()] || model
}

function parseFrontmatter (raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return { data: {}, body: raw }
  const [, fm, body] = m
  const data = {}
  let currentKey = null
  for (const line of fm.split('\n')) {
    const keyMatch = line.match(/^([a-zA-Z_]+):\s*(.*)$/)
    if (keyMatch) {
      currentKey = keyMatch[1]
      data[currentKey] = keyMatch[2]
    } else if (currentKey && /^\s+\S/.test(line)) {
      data[currentKey] += ' ' + line.trim()
    }
  }
  return { data, body }
}

function convertToolsList (toolsStr = '') {
  const items = toolsStr.split(',').map((s) => s.trim()).filter(Boolean)
  const aliases = new Set()
  const mcp = []
  for (const item of items) {
    if (item.startsWith('mcp__')) { mcp.push(item); continue }
    if (item === 'Bash' || item.startsWith('Bash(')) { aliases.add('execute'); continue }
    if (item === '*') { aliases.add('*'); continue }
    aliases.add(TOOL_ALIAS_MAP[item] || item.toLowerCase())
  }
  return [...aliases, ...mcp].join(', ')
}

function portClaudePaths (text) {
  text = text.replace(/--agent claude-code/g, '--agent github-copilot')
  // ~/.claude/tools/... is Claude Code's user-home tool cache — not a project-local .claude/
  // path, so the generic .claude/ -> .github/ rule below would be misleading (there's no
  // home-level .github convention). Point it at a neutral, agent-independent cache dir instead.
  text = text.replace(/~\/\.claude\/tools\//g, '~/.aio-ccua/tools/')
  // .claude/settings.json's permissions.allow/deny has no Copilot equivalent — the closest
  // thing is the notes file the generator writes documenting the gap.
  text = text.replace(/\.claude\/settings\.json/g, '.github/copilot-settings-notes.md')
  // context/*.html assets that move under their owning skill's assets/ folder
  text = text.replace(/\.claude\/context\/([a-zA-Z0-9_.-]+\.html)/g, (m, file) => {
    const owner = CONTEXT_ASSET_OWNERS[file]
    return owner ? `.github/skills/${owner}/assets/${file}` : `.github/context/${file}`
  })
  // skills/<name>.md -> skills/<name>/SKILL.md
  text = text.replace(/\.claude\/skills\/([a-zA-Z0-9_-]+)\.md/g, '.github/skills/$1/SKILL.md')
  // guardrails/<name>.md -> instructions/<name>.instructions.md
  text = text.replace(/\.claude\/guardrails\/([a-zA-Z0-9_-]+)\.md/g, '.github/instructions/$1.instructions.md')
  // commands/<name>.md -> skills/<name>/SKILL.md (all ccua commands are phase-gated)
  text = text.replace(/\.claude\/commands\/([a-zA-Z0-9_-]+)\.md/g, (m, name) => {
    return SKILL_COMMANDS.has(name) ? `.github/skills/${name}/SKILL.md` : `.github/prompts/${name}.prompt.md`
  })
  // anything left (reports/, scripts/, context/*.md, hooks/, etc.)
  return text.replace(/\.claude\//g, '.github/')
}

function isMetadataLine (line) {
  return /^\*\*[\w /]+:\*\*/.test(line)
}

function firstParagraph (body) {
  const lines = body.split('\n')
  let i = 0
  while (i < lines.length) {
    const trimmed = lines[i].trim()
    if (!trimmed || trimmed.startsWith('#') || isMetadataLine(trimmed)) { i++; continue }
    if (trimmed.startsWith('|') || trimmed.startsWith('```') || trimmed.startsWith('-')) { i++; continue }
    break
  }
  const para = []
  for (; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed) break
    if (trimmed.startsWith('|') || trimmed.startsWith('```') || trimmed.startsWith('-')) break
    para.push(trimmed)
  }
  const text = para.join(' ').trim()
  return text.length > 240 ? text.slice(0, 237) + '...' : text
}

function firstSentence (text, fallbackLen = 240) {
  const m = text.match(/^(.*?[.!?])(\s|$)/)
  const sentence = m ? m[1] : text
  return sentence.length > fallbackLen ? sentence.slice(0, fallbackLen - 3) + '...' : sentence
}

async function generateAgents () {
  const srcDir = path.join(claudeDir, 'agents')
  const destDir = path.join(githubDir, 'agents')
  await fs.ensureDir(destDir)
  const files = (await fs.readdir(srcDir)).filter((f) => f.endsWith('.md'))
  for (const file of files) {
    const raw = await fs.readFile(path.join(srcDir, file), 'utf8')
    const { data, body } = parseFrontmatter(raw)
    const fmLines = [
      '---',
      `name: ${data.name}`,
      `description: ${yamlScalar(data.description)}`,
      `tools: ${convertToolsList(data.tools)}`
    ]
    if (data.model) fmLines.push(`model: ${convertModel(data.model)}`)
    fmLines.push('---')
    const out = `${fmLines.join('\n')}\n${portClaudePaths(body)}`
    const destName = file.replace(/\.md$/, '.agent.md')
    await fs.writeFile(path.join(destDir, destName), out)
  }
  console.log(`  ✓ agents: ${files.length} -> .github/agents/*.agent.md`)
}

async function generateKnowledgeSkills () {
  const srcDir = path.join(claudeDir, 'skills')
  const destRoot = path.join(githubDir, 'skills')
  const files = (await fs.readdir(srcDir)).filter((f) => f.endsWith('.md'))
  for (const file of files) {
    const name = file.replace(/\.md$/, '')
    const raw = await fs.readFile(path.join(srcDir, file), 'utf8')
    const description = portClaudePaths(firstParagraph(raw) ||
      `Reference and remediation patterns for ${name.replace(/-/g, ' ')} during an Adobe Commerce upgrade.`)
    const fm = ['---', `name: ${name}`, `description: ${yamlScalar(description)}`, '---'].join('\n')
    const destDir = path.join(destRoot, name)
    await fs.ensureDir(destDir)
    await fs.writeFile(path.join(destDir, 'SKILL.md'), `${fm}\n\n${portClaudePaths(raw)}`)
  }
  console.log(`  ✓ knowledge skills: ${files.length} -> .github/skills/<name>/SKILL.md`)
  return files.map((f) => f.replace(/\.md$/, ''))
}

async function generateCommands () {
  const srcDir = path.join(claudeDir, 'commands')
  const promptsDir = path.join(githubDir, 'prompts')
  const skillsRoot = path.join(githubDir, 'skills')
  await fs.ensureDir(promptsDir)
  const files = (await fs.readdir(srcDir)).filter((f) => f.endsWith('.md'))
  let promptCount = 0
  let skillCount = 0
  for (const file of files) {
    const name = file.replace(/\.md$/, '')
    const raw = await fs.readFile(path.join(srcDir, file), 'utf8')
    const body = portClaudePaths(raw)
    const description = portClaudePaths(name === 'upgrade-deploy-prep'
      ? 'Review deployment-readiness and prepare the deploy runbook for a completed Adobe Commerce upgrade.'
      : firstParagraph(raw) || `Run the ${name} workflow.`)
    if (SKILL_COMMANDS.has(name)) {
      const destDir = path.join(skillsRoot, name)
      await fs.ensureDir(destDir)
      const fm = ['---', `name: ${name}`, `description: ${yamlScalar(description)}`, '---'].join('\n')
      await fs.writeFile(path.join(destDir, 'SKILL.md'), `${fm}\n\n${body}`)
      skillCount++
    } else {
      const fm = ['---', `description: ${yamlScalar(description)}`, 'mode: agent', '---'].join('\n')
      await fs.writeFile(path.join(promptsDir, `${name}.prompt.md`), `${fm}\n\n${body}`)
      promptCount++
    }
  }
  console.log(`  ✓ commands: ${skillCount} -> .github/skills/<name>/SKILL.md, ${promptCount} -> .github/prompts/*.prompt.md`)
}

async function generateInstructions () {
  const srcDir = path.join(claudeDir, 'guardrails')
  const destDir = path.join(githubDir, 'instructions')
  await fs.ensureDir(destDir)
  const files = (await fs.readdir(srcDir)).filter((f) => f.endsWith('.md'))
  for (const file of files) {
    const name = file.replace(/\.md$/, '')
    const raw = await fs.readFile(path.join(srcDir, file), 'utf8')
    const ruleMatch = raw.match(/## (?:Rule|Absolute rules?[^\n]*)\s*\n+([\s\S]*?)(?:\n\s*\n|$)/)
    let ruleText = ''
    if (ruleMatch) {
      const rawLines = ruleMatch[1].split('\n').map((l) => l.trim()).filter(Boolean)
      const isMarker = (l) => /^-\s+/.test(l) || /^\d+\.\s+/.test(l)
      // Reconstruct logical items first: a marker line starts a new item; a
      // following unmarked line is a soft-wrap continuation of THAT item, not
      // independent prose (a naive per-line join mixes wrapped fragments of
      // different numbered items together, or lets the "1."/"2." markers
      // themselves confuse firstSentence()'s period-detection).
      const items = []
      for (const line of rawLines) {
        if (isMarker(line) || items.length === 0) items.push(line)
        else items[items.length - 1] += ' ' + line
      }
      const proseItems = items.filter((l) => !isMarker(l))
      if (proseItems.length) {
        ruleText = proseItems.join(' ').replace(/\s+/g, ' ').trim()
      } else if (items.length) {
        // No standalone prose line — the whole section is a list (e.g. a
        // numbered "Absolute rules" block). Use the first fully-reconstructed
        // item, marker stripped, as the description source.
        ruleText = items[0].replace(/^-\s*|^\d+\.\s*/, '')
      }
    }
    const description = (ruleText ? firstSentence(ruleText) : firstParagraph(raw)) || `Guardrail: ${name}`
    const applyTo = GUARDRAIL_APPLY_TO[name] || '**/*'
    const fm = ['---', `description: ${yamlScalar(description)}`, `applyTo: "${applyTo}"`, '---'].join('\n')
    await fs.writeFile(path.join(destDir, `${name}.instructions.md`), `${fm}\n\n${portClaudePaths(raw)}`)
  }
  console.log(`  ✓ guardrails: ${files.length} -> .github/instructions/*.instructions.md`)
}

async function generateHooks () {
  const srcFile = path.join(claudeDir, 'hooks', 'check-toolkit-version.mjs')
  const destDir = path.join(githubDir, 'hooks')
  await fs.ensureDir(destDir)
  if (!await fs.pathExists(srcFile)) return
  const raw = await fs.readFile(srcFile, 'utf8')
  // The hook's version-marker paths are built with path.join('.claude', 'context', ...)
  // rather than a literal '.claude/context/...' string, so the generic path-porting regex
  // above can't see them — swap the literal directory-name string directly instead.
  const ported = raw.replace(/'\.claude'/g, "'.github'")
  await fs.writeFile(path.join(destDir, 'check-toolkit-version.mjs'), ported)
  const hookConfig = {
    _comment: 'No automatic command hooks. Run version checks manually under separate approval.',
    hooks: {}
  }
  await fs.writeJson(path.join(destDir, 'check-toolkit-version.json'), hookConfig, { spaces: 2 })
  console.log('  ✓ hooks: check-toolkit-version.mjs -> .github/hooks/check-toolkit-version.mjs + .json (documented, not enforced)')
}

async function generateScripts () {
  const srcDir = path.join(claudeDir, 'scripts')
  const destDir = path.join(githubDir, 'scripts')
  if (!await fs.pathExists(srcDir)) return
  await fs.ensureDir(destDir)
  const files = (await fs.readdir(srcDir, { withFileTypes: true }))
    .filter(entry => entry.isFile()).map(entry => entry.name)
  for (const file of files) {
    await fs.copy(path.join(srcDir, file), path.join(destDir, file), { overwrite: true })
  }
  console.log(`  ✓ scripts: ${files.length} -> .github/scripts/ (mirrored)`)
}

async function generateContext (skillNames) {
  const srcDir = path.join(claudeDir, 'context')
  const destDir = path.join(githubDir, 'context')
  await fs.ensureDir(destDir)
  const files = await fs.readdir(srcDir)
  let moved = 0
  let mirrored = 0
  for (const file of files) {
    const owner = CONTEXT_ASSET_OWNERS[file]
    if (owner && skillNames.includes(owner)) {
      const assetsDir = path.join(githubDir, 'skills', owner, 'assets')
      await fs.ensureDir(assetsDir)
      await fs.copy(path.join(srcDir, file), path.join(assetsDir, file), { overwrite: true })
      moved++
      continue
    }
    const raw = await fs.readFile(path.join(srcDir, file), 'utf8').catch(() => null)
    if (raw === null) { await fs.copy(path.join(srcDir, file), path.join(destDir, file), { overwrite: true }); continue }
    await fs.writeFile(path.join(destDir, file), portClaudePaths(raw))
    mirrored++
  }
  console.log(`  ✓ context: ${moved} moved under owning skill assets/, ${mirrored} mirrored to .github/context/`)
}

async function generateCopilotInstructions () {
  const srcFile = path.join(root, 'CLAUDE.md')
  if (!await fs.pathExists(srcFile)) return
  let raw = await fs.readFile(srcFile, 'utf8')
  raw = portClaudePaths(raw)
  raw = raw.replace(
    /Adobe Commerce Upgrade Toolkit — Claude Code Instructions/,
    'Adobe Commerce Upgrade Toolkit — GitHub Copilot Instructions'
  )
  await fs.writeFile(path.join(githubDir, 'copilot-instructions.md'), raw)
  console.log('  ✓ CLAUDE.md -> .github/copilot-instructions.md')
}

async function generateSettingsNotes () {
  const notes = '# Copilot Settings Notes\n\n' +
    '## Automatic routine non-production profile\n\n' +
    'Read `.github/instructions/write-scope.instructions.md`. The current skill session is orchestrator;\n' +
    'the separate researcher is read-only. Approve the isolated instance/hop/routine scope once,\n' +
    'then automatically execute authorized routine commands and scoped metadata updates.\n' +
    'Application/config/test diffs, sensitive and outside-scope actions need separate approval.\n' +
    'Agent `execute` availability is broad, not a per-command permission grant. Repository\n' +
    'frontmatter and Markdown cannot enforce host isolation or intercept native execution.\n' +
    'Verify effective parent/subagent permissions in an isolated disposable non-production\n' +
    'host without production credentials/access; otherwise return human-run proposals.\n\n' +
    'For CLI use `copilot config defaultPermissionMode manual` and\n' +
    '`copilot config disableAllHooks true` (user-wide), then start a fresh project session.\n' +
    'Use `/reset-allowed-tools` before/after a run. Start `copilot` normally; no agent flag is required.\n' +
    'Grant only reviewed routine command/path permissions for the active session. No allow-all,\n' +
    'assisted auto-approval or broad shell grants. Path read/write denies do not constrain shell commands;\n' +
    'secret exclusion requires host filesystem isolation. Review execution-capable MCP servers.\n\n' +
    'No default CodeGraph registration or grants; activation is blocked pending review.\n' +
    'No automatic command hooks are shipped. Older installed hooks/settings and root\n' +
    'instructions are preserved: compare and merge the reviewed templates manually.\n' +
    'An asset update alone does not change host permissions. See `docs/security-migration.md`.\n'
  await fs.writeFile(path.join(githubDir, 'copilot-settings-notes.md'), notes)
  console.log('  ✓ settings.json -> .github/copilot-settings-notes.md')
}

async function main () {
  console.log(`Generating .github/* GitHub Copilot toolkit tree from ${claudeDir} ...`)
  await fs.ensureDir(githubDir)
  await generateAgents()
  const skillNames = await generateKnowledgeSkills()
  await generateCommands()
  await generateInstructions()
  await generateHooks()
  await generateScripts()
  await generateContext(skillNames)
  await generateCopilotInstructions()
  await generateSettingsNotes()
  console.log('\n✅ .github/* generation complete.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
