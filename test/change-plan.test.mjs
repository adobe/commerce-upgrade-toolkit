// Copyright 2026 Adobe. All rights reserved.
// Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync,
  existsSync, unlinkSync, readdirSync, linkSync, openSync, closeSync, readSync, constants } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const helper = join(root, '.claude/scripts/review_change_plan.py');
const sha = (value) => createHash('sha256').update(value).digest('hex');
const python = spawnSync('python3', ['-c', 'import sys; print(sys.executable)'],
  { encoding: 'utf8' }).stdout.trim();
const php = spawnSync('php', ['-n', '-d', 'extension=tokenizer', '-r',
  'exit(extension_loaded("tokenizer") ? 0 : 1);']).status === 0;
const target = 'app/code/Example/Module/Model/Fix.xml';
const put = (dir, path, content) => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
};
const json = (dir, path, value) => put(dir, path, JSON.stringify(value));

function fixture(run) {
  const dir = mkdtempSync(join(root, '.change-plan-test-'));
  try {
    put(dir, 'vendor/magento/reference.xml', '<reference/>\n');
    const ledger = {
      schemaVersion: 1, fromVersion: '2.4.7', toVersion: '2.4.8',
      normalized: null, normalizedSha256: null,
      sources: [{ id: 'BC-reviewed', reference: 'vendor/magento/reference.xml',
        sha256: sha('<reference/>\n') }],
    };
    json(dir, '.ccua/review/sources.json', ledger);
    const plan = {
      schemaVersion: 1, agent: 'commerce-developer', kind: 'patch', environment: 'local-test',
      fromVersion: '2.4.7', toVersion: '2.4.8', hop: 1, chunk: 3,
      evidence: '.ccua/review/sources.json',
      evidenceSha256: sha(JSON.stringify(ledger)), changes: [],
    };
    change(dir, plan);
    run(dir, plan);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function change(dir, plan, path = target, before = '<old/>\n', after = '<new/>\n') {
  if (before !== null) put(dir, path, before);
  const diff = spawnSync(python, ['-B', '-c', `
import json, difflib, sys
v=json.load(sys.stdin)
print("".join(difflib.unified_diff((v["before"] or "").splitlines(keepends=True),
    (v["after"] or "").splitlines(keepends=True), fromfile="a/"+v["path"],
    tofile="b/"+v["path"])), end="")
`], { input: JSON.stringify({ path, before, after }), encoding: 'utf8' });
  assert.equal(diff.status, 0, diff.stderr);
  const entry = {
    path, issue: { kind: 'source', id: 'BC-reviewed' },
    before: before === null ? null : '.ccua/review/fix.before',
    after: after === null ? null : '.ccua/review/fix.after',
    beforeSha256: before === null ? null : sha(before),
    afterSha256: after === null ? null : sha(after),
    diffSha256: sha(diff.stdout), sensitive: false,
  };
  if (before !== null) put(dir, entry.before, before);
  if (after !== null) put(dir, entry.after, after);
  plan.changes = [entry];
}

function run(dir, plan, action = 'review', extra = [], options = {}) {
  const content = JSON.stringify(plan);
  put(dir, '.ccua/review/plan.json', content);
  const args = [helper, action, '.ccua/review/plan.json', '--project-root', dir];
  if (action !== 'review') args.push('--expected-plan-sha256', sha(content));
  const result = spawnSync(python, ['-B', ...args, ...extra], {
    encoding: 'utf8', timeout: 20000, ...options,
  });
  return { ...result, data: result.stdout ? JSON.parse(result.stdout) : null };
}

function applied(dir, plan) {
  const item = plan.changes[0];
  if (item.after === null) unlinkSync(join(dir, item.path));
  else put(dir, item.path, readFileSync(join(dir, item.after)));
  json(dir, '.ccua/review/changed.json', [item.path]);
}

test('ordinary scoped review emits exact escaped diff and cannot apply it or grant consent', () =>
  fixture((dir, plan) => {
    const result = run(dir, plan);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.data.consent, 'not-recorded');
    assert.deepEqual(result.data.group, {
      agent: plan.agent, kind: plan.kind, environment: plan.environment,
      fromVersion: plan.fromVersion, toVersion: plan.toVersion, hop: 1, chunk: 3,
    });
    assert.equal(result.data.changes[0].restricted, false);
    assert.match(result.data.changes[0].exactDiff, /-<old\/>\n\+<new\/>/);
    assert.doesNotMatch(result.stdout, /<old|<new/);
    assert.equal(readFileSync(join(dir, target), 'utf8'), '<old/>\n');
    assert.equal(existsSync(join(dir, '.ccua/audit-log.jsonl')), false);
  }));

test('QA, DevOps, documentation and orchestrator legitimate scopes remain usable', () =>
  fixture((dir, plan) => {
    for (const [agent, path] of [
      ['commerce-qa-engineer', 'app/code/Example/Module/Test/Unit/Fix.xml'],
      ['commerce-qa-engineer', 'dev/tests/integration/testsuite/Example/Fix.xml'],
      ['commerce-devops-engineer', '.magento/services.yaml'],
      ['commerce-devops-engineer', '.github/workflows/deploy.yml'],
      ['commerce-documentation-engineer', '.claude/reports/hop.html'],
      ['commerce-documentation-engineer', '.github/context/report.md'],
      ['commerce-documentation-engineer', 'output/html/report/index.html'],
      ['orchestrator', '.claude/context/upgrade-state.md'],
    ]) {
      plan.agent = agent;
      change(dir, plan, path);
      const result = run(dir, plan);
      assert.equal(result.status, 0, `${agent}:${path}: ${result.stderr}`);
      if (agent === 'commerce-devops-engineer') {
        assert.equal(result.data.changes[0].restricted, true);
        assert.equal(result.data.changes[0].requiredLiveReview, 'developer-and-security-before-write');
      }
    }
  }));

test('conventional Vendor namespaces pass scoped remediation while root vendor stays denied', () =>
  fixture((dir, plan) => {
    for (const [agent, path] of [
      ['commerce-developer', 'app/code/Vendor/Module/Model/Fix.xml'],
      ['commerce-developer', 'app/code/Acme/Vendor/Model/Fix.xml'],
      ['commerce-qa-engineer', 'app/code/Vendor/Module/Test/Unit/Fix.xml'],
    ]) {
      plan.agent = agent;
      change(dir, plan, path);
      assert.equal(run(dir, plan).status, 0);
      applied(dir, plan);
      const args = ['--changed', '.ccua/review/changed.json'];
      assert.equal(run(dir, plan, 'verify', args).status, 0);
      assert.equal(run(dir, plan, 'audit', args).status, 0);
    }
    plan.agent = 'commerce-developer';
    for (const path of ['vendor/magento/file.xml', 'VENDOR/magento/file.xml']) {
      plan.changes[0].path = path;
      assert.equal(run(dir, plan).status, 1);
    }
  }));

test('required Markdown reports pass document review/verify/audit without granting script writes', () =>
  fixture((dir, plan) => {
    const content = '# Reviewed proposal\n\n```bash\nprintf "review-only"\n```\n';
    for (const agent of ['commerce-documentation-engineer', 'orchestrator', 'commerce-upgrade-analyst']) {
      for (const flavor of ['.claude', '.github']) {
        for (const name of ['hop-1-2.4.7-2.4.8-frontend-review.md',
          'upgrade-2.4.7-2.4.8-extension-compatibility.md',
          'upgrade-2.4.7-2.4.8-data-migration-plan.md']) {
          plan.agent = agent;
          change(dir, plan, `${flavor}/reports/${name}`, '# Before\n', content);
          assert.equal(run(dir, plan).status, 0);
          applied(dir, plan);
          const args = ['--changed', '.ccua/review/changed.json'];
          assert.equal(run(dir, plan, 'verify', args).status, 0);
          assert.equal(run(dir, plan, 'audit', args).status, 0);
          assert.equal(readFileSync(join(dir, plan.changes[0].path), 'utf8'), content);
        }
        plan.changes[0].path = `${flavor}/reports/upgrade-2.4.7-2.4.8-data-migration.sh`;
        assert.equal(run(dir, plan).status, 1);
        assert.equal(existsSync(join(dir, plan.changes[0].path)), false);
        plan.agent = 'commerce-upgrade-researcher';
        plan.changes[0].path = `${flavor}/reports/upgrade-2.4.7-2.4.8-extension-action-plan.md`;
        assert.equal(run(dir, plan).status, 1);
      }
    }
  }));

test('role separation denies application bypass, tests by developer and all research writes', () =>
  fixture((dir, plan) => {
    for (const [agent, path] of [
      ['commerce-developer', 'app/code/Example/Module/Test/Unit/Fix.xml'],
      ['commerce-qa-engineer', target], ['commerce-devops-engineer', target],
      ['commerce-documentation-engineer', target], ['orchestrator', target],
      ['commerce-documentation-engineer', '.claude/context/malicious.php'],
      ['commerce-documentation-engineer', '.magento.env.yaml'],
      ['commerce-developer', 'composer.json'], ['commerce-developer', 'app/etc/config.php'],
      ['commerce-upgrade-analyst', target], ['commerce-upgrade-researcher', target], ['commerce-architect', target],
      ['commerce-frontend-developer', target], ['commerce-security-reviewer', target],
      ['unknown-role', target], ['commerce-developer', 'app/code/Example/Module/view/web/fix.js'],
    ]) {
      plan.agent = agent;
      plan.changes[0].path = path;
      assert.equal(run(dir, plan).status, 1, `${agent}:${path}`);
    }
  }));

test('never-write secrets/vendor are rejected before target or fixture reads', () =>
  fixture((dir, plan) => {
    // Missing fixtures would fail if read; preflight scope can be checked independently.
    const probe = spawnSync(python, ['-B', '-c', `
import sys
sys.path.insert(0, ${JSON.stringify(join(root, '.claude/scripts'))})
import review_change_plan as m
from pathlib import Path
policy=m.load(m.HERE/"write-policy.json")
for name in ["app/etc/env.php", "AUTH.json", ".env.production", "private.key",
             "vendor/magento/file.php", "app/code/A/B/auth.json",
             "app/code/A/B/credentials.json", "app/code/A/B/private.pem"]:
    m.contained=lambda *a, **k: (_ for _ in ()).throw(AssertionError("filesystem touched"))
    try: m.scope(Path("."), policy, "commerce-developer", "patch", name)
    except ValueError: pass
    else: raise AssertionError(name)
for name in [".ccua/review/auth.json", ".ccua/review/.env.json"]:
    try: m.artifact(Path("."), name, policy)
    except ValueError: pass
    else: raise AssertionError(name)
`], { encoding: 'utf8' });
    assert.equal(probe.status, 0, probe.stderr);
    for (const path of ['app/etc/env.php', 'auth.json', '.env.local', 'private.key', 'vendor/x.php']) {
      plan.changes[0].path = path;
      assert.equal(run(dir, plan).status, 1);
    }
    const log = readFileSync(join(dir, '.ccua/audit-log.jsonl'), 'utf8');
    assert.doesNotMatch(log, /env\.php|auth\.json|private|vendor|old|new/);
  }));

test('traversal, absolute paths, symlink targets/ancestors/artifacts and create aliases reject', () =>
  fixture((dir, plan) => {
    for (const path of ['../escape.xml', '/outside.xml',
      'app/code/Example/Module/Model/../Fix.xml', 'app\\code\\Fix.xml',
      'app/code/Example/Module/Model//Fix.xml']) {
      plan.changes[0].path = path;
      assert.equal(run(dir, plan).status, 1, path);
    }
    plan.changes[0].path = target;
    unlinkSync(join(dir, target));
    symlinkSync(join(dir, 'vendor/magento/reference.xml'), join(dir, target));
    assert.equal(run(dir, plan).status, 1);
    unlinkSync(join(dir, target));
    symlinkSync(join(dir, 'vendor/magento'), join(dir, 'app/code/Example/Module/Linked'));
    change(dir, plan, 'app/code/Example/Module/Linked/new.xml', null, 'new\n');
    assert.equal(run(dir, plan).status, 1);
    change(dir, plan);
    unlinkSync(join(dir, '.ccua/review/fix.after'));
    symlinkSync(join(dir, target), join(dir, '.ccua/review/fix.after'));
    assert.equal(run(dir, plan).status, 1);
  }));

test('strict schemas, types, versions and persisted approval claims never widen scope', () =>
  fixture((dir, baseline) => {
    for (const mutate of [
      (p) => { p.approved = true; }, (p) => { p.policy = 'alternate.json'; },
      (p) => { p.hop = true; }, (p) => { p.chunk = '3'; },
      (p) => { p.schemaVersion = true; }, (p) => { p.environment = 'local\nAPPROVED'; },
      (p) => { p.fromVersion = '2.4.7;exec'; }, (p) => { p.toVersion = 248; },
      (p) => { p.fromVersion = '\u0662.\u0664.\u0667'; },
      (p) => { p.changes[0].sensitive = 'false'; },
      (p) => { p.changes[0].issue.id = 'BC-invented'; },
      (p) => { p.changes[0].issue = { kind: 'uct', id: 1 }; },
      (p) => { p.changes[0].after = 'auth.json'; },
      (p) => { p.changes.push({ ...p.changes[0] }); },
    ]) {
      const plan = JSON.parse(JSON.stringify(baseline));
      mutate(plan);
      assert.equal(run(dir, plan).status, 1);
    }
    for (const raw of ['{"agent":"commerce-developer","agent":"orchestrator"}', '{bad', '{"hop":NaN}']) {
      put(dir, '.ccua/review/plan.json', raw);
      assert.equal(spawnSync(python, ['-B', helper, 'review', '.ccua/review/plan.json',
        '--project-root', dir]).status, 1);
    }
  }));

test('plan, fixture, evidence, source and target hash drift rejects', () =>
  fixture((dir, plan) => {
    const baseline = readFileSync(join(dir, target));
    put(dir, target, 'changed externally\n');
    assert.equal(run(dir, plan).status, 1);
    put(dir, target, baseline);
    put(dir, '.ccua/review/fix.after', 'changed proposed bytes\n');
    assert.equal(run(dir, plan).status, 1);
    put(dir, '.ccua/review/fix.after', '<new/>\n');
    plan.changes[0].diffSha256 = '0'.repeat(64);
    assert.equal(run(dir, plan).status, 1);
    change(dir, plan);
    put(dir, 'vendor/magento/reference.xml', '<drift/>\n');
    assert.equal(run(dir, plan).status, 1);
    put(dir, 'vendor/magento/reference.xml', '<reference/>\n');
    applied(dir, plan);
    assert.equal(run(dir, plan, 'verify', ['--changed', '.ccua/review/changed.json',
      '--expected-plan-sha256', '0'.repeat(64)]).status, 1);
    assert.equal(run(dir, plan, 'verify', ['--changed', '.ccua/review/changed.json']).status, 0);
    put(dir, '.ccua/review/sources.json', '{}');
    assert.equal(run(dir, plan, 'verify', ['--changed', '.ccua/review/changed.json']).status, 1);
  }));

test('verify exact changed-file inventory includes create/delete and rejects extra/missing files', () =>
  fixture((dir, plan) => {
    for (const [before, after] of [[null, 'created\n'], ['deleted\n', null]]) {
      change(dir, plan, 'app/code/Example/Module/Model/New.xml', before, after);
      assert.equal(run(dir, plan).status, 0);
      applied(dir, plan);
      assert.equal(run(dir, plan, 'verify', ['--changed', '.ccua/review/changed.json']).status, 0);
    }
    change(dir, plan);
    applied(dir, plan);
    for (const inventory of [[], [target, target], [target, 'app/etc/env.php'],
      [target, 'app/code/Example/Module/Model/Extra.xml']]) {
      json(dir, '.ccua/review/changed.json', inventory);
      assert.equal(run(dir, plan, 'verify', ['--changed', '.ccua/review/changed.json']).status, 1);
    }
    assert.equal(run(dir, plan, 'verify').status, 1);
  }));

test('restricted classification flags configuration/path floor plus human arbitrary-module assessment', () =>
  fixture((dir, plan) => {
    change(dir, plan, 'app/code/Example/Neutral/etc/di.xml');
    let result = run(dir, plan);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.data.changes[0].restricted, true);
    change(dir, plan, 'app/code/Example/Payment/Model/Fix.xml');
    assert.equal(run(dir, plan).data.changes[0].restricted, true);
    change(dir, plan);
    plan.changes[0].sensitive = true;
    assert.equal(run(dir, plan).data.changes[0].restricted, true);
    assert.equal(readFileSync(join(dir, target), 'utf8'), '<old/>\n');
  }));

test('platform effects cannot become direct developer or orchestrator patch permission', () =>
  fixture((dir, plan) => {
    change(dir, plan, 'composer.json', '{}\n', '{"new":1}\n');
    for (const agent of ['commerce-developer', 'orchestrator']) {
      plan.agent = agent;
      plan.kind = 'patch';
      assert.equal(run(dir, plan).status, 1);
    }
    plan.kind = 'command-effects';
    assert.equal(run(dir, plan).status, 0);
    plan.changes[0].path = 'composerXjson';
    assert.equal(run(dir, plan).status, 1);
    plan.changes[0].path = 'composer.json';
    plan.agent = 'commerce-developer';
    assert.equal(run(dir, plan).status, 1);
    plan.agent = 'orchestrator';
    plan.changes[0].path = target;
    assert.equal(run(dir, plan).status, 1);
  }));

test('hash-only attributed audit cannot record approval or source and audit failures block', () =>
  fixture((dir, plan) => {
    applied(dir, plan);
    const result = run(dir, plan, 'audit', ['--changed', '.ccua/review/changed.json']);
    assert.equal(result.status, 0, result.stderr);
    const raw = readFileSync(join(dir, '.ccua/audit-log.jsonl'), 'utf8');
    const entry = JSON.parse(raw.trim());
    assert.equal(entry.claimedAgent, 'commerce-developer');
    assert.equal(entry.hop, 1);
    assert.equal(entry.files[0].issue.id, 'BC-reviewed');
    assert.equal(entry.files[0].afterSha256, sha('<new/>\n'));
    assert.doesNotMatch(raw + result.stdout, /exactDiff|<new|<old|approved|consent.*true/);
    unlinkSync(join(dir, '.ccua/audit-log.jsonl'));
    symlinkSync(join(dir, target), join(dir, '.ccua/audit-log.jsonl'));
    assert.equal(run(dir, plan, 'audit', ['--changed', '.ccua/review/changed.json']).status, 1);
    assert.equal(readFileSync(join(dir, target), 'utf8'), '<new/>\n');
    assert.equal(readdirSync(join(dir, '.ccua')).includes('audit-log.jsonl'), true);
  }));

test('both audit helpers refuse external hardlinks on normal and rejected-input paths', () => {
  for (const prefix of ['.claude', '.github']) {
    for (const rejected of [false, true]) fixture((dir, plan) => {
      change(dir, plan);
      applied(dir, plan);
      if (rejected) plan.agent = 'commerce-upgrade-analyst';
      const content = JSON.stringify(plan);
      put(dir, '.ccua/review/plan.json', content);
      const outside = join(dir, 'outside-audit.txt');
      writeFileSync(outside, 'non-secret outside fixture\n');
      linkSync(outside, join(dir, '.ccua/audit-log.jsonl'));
      const result = spawnSync(python, ['-B', join(root, prefix, 'scripts/review_change_plan.py'),
        'audit', '.ccua/review/plan.json', '--project-root', dir,
        '--expected-plan-sha256', sha(content), '--changed', '.ccua/review/changed.json'],
        { encoding: 'utf8', timeout: 10000 });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Audit failure; completion blocked/);
      assert.equal(readFileSync(outside, 'utf8'), 'non-secret outside fixture\n');
      assert.equal(readFileSync(join(dir, '.ccua/audit-log.jsonl'), 'utf8'), 'non-secret outside fixture\n');
    });
  }
});

test('audit FIFO refusal is nonblocking with and without an active reader',
  { skip: process.platform === 'win32' }, () => {
    for (const prefix of ['.claude', '.github']) {
      for (const reader of [false, true]) fixture((dir, plan) => {
        applied(dir, plan);
        const content = JSON.stringify(plan);
        put(dir, '.ccua/review/plan.json', content);
        const path = join(dir, '.ccua/audit-log.jsonl');
        const created = spawnSync(python, ['-c', 'import os,sys; os.mkfifo(sys.argv[1])', path],
          { encoding: 'utf8', timeout: 10000 });
        assert.equal(created.status, 0, created.stderr);
        const descriptor = reader ? openSync(path, constants.O_RDONLY | constants.O_NONBLOCK) : null;
        try {
          const result = spawnSync(python, ['-B', join(root, prefix, 'scripts/review_change_plan.py'),
            'audit', '.ccua/review/plan.json', '--project-root', dir,
            '--expected-plan-sha256', sha(content), '--changed', '.ccua/review/changed.json'],
            { encoding: 'utf8', timeout: 10000 });
          assert.equal(result.status, 1);
          assert.equal(result.error, undefined);
          assert.match(result.stderr, /Audit failure; completion blocked/);
          if (descriptor !== null) assert.equal(readSync(descriptor, Buffer.alloc(1024), 0, 1024, null), 0);
        } finally {
          if (descriptor !== null) closeSync(descriptor);
        }
      });
    }
  });

test('normalized accepted IDs are tied, quarantine/type/diagnostic drift and forged IDs block', () =>
  fixture((dir, plan) => {
    const normalized = {
      normalizerVersion: 1, targetVersion: '2.4.8', blocked: false, quarantine: [],
      rawSha256: sha('raw audit fixture'),
      accepted: [{ id: 1, file: target, line: 1, code: 'W-083', type: 'DEPRECATED_CLASS',
        symbol: 'Magento\\Catalog\\Model\\Product', severity: 'warning' }],
      counts: { accepted: 1, quarantined: 0, total: 1 },
    };
    const ledger = JSON.parse(readFileSync(join(dir, '.ccua/review/sources.json')));
    function update() {
      json(dir, '.ccua/review/normalized.json', normalized);
      ledger.normalized = '.ccua/review/normalized.json';
      ledger.normalizedSha256 = sha(JSON.stringify(normalized));
      json(dir, '.ccua/review/sources.json', ledger);
      plan.evidenceSha256 = sha(JSON.stringify(ledger));
    }
    plan.changes[0].issue = { kind: 'uct', id: 1 };
    update();
    assert.equal(run(dir, plan).status, 0);
    normalized.blocked = true;
    normalized.quarantine = [{ id: 2 }];
    update();
    assert.equal(run(dir, plan).status, 1);
    normalized.blocked = false;
    normalized.quarantine = [];
    normalized.accepted[0].symbol = 'Fake;exec()';
    update();
    assert.equal(run(dir, plan).status, 1);
    normalized.accepted[0].symbol = 'Magento\\Catalog\\Model\\Product';
    normalized.normalizerVersion = true;
    update();
    assert.equal(run(dir, plan).status, 1);
    normalized.normalizerVersion = 1;
    normalized.counts.accepted = true;
    update();
    assert.equal(run(dir, plan).status, 1);
  }));

function inspect(before, after, options = {}) {
  return spawnSync('php', ['-n', '-d', 'extension=tokenizer',
    join(root, '.claude/scripts/inspect_changed_php.php')], {
    input: JSON.stringify({ before, after }), encoding: 'utf8', ...options,
  });
}

test('PHP token inspection ignores comment/string words and preserves unchanged risky baseline',
  { skip: !php }, () => {
    const before = '<?php exec("old");\n';
    const after = before + '// EVAL("not code"); system("not code");\n' +
      '/* unserialize($x); */ $text = \'shell_exec("not code")\';\n';
    const result = inspect(before, after);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { introduced: [], baselineCount: 1 });
    assert.equal(JSON.parse(inspect(before, '<?php exec("changed");').stdout).introduced.length, 1);
  });

test('PHP tokenizer catches introduced multiline/mixed case/qualified/indirect dangerous behavior',
  { skip: !php }, () => {
    for (const snippet of ['EvAl\n($x);', '\\ExEc /*space*/\n("x");',
      'shell_EXEC($x);', 'system($x);', 'unserialize($x);',
      'file_get_contents("https://example.invalid");', 'file_get_contents($url);',
      'file_get_contents("safe" . $url);', '$callable($x);', '`command`;',
      'namespace\\exec("x");', 'new \\ReflectionFunction("exec");']) {
      const result = inspect('<?php\n', '<?php\n' + snippet);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(JSON.parse(result.stdout).introduced.length > 0, snippet);
      assert.doesNotMatch(result.stdout, /example\.invalid|command|https:/);
    }
    const local = inspect('<?php\n', '<?php file_get_contents("local.txt");');
    assert.deepEqual(JSON.parse(local.stdout).introduced, []);
  });

test('both PHP inspectors flag loading tokens without executing them and preserve baseline accounting',
  { skip: !php }, () => {
    for (const prefix of ['.claude', '.github']) {
      const check = (before, after) => spawnSync('php', ['-n', '-d', 'extension=tokenizer',
        join(root, prefix, 'scripts/inspect_changed_php.php')], {
        input: JSON.stringify({ before, after }), encoding: 'utf8',
      });
      for (const snippet of ['include "missing.php";', 'include_once($path);',
        'require $path;', 'ReQuIrE_OnCe /* comment */\n(__DIR__ . "/bootstrap.php");',
        'return require($path);']) {
        const result = check('<?php\n', '<?php\n' + snippet);
        assert.equal(result.status, 0, result.stderr);
        const risks = JSON.parse(result.stdout).introduced;
        assert.equal(risks.filter(risk => risk.kind === 'include-or-require-review').length, 1);
        assert.doesNotMatch(result.stdout, /missing\.php|bootstrap\.php/);
      }
      const before = '<?php require "bootstrap.php";\n';
      const unchanged = check(before, before + '// include($path);\n$text = \'require_once "missing.php";\';\n');
      assert.equal(unchanged.status, 0, unchanged.stderr);
      assert.deepEqual(JSON.parse(unchanged.stdout), { introduced: [], baselineCount: 1 });
      const duplicated = check(before, before + 'require "bootstrap.php";\n');
      assert.equal(duplicated.status, 0, duplicated.stderr);
      assert.equal(JSON.parse(duplicated.stdout).introduced.length, 1);
      const changed = check(before, '<?php require "changed.php";\n');
      assert.equal(changed.status, 0, changed.stderr);
      assert.equal(JSON.parse(changed.stdout).introduced[0].kind, 'include-or-require-review');
      const ordinary = check('<?php\n', '<?php $service->require("data"); // include($path);\n');
      assert.equal(ordinary.status, 0, ordinary.stderr);
      assert.deepEqual(JSON.parse(ordinary.stdout).introduced, []);
    }
  });

test('new PHP loading constructs block review and verification before submitted source executes',
  { skip: !php }, () => fixture((dir, plan) => {
    put(dir, '.ccua/review/sniffs.txt', ' Magento2.Security.SyntheticFixture\n');
    for (const keyword of ['include', 'include_once', 'require', 'require_once']) {
      const path = 'app/code/Example/Module/Model/Fix.php';
      change(dir, plan, path, '<?php return 1;\n', `<?php ${keyword} "not-executed.php";\n`);
      const preview = run(dir, plan);
      assert.equal(preview.status, 2);
      assert.equal(preview.data.changes[0].requiredLiveReview, 'developer-and-security-before-write');
      assert.equal(preview.data.changes[0].phpInspection.introduced[0].kind, 'include-or-require-review');
      assert.equal(readFileSync(join(dir, path), 'utf8'), '<?php return 1;\n');
      applied(dir, plan);
      const verified = run(dir, plan, 'verify', ['--changed', '.ccua/review/changed.json',
        '--sniffs', '.ccua/review/sniffs.txt']);
      assert.equal(verified.status, 2);
      assert.equal(verified.data.changes[0].requiredLiveReview, 'developer-and-security-before-write');
    }
  }));

test('both PHP inspectors flag absolute/traversing reads and preserve ordinary relative literals',
  { skip: !php }, () => {
    for (const helper of ['.claude', '.github']) {
      const check = (value) => spawnSync('php', ['-n', '-d', 'extension=tokenizer',
        join(root, helper, 'scripts/inspect_changed_php.php')], {
        input: JSON.stringify({ before: '<?php\n',
          after: `<?php file_get_contents(${JSON.stringify(value)});` }), encoding: 'utf8',
      });
      for (const value of ['/etc/passwd', '../app/etc/env.php', 'assets/../../auth.json',
        '..', 'assets/..', '//host/file', 'C:/private/file', '..\\app\\etc\\env.php']) {
        const result = check(value);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(JSON.parse(result.stdout).introduced[0].kind, 'file_get_contents-external-or-uncertain');
        assert.doesNotMatch(result.stdout, /passwd|auth\.json|env\.php/);
      }
      for (const value of ['local.txt', 'assets/data.json', './assets/local.txt',
        'assets/..notes.txt', 'version..txt']) {
        const result = check(value);
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout).introduced, []);
      }
    }
  });

test('changed PHP blocks before execution on risky additions, missing tokenizer or Security family',
  { skip: !php }, () => fixture((dir, plan) => {
    const path = 'app/code/Example/Module/Model/Fix.php';
    change(dir, plan, path, '<?php return 1;\n', '<?php return 2;\n');
    assert.equal(run(dir, plan).status, 0);
    applied(dir, plan);
    assert.equal(run(dir, plan, 'verify', ['--changed', '.ccua/review/changed.json']).status, 2);
    put(dir, '.ccua/review/sniffs.txt', ' Magento2.PHP.Synthetic\n');
    assert.equal(run(dir, plan, 'verify', ['--changed', '.ccua/review/changed.json',
      '--sniffs', '.ccua/review/sniffs.txt']).status, 2);
    // Synthetic listing tests discovery logic only; not a claimed installed sniff or PHPCS run.
    put(dir, '.ccua/review/sniffs.txt', ' Magento2.Security.SyntheticFixture\n');
    assert.equal(run(dir, plan, 'verify', ['--changed', '.ccua/review/changed.json',
      '--sniffs', '.ccua/review/sniffs.txt']).status, 0);
    assert.equal(run(dir, plan, 'verify', ['--changed', '.ccua/review/changed.json',
      '--sniffs', '.ccua/review/sniffs.txt'], { env: { ...process.env, PATH: '' } }).status, 1);
    change(dir, plan, path, '<?php return 1;\n', '<?php system("never executed");\n');
    const risk = run(dir, plan);
    assert.equal(risk.status, 2);
    assert.equal(risk.data.changes[0].requiredLiveReview, 'developer-and-security-before-write');
    assert.equal(readFileSync(join(dir, path), 'utf8'), '<?php return 1;\n');
    for (const path of ['/etc/passwd', '../app/etc/env.php']) {
      change(dir, plan, 'app/code/Example/Module/Model/Fix.php', '<?php return 1;\n',
        `<?php file_get_contents(${JSON.stringify(path)});\n`);
      const result = run(dir, plan);
      assert.equal(result.status, 2);
      assert.equal(result.data.changes[0].requiredLiveReview, 'developer-and-security-before-write');
    }
  }));

test('canonical/generated policy, scripts, all roles and workflow gates remain in parity', () => {
  const read = (path) => readFileSync(join(root, path), 'utf8');
  for (const file of ['write-policy.json', 'review_change_plan.py', 'inspect_changed_php.php']) {
    assert.equal(read(`.claude/scripts/${file}`), read(`.github/scripts/${file}`));
  }
  const roles = Object.keys(JSON.parse(read('.claude/scripts/write-policy.json')).roles)
    .filter((role) => role !== 'orchestrator');
  for (const role of roles) {
    assert.match(read(`.claude/agents/${role}.md`), /guardrails\/write-scope\.md/);
    assert.match(read(`.github/agents/${role}.agent.md`), /instructions\/write-scope\.instructions\.md/);
  }
  assert.match(read('.github/instructions/write-scope.instructions.md'), /applyTo: "\*\*"/);
  assert.match(read('CLAUDE.md'), /guardrails\/write-scope\.md/);
  assert.match(read('.claude/commands/upgrade-hop-execute.md'), /BEFORE WRITE/);
  assert.match(read('.claude/commands/upgrade-deploy-prep.md'), /Magento2\.Security/);
  for (const [canonical, generated] of [
    ['.claude/skills/marketplace-extension-analysis.md', '.github/skills/marketplace-extension-analysis/SKILL.md'],
    ['.claude/skills/data-migration-plan.md', '.github/skills/data-migration-plan/SKILL.md'],
  ]) {
    for (const path of [canonical, generated]) {
      const text = read(path);
      if (path.includes('marketplace')) {
        assert.match(text, /Step 6 — Return report proposals/);
        assert.match(text, /read-only researcher must not write/);
        assert.doesNotMatch(text, /Write two files|compatibility report written/);
      } else {
        assert.match(text, /Step 7 — Return a human-operated migration script proposal/);
        assert.match(text, /No agent writes,\s+chmods or executes a standalone migration script/);
        assert.doesNotMatch(text, /Write a fully executable|Execution script written|eval "\$/);
      }
    }
  }
  assert.match(read('docs/upgrade-workflow.md'), /human creates\/executes script/);
});
