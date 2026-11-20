// Copyright 2026 Adobe. All rights reserved.
// Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');

test('generated discovery metadata identifies each security-sensitive upgrade skill purpose', () => {
  for (const [name, purpose] of [
    ['encryption-and-passwords', /password hashing.*encryption-key rotation/],
    ['marketplace-extension-analysis', /extensions.*compatibility matrix/],
    ['upgrade-deploy-prep', /deployment-readiness.*deploy runbook/],
    ['upgrade-uca-scan', /Normalize.*Upgrade Compatibility Tool.*findings/],
  ]) {
    const text = read(`.github/skills/${name}/SKILL.md`);
    const description = text.match(/^description: (.+)$/m)?.[1];
    assert.ok(description, name);
    assert.match(description, purpose);
    assert.doesNotMatch(description, /^Read @|\.claude\//);
    assert.match(text, /Read @\.github\/instructions\/untrusted-data\.instructions\.md/);
  }
});

test('all generated skill descriptions port canonical paths consistently with their bodies', () => {
  for (const name of readdirSync(join(root, '.github/skills'))) {
    const text = read(`.github/skills/${name}/SKILL.md`);
    const description = text.match(/^description: (.+)$/m)?.[1];
    assert.ok(description, name);
    assert.doesNotMatch(description, /\.claude\//, name);
  }
});

test('all upgrade entry points run in the current session without selecting a custom agent', () => {
  for (const name of ['upgrade-hop', 'upgrade-hop-execute', 'upgrade-deploy-prep', 'upgrade-assess']) {
    for (const path of [`.claude/commands/${name}.md`, `.github/skills/${name}/SKILL.md`]) {
      const text = read(path);
      assert.match(text, /current Copilot\/Claude session as `orchestrator`/, path);
      assert.match(text, /No custom-agent selection or CLI agent flag is required/, path);
      assert.match(text, /not an entry-point prerequisite/, path);
      assert.match(text, /Retain effective host permissions and all non-production, scope and sensitive-action gates/, path);
      const step = text.search(/^#{2,3} Step [01]/m);
      assert.ok(step > text.indexOf('## Session orchestration'), path);
    }
  }
  for (const path of ['CLAUDE.md', '.github/copilot-instructions.md']) {
    assert.match(read(path), /Upgrade skills execute directly in the current session as `orchestrator`/);
  }
  assert.match(read('.claude/guardrails/write-scope.md'), /Do not gate execution on the selected agent's name/);
  for (const path of ['README.md', 'docs/security-migration.md', '.github/copilot-settings-notes.md']) {
    assert.doesNotMatch(read(path), /copilot --agent commerce-upgrade-analyst/, path);
  }
});

test('generated frontmatter descriptions are quoted so colons cannot break skill loading', () => {
  for (const name of readdirSync(join(root, '.github/skills'))) {
    const description = read(`.github/skills/${name}/SKILL.md`).match(/^description: (.+)$/m)?.[1];
    assert.ok(description?.startsWith('"') && description.endsWith('"'), name);
    assert.doesNotThrow(() => JSON.parse(description), name);
  }
});
