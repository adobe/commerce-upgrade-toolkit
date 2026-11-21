// Copyright 2026 Adobe. All rights reserved.
// Licensed under the Apache License, Version 2.0.
// https://www.apache.org/licenses/LICENSE-2.0
// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, linkSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const python = args => spawnSync('python3', ['-B', ...args],
  { cwd: root, encoding: 'utf8', timeout: 10000 });
const read = file => readFileSync(join(root, file), 'utf8');
const put = (dir, file, text = '<?php // NON_SECRET_FIXTURE\n') => {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), text);
};
function fixture(run) {
  const dir = mkdtempSync(join(root, '.pr-safety-test-'));
  try {
    for (const prefix of ['.claude', '.github']) mkdirSync(join(dir, prefix, 'context'), { recursive: true });
    run(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('both flavors quarantine credential paths and refuse subsequent reads without leaking fixture contents', () =>
  fixture(dir => {
    const paths = ['app/etc/env.php', 'auth.json', '.env', '.env.local', 'keys/site.pem',
      'keys/id_ed25519', 'credentials/config.php', 'secrets/token.php', '.aws/credentials',
      'vendor/example/package/auth.json', 'app/code/Vendor/Module/ENV.PHP'];
    for (const file of paths) put(dir, file);
    const records = paths.map(file => ({ file, line: 1, code: 'W-083', type: 'DEPRECATED_CLASS',
      message: 'Class Magento\\Example is deprecated' }));
    put(dir, 'raw.json', JSON.stringify({ targetVersion: '2.4.8', errors: records, warnings: [] }));
    for (const prefix of ['.claude', '.github']) {
      const output = `${prefix}/context/upgrade-findings.normalized.json`;
      const result = python([join(root, prefix, 'scripts/normalize_uct.py'), 'raw.json', output,
        `${prefix}/context/upgrade-findings.quarantine.json`, '--project-root', dir]);
      assert.equal(result.status, 2, result.stderr);
      const data = JSON.parse(readFileSync(join(dir, output), 'utf8'));
      assert.deepEqual(data.counts, { accepted: 0, quarantined: paths.length, total: paths.length });
      assert.equal(data.blocked, true);
      const before = readFileSync(join(dir, output), 'utf8');
      const badInput = python([join(root, prefix, 'scripts/normalize_uct.py'), 'auth.json', output,
        `${prefix}/context/upgrade-findings.quarantine.json`, '--project-root', dir]);
      assert.equal(badInput.status, 1);
      assert.equal(readFileSync(join(dir, output), 'utf8'), before);
      assert.doesNotMatch(badInput.stdout + badInput.stderr, /NON_SECRET_FIXTURE/);
      for (const file of paths) {
        const blocked = python([join(root, prefix, 'scripts/read_source.py'), file, '--project-root', dir]);
        assert.equal(blocked.status, 1);
        assert.doesNotMatch(blocked.stdout + blocked.stderr, /NON_SECRET_FIXTURE/);
      }
    }
  }));

test('source gate preserves ordinary app/vendor reads and rejects aliases, traversal and source execution', () =>
  fixture(dir => {
    put(dir, 'app/code/Vendor/Module/Model/Example.php', '<?php throw new Exception("DO_NOT_EXECUTE");\n');
    put(dir, 'vendor/magento/module-example/Model/Example.php', '<?php // <UNTRUSTED>&\n');
    put(dir, 'alias-target.php');
    linkSync(join(dir, 'alias-target.php'), join(dir, 'hardlink.php'));
    symlinkSync(join(dir, 'alias-target.php'), join(dir, 'symlink.php'));
    for (const prefix of ['.claude', '.github']) {
      for (const file of ['app/code/Vendor/Module/Model/Example.php',
        'vendor/magento/module-example/Model/Example.php']) {
        const result = python([join(root, prefix, 'scripts/read_source.py'), file, '--project-root', dir]);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(JSON.parse(result.stdout).untrusted_data, readFileSync(join(dir, file), 'utf8'));
        assert.doesNotMatch(result.stdout, /<UNTRUSTED>|&/);
        put(dir, 'raw.json', JSON.stringify({ targetVersion: '2.4.8', warnings: [{
          file, line: 1, code: 'W-083', type: 'DEPRECATED_CLASS', message: 'Class Magento\\Example is deprecated',
        }] }));
        const normalized = python([join(root, prefix, 'scripts/normalize_uct.py'), 'raw.json',
          `${prefix}/context/upgrade-findings.normalized.json`,
          `${prefix}/context/upgrade-findings.quarantine.json`, '--project-root', dir]);
        assert.equal(normalized.status, 0, normalized.stderr);
      }
      for (const file of ['hardlink.php', 'symlink.php', '../alias-target.php', '/etc/passwd']) {
        assert.equal(python([join(root, prefix, 'scripts/read_source.py'), file, '--project-root', dir]).status, 1);
      }
      assert.equal(read(`${prefix}/scripts/read_source.py`), read('.claude/scripts/read_source.py'));
    }
  }));

test('source read refuses a parent swapped to an outside symlink after path validation', () => {
  for (const prefix of ['.claude', '.github']) {
    const result = python(['-c', `
import importlib.util, io, pathlib, sys, tempfile
from contextlib import redirect_stdout
sys.path.insert(0, "${prefix}/scripts")
spec = importlib.util.spec_from_file_location("source_reader", "${prefix}/scripts/read_source.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
with tempfile.TemporaryDirectory(dir=".") as directory:
    project = pathlib.Path(directory) / "project"; parent = project / "app" / "code"
    outside = pathlib.Path(directory) / "outside"
    parent.mkdir(parents=True); outside.mkdir()
    (parent / "Example.php").write_text("safe fixture")
    (outside / "Example.php").write_text("OUTSIDE_NON_SECRET_FIXTURE")
    original = m.source_file
    def swap(root, name):
        path = original(root, name)
        parent.rename(parent.with_name("previous"))
        parent.symlink_to(outside.resolve(), target_is_directory=True)
        return path
    m.source_file = swap
    sys.argv = ["read_source", "app/code/Example.php", "--project-root", str(project)]
    output = io.StringIO()
    with redirect_stdout(output): assert m.main() == 1
    assert "OUTSIDE_NON_SECRET_FIXTURE" not in output.getvalue()
`]);
    assert.equal(result.status, 0, result.stderr);
  }
});

test('normalizer fsyncs staged files before each rename and destination directories afterward', () => {
  for (const prefix of ['.claude', '.github']) {
    const result = python(['-c', `
import importlib.util, os, pathlib, stat, tempfile
spec = importlib.util.spec_from_file_location("normalizer", "${prefix}/scripts/normalize_uct.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
events = []; sync = os.fsync; rename = os.rename
def tracked_sync(fd):
    events.append("directory" if stat.S_ISDIR(os.fstat(fd).st_mode) else "file")
    sync(fd)
def tracked_rename(path, target, **kwargs):
    events.append("rename")
    return rename(path, target, **kwargs)
os.fsync = tracked_sync; os.rename = tracked_rename
os.supports_dir_fd = os.supports_dir_fd | {tracked_rename}
with tempfile.TemporaryDirectory(dir=".") as directory:
    parent = pathlib.Path(directory).resolve()
    first = parent / "first.json"; second = parent / "second.json"
    m.write_artifacts(((first, "one"), (second, "two")))
    assert events == ["file", "file", "rename", "directory", "rename", "directory"], events
    assert first.read_text() == "one" and second.read_text() == "two"
    def failed_sync(fd):
        if stat.S_ISDIR(os.fstat(fd).st_mode): raise OSError("synthetic directory fsync failure")
        sync(fd)
    os.fsync = failed_sync
    try: m.write_artifacts(((first, "changed"), (second, "not published")))
    except OSError: pass
    else: raise AssertionError("durability failure suppressed")
    assert second.read_text() == "two"
`]);
    assert.equal(result.status, 0, result.stderr);
  }
});

test('capture fsyncs destination after replacement and blocks completion on durability failure', () => {
  for (const prefix of ['.claude', '.github']) {
    const result = python(['-c', `
import importlib.util, os, pathlib, stat, sys, tempfile
sys.path.insert(0, "${prefix}/scripts")
spec = importlib.util.spec_from_file_location("capture", "${prefix}/scripts/capture_uct.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
sync = os.fsync; replace = os.replace
for fail in (False, True):
    events = []
    def tracked_sync(fd):
        directory = stat.S_ISDIR(os.fstat(fd).st_mode)
        events.append("directory" if directory else "file")
        if directory and fail: raise OSError("synthetic directory fsync failure")
        sync(fd)
    def tracked_replace(*args, **kwargs):
        events.append("replace"); return replace(*args, **kwargs)
    os.fsync = tracked_sync; os.replace = tracked_replace
    with tempfile.TemporaryDirectory(dir=".") as directory:
        context = pathlib.Path(directory) / "${prefix}" / "context"; context.mkdir(parents=True)
        agent = "claude-code" if "${prefix}" == ".claude" else "github-copilot"
        sys.argv = ["capture", "--project-root", directory, "--agent", agent, "--mode", "stdout",
            "--", sys.executable, "-c", 'import json; print(json.dumps({"errors": [], "warnings": []}))']
        assert m.main() == (1 if fail else 0)
        assert events == ["file", "replace", "directory"], events
`]);
    assert.equal(result.status, 0, result.stderr);
  }
});

test('both URL helpers restrict devdocs versions to valid ASCII major.minor[.patch] segments', () => {
  for (const prefix of ['.claude', '.github']) {
    for (const version of ['2.4', 'v2.4', '2.4.8', 'v2.4.8']) {
      assert.equal(python([`${prefix}/scripts/research_url.py`, 'validate',
        `https://devdocs.magento.com/guides/${version}/index.html`]).status, 0);
    }
    for (const version of ['v', '2', '.2.4', '2..4', '2.4.', '2.4.8.1', 'v٢.٤']) {
      assert.equal(python([`${prefix}/scripts/research_url.py`, 'validate',
        `https://devdocs.magento.com/guides/${version}/index.html`]).status, 1);
    }
  }
});

test('setup wrapper rejects every duplicate long/short project combination before probes or writes', () =>
  fixture(dir => {
    for (const first of ['--project', '-p']) for (const second of ['--project', '-p']) {
      const result = spawnSync('bash', ['setup.sh', first, dir, second, dir],
        { cwd: root, encoding: 'utf8', timeout: 10000 });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Duplicate flag: --project/);
      assert.doesNotMatch(result.stdout, /Checking prerequisites|Setup complete/);
    }
  }));

test('extension provenance and UCT ownership preserve reviewed evidence and gated execution', () => {
  for (const prefix of ['.claude', '.github']) {
    const skill = name => read(prefix === '.claude' ? `${prefix}/skills/${name}.md`
      : `${prefix}/skills/${name}/SKILL.md`);
    const extensions = skill('marketplace-extension-analysis');
    assert.doesNotMatch(extensions, /source: "marketplace"|orchestrator\/DevOps/);
    assert.match(extensions, /source: \{actualEvidenceKind\}/);
    assert.match(extensions, /reference: \{validatedURLOrReviewedLocalPath\}/);
    assert.match(extensions, /sha256: \{reviewedContentSha256\}/);
    assert.match(extensions, /keep compatibility UNKNOWN and blocking/);
    const uct = skill('uct-install');
    assert.match(uct, /Execution ownership \(all steps\)/);
    assert.match(uct, /separate exact-command\/cwd\/environment\/effect/);
    assert.match(uct, /automatically runs authorized probe, capture, scan and normalization/);
    assert.match(uct, /local\/dev non-production/);
    assert.match(uct, /no automatic retry or blanket/);
    assert.match(uct, /If host approval\/isolation is unavailable, the human runs/);
    assert.doesNotMatch(uct, /^Run the helper on the host/m);
  }
});

test('frontend review handoffs distinguish prepared data from verified report persistence', () => {
  for (const prefix of ['.claude', '.github']) {
    const skill = read(prefix === '.claude' ? `${prefix}/skills/frontend-upgrade-analysis.md`
      : `${prefix}/skills/frontend-upgrade-analysis/SKILL.md`);
    const agent = read(prefix === '.claude' ? `${prefix}/agents/commerce-frontend-developer.md`
      : `${prefix}/agents/commerce-frontend-developer.agent.md`);
    assert.match(skill, /propose these updates for the approved orchestrator/);
    assert.match(skill, /Frontend review package prepared; persistence pending/);
    assert.match(skill, /Only after a successful write and read-back verification may/);
    assert.match(skill, /separate live approval for the exact report\/state diff and destination/);
    assert.match(skill, /If approval is missing or writing\/verification fails/);
    assert.doesNotMatch(skill, /Announce: "Frontend review package written/);
    assert.match(agent, /Proposed report destination:/);
    assert.match(agent, /Persistence pending: returned review data is not a saved file/);
    assert.match(agent, /Never announce that a report was written or delivered/);
    assert.match(agent, /human operator runs/);
    assert.doesNotMatch(agent.split('---')[1], /\b(?:Write|Edit|Bash|edit|execute)\b/);
  }
});

test('generated source gates and estimate legends remain aligned with approval-gated execution', () => {
  for (const file of ['.claude/commands/upgrade-hop.md', '.github/skills/upgrade-hop/SKILL.md',
    '.claude/skills/upgrade-hop-report.md', '.github/skills/upgrade-hop-report/SKILL.md']) {
    assert.doesNotMatch(read(file), /this session executes directly/);
    assert.match(read(file), /Project commands require approved routine scope/);
  }
  for (const file of ['CLAUDE.md', '.github/copilot-instructions.md',
    '.claude/guardrails/untrusted-data.md', '.github/instructions/untrusted-data.instructions.md',
    '.claude/agents/commerce-upgrade-analyst.md', '.github/agents/commerce-upgrade-analyst.agent.md']) {
    assert.match(read(file), /read_source\.py/);
    assert.match(read(file), /secret-free snapshot/);
  }
});
