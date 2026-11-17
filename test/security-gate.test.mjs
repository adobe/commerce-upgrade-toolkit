// Copyright 2026 Adobe. All rights reserved.
// Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const gateScript = join(root, '.claude/scripts/security_gate.py');
const sha = (value) => createHash('sha256').update(value).digest('hex');
const OK = 0, INVALID = 1, BLOCKED = 2, APPROVAL = 3;

// Controlled stand-in for Semgrep: emits canned Semgrep-shaped JSON, no network or real payloads.
const FAKE = `
import json, os, sys, time
mode = sys.argv[1]
log = sys.argv[2] if len(sys.argv) > 2 else None
seen = sorted(os.path.relpath(os.path.join(d, f), ".") for d, _, fs in os.walk(".") for f in fs if f != ".semgrepignore")
if log:
    open(log, "a").write("\\n".join(seen) + "\\n")
def out(results, skipped=()):
    print(json.dumps({"results": results, "errors": [],
                      "paths": {"scanned": seen, "skipped": [{"path": seen[0], "reason": r} for r in skipped]}}))
def finding(sev, name):
    return {"check_id": "x.ccua." + name, "path": seen[0], "start": {"line": 7},
            "extra": {"severity": "ERROR", "message": "simulated", "metadata": {"ccua_severity": sev,
            "remediation": "simulated remediation"}}}
if mode == "clean":
    out([])
elif mode == "skipped":
    out([], ["too_big"])
elif mode == "emptyscan":
    print(json.dumps({"results": [], "errors": [], "paths": {"scanned": [], "skipped": []}}))
elif mode == "nopaths":
    print(json.dumps({"results": [], "errors": []}))
elif mode in ("high", "critical", "medium"):
    out([finding(mode.upper(), "sim-" + mode)])
elif mode == "crash":
    sys.exit(3)
elif mode == "hang":
    time.sleep(30)
elif mode == "garbage":
    print("not json")
elif mode == "shape":
    print(json.dumps({"results": "nope"}))
elif mode == "errors":
    print(json.dumps({"results": [], "errors": [{"message": "parse failure"}]}))
`;

function scanner(dir, mode, log) {
  const script = join(dir, 'fake_scanner.py');
  writeFileSync(script, FAKE);
  return JSON.stringify(['python3', script, mode, ...(log ? [log] : [])]);
}

function put(dir, path, content) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}

function fixture(run) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'ccua-gate-test-'));
  try { run(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

// changes: [{ path, after (string|null), before (string|null), sensitive? }]
function makePlan(dir, { hop = 1, chunk = 3, name, changes, issue }) {
  const entries = changes.map((c, i) => {
    const entry = { path: c.path, before: null, after: null, beforeSha256: null, afterSha256: null,
      diffSha256: sha(`diff-${c.path}`), sensitive: Boolean(c.sensitive), ...(issue ? { issue } : {}) };
    if (c.before !== null && c.before !== undefined) {
      entry.before = `.ccua/review/h${hop}c${chunk}-${i}.before`;
      put(dir, entry.before, c.before);
      entry.beforeSha256 = sha(c.before);
    }
    if (c.after !== null && c.after !== undefined) {
      entry.after = `.ccua/review/h${hop}c${chunk}-${i}.after`;
      put(dir, entry.after, c.after);
      entry.afterSha256 = sha(c.after);
    }
    return entry;
  });
  const plan = { agent: 'commerce-developer', kind: 'patch', hop, chunk, changes: entries };
  const rel = `.ccua/review/${name ?? `plan-h${hop}c${chunk}`}.json`;
  const text = JSON.stringify(plan);
  put(dir, rel, text);
  return { rel, sha: sha(text) };
}

function gate(dir, action, args, mode, extra = []) {
  const scan = ['gate', 'approve', 'final', 'changed-scan'].includes(action)
    ? ['--scanner-cmd', scanner(dir, mode ?? 'clean')] : [];
  return spawnSync('python3', ['-B', gateScript, action, ...args, '--project-root', dir, ...scan, ...extra],
    { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
}

function approveWithTty(dir, plan, answer) {
  const driver = `
import os, pty, sys
pid, fd = pty.fork()
if pid == 0:
    os.execv(sys.executable, [sys.executable, "-B"] + sys.argv[1:])
os.write(fd, (sys.stdin.readline()).encode())
out = b""
while True:
    try:
        chunk = os.read(fd, 4096)
    except OSError:
        break
    if not chunk:
        break
    out += chunk
_, status = os.waitpid(pid, 0)
sys.stdout.write(out.decode("utf-8", "replace"))
sys.exit(os.waitstatus_to_exitcode(status))
`;
  return spawnSync('python3', ['-c', driver, gateScript, 'approve', plan.rel, '--expected-plan-sha256', plan.sha,
    '--project-root', dir, '--scanner-cmd', scanner(dir, 'clean')],
  { input: answer + '\n', encoding: 'utf8' });
}

const PLAIN = 'app/code/Acme/Widget/Model/Helper.php';
const SENSITIVE = 'app/code/Acme/Widget/etc/acl.xml';
const php = '<?php\nclass Helper {}\n';

test('clean generated code passes the gate and verifies', () => fixture((dir) => {
  const plan = makePlan(dir, { changes: [{ path: PLAIN, before: null, after: php }] });
  const result = gate(dir, 'gate', [plan.rel], 'clean');
  assert.equal(result.status, OK, result.stdout + result.stderr);
  assert.match(result.stdout, /ACCEPTED/);
  assert.equal(gate(dir, 'verify', [plan.rel]).status, OK);
  assert.equal(existsSync(join(dir, PLAIN)), false, 'gate must not write into the project tree');
}));

for (const severity of ['high', 'critical']) {
  test(`simulated ${severity} finding blocks acceptance with a useful report`, () => fixture((dir) => {
    const plan = makePlan(dir, { changes: [{ path: PLAIN, before: null, after: php }] });
    const result = gate(dir, 'gate', [plan.rel], severity);
    assert.equal(result.status, BLOCKED);
    assert.match(result.stdout, new RegExp(severity.toUpperCase()));
    assert.match(result.stdout, new RegExp(`${PLAIN}:7`));
    assert.match(result.stdout, new RegExp(`sim-${severity}`));
    assert.match(result.stdout, /simulated remediation/);
    assert.notEqual(gate(dir, 'verify', [plan.rel]).status, OK);
  }));
}

test('medium findings are reported but do not block at the default threshold', () => fixture((dir) => {
  const plan = makePlan(dir, { changes: [{ path: PLAIN, before: null, after: php }] });
  const result = gate(dir, 'gate', [plan.rel], 'medium');
  assert.equal(result.status, OK);
  assert.match(result.stdout, /MEDIUM/);
}));

for (const mode of ['crash', 'garbage', 'shape', 'errors']) {
  test(`scanner failure mode "${mode}" fails closed`, () => fixture((dir) => {
    const plan = makePlan(dir, { changes: [{ path: PLAIN, before: null, after: php }] });
    const result = gate(dir, 'gate', [plan.rel], mode);
    assert.equal(result.status, BLOCKED);
    assert.match(result.stdout, /BLOCKER: scanner-/);
    assert.notEqual(gate(dir, 'verify', [plan.rel]).status, OK);
  }));
}

test('missing scanner binary and scanner timeout block', () => fixture((dir) => {
  const plan = makePlan(dir, { changes: [{ path: PLAIN, before: null, after: php }] });
  const missing = spawnSync('python3', ['-B', gateScript, 'gate', plan.rel, '--project-root', dir,
    '--scanner-cmd', JSON.stringify(['/nonexistent/scanner'])], { encoding: 'utf8' });
  assert.equal(missing.status, BLOCKED);
  assert.match(missing.stdout, /scanner-unavailable/);
  const slow = gate(dir, 'gate', [plan.rel], 'hang', ['--timeout-seconds', '1']);
  assert.equal(slow.status, BLOCKED);
  assert.match(slow.stdout, /scanner-timeout/);
}));

test('a failed chunk stops the next chunk and rejected changes are never promoted', () => fixture((dir) => {
  const first = makePlan(dir, { chunk: 2, changes: [{ path: PLAIN, before: null, after: php }] });
  assert.equal(gate(dir, 'gate', [first.rel], 'high').status, BLOCKED);
  const second = makePlan(dir, { chunk: 3, changes: [{ path: 'app/code/Acme/Widget/Model/Other.php', before: null, after: php }] });
  const result = gate(dir, 'gate', [second.rel], 'clean');
  assert.equal(result.status, BLOCKED);
  assert.match(result.stdout, /previous-chunk-2-not-accepted/);
  assert.notEqual(gate(dir, 'verify', [second.rel, '--applied']).status, OK);
}));

test('an unrelated accepted plan in the same chunk does not hide a blocked finding', () => fixture((dir) => {
  const bad = makePlan(dir, { chunk: 2, changes: [{ path: PLAIN, before: null, after: php }] });
  const other = makePlan(dir, { chunk: 2, name: 'plan-other', changes: [{ path: 'app/code/Acme/Widget/Model/Other.php', before: null, after: php }] });
  assert.equal(gate(dir, 'gate', [bad.rel], 'high').status, BLOCKED);
  assert.equal(gate(dir, 'gate', [other.rel], 'clean').status, OK);
  const next = makePlan(dir, { chunk: 3, changes: [{ path: 'app/code/Acme/Widget/Model/Third.php', before: null, after: php }] });
  const result = gate(dir, 'gate', [next.rel], 'clean');
  assert.equal(result.status, BLOCKED);
  assert.match(result.stdout, /previous-chunk-2-not-accepted/);
}));

test('a corrected retry of the same finding supersedes its rejected record', () => fixture((dir) => {
  const bad = makePlan(dir, { chunk: 2, changes: [{ path: PLAIN, before: null, after: php }] });
  assert.equal(gate(dir, 'gate', [bad.rel], 'high').status, BLOCKED);
  const fixed = makePlan(dir, { chunk: 2, name: 'plan-fixed', changes: [{ path: PLAIN, before: null, after: php + '// fixed\n' }] });
  assert.equal(gate(dir, 'gate', [fixed.rel], 'clean').status, OK);
  const next = makePlan(dir, { chunk: 3, changes: [{ path: 'app/code/Acme/Widget/Model/Third.php', before: null, after: php }] });
  assert.equal(gate(dir, 'gate', [next.rel], 'clean').status, OK);
}));

test('a corrected plan for the same reviewed issue clears the blocker even with different files', () => fixture((dir) => {
  const issue = { kind: 'uct', id: 7 };
  const bad = makePlan(dir, { chunk: 2, issue, changes: [{ path: PLAIN, before: null, after: php }] });
  assert.equal(gate(dir, 'gate', [bad.rel], 'high').status, BLOCKED);
  const fixed = makePlan(dir, { chunk: 2, issue, name: 'plan-fixed-files', changes: [{ path: 'app/code/Acme/Widget/Model/Fixed.php', before: null, after: php }] });
  assert.equal(gate(dir, 'gate', [fixed.rel], 'clean').status, OK);
  const next = makePlan(dir, { chunk: 3, changes: [{ path: 'app/code/Acme/Widget/Model/Third.php', before: null, after: php }] });
  assert.equal(gate(dir, 'gate', [next.rel], 'clean').status, OK);
}));

test('normal non-sensitive chunks flow through in order once each gate passes', () => fixture((dir) => {
  const first = makePlan(dir, { chunk: 2, changes: [{ path: PLAIN, before: null, after: php }] });
  const second = makePlan(dir, { chunk: 3, changes: [{ path: 'app/code/Acme/Widget/Model/Other.php', before: null, after: php }] });
  assert.equal(gate(dir, 'gate', [first.rel], 'clean').status, OK);
  assert.equal(gate(dir, 'gate', [second.rel], 'clean').status, OK);
}));

test('rejection leaves unrelated developer changes and applied files untouched and reports recovery', () => fixture((dir) => {
  put(dir, 'app/code/Acme/Widget/Model/DevWork.php', '<?php // uncommitted developer work\n');
  put(dir, PLAIN, php);
  const developer = readFileSync(join(dir, 'app/code/Acme/Widget/Model/DevWork.php'), 'utf8');
  const plan = makePlan(dir, { changes: [{ path: PLAIN, before: '<?php\n// old\n', after: php }] });
  const result = gate(dir, 'gate', [plan.rel], 'critical');
  assert.equal(result.status, BLOCKED);
  assert.match(result.stdout, /RECOVERY: app\/code\/Acme\/Widget\/Model\/Helper\.php -> applied-rejected/);
  assert.equal(readFileSync(join(dir, 'app/code/Acme/Widget/Model/DevWork.php'), 'utf8'), developer);
  assert.equal(readFileSync(join(dir, PLAIN), 'utf8'), php);
}));

test('deleted files are listed rather than scanned and renames scan the new path', () => fixture((dir) => {
  const log = join(dir, 'scanned.log');
  const plan = makePlan(dir, { changes: [
    { path: 'app/code/Acme/Widget/Model/Old.php', before: php, after: null },
    { path: 'app/code/Acme/Widget/Model/New.php', before: null, after: php }] });
  const result = spawnSync('python3', ['-B', gateScript, 'gate', plan.rel, '--project-root', dir,
    '--scanner-cmd', scanner(dir, 'clean', log)], { encoding: 'utf8' });
  assert.equal(result.status, OK, result.stdout + result.stderr);
  const scanned = readFileSync(log, 'utf8');
  assert.match(scanned, /New\.php/);
  assert.doesNotMatch(scanned, /Old\.php/);
  const record = JSON.parse(readFileSync(join(dir, '.ccua/review', readRecord(dir)), 'utf8'));
  assert.deepEqual(record.deleted, ['app/code/Acme/Widget/Model/Old.php']);
}));

function readRecord(dir) {
  const out = spawnSync('python3', ['-c', 'import os,sys;print([f for f in os.listdir(sys.argv[1]) if f.startswith("security-gate-")][0])',
    join(dir, '.ccua/review')], { encoding: 'utf8' });
  return out.stdout.trim();
}

test('sensitive changes require approval even when the scan is clean', () => fixture((dir) => {
  const plan = makePlan(dir, { changes: [{ path: SENSITIVE, before: null, after: '<config/>\n' }] });
  const result = gate(dir, 'gate', [plan.rel], 'clean');
  assert.equal(result.status, APPROVAL);
  assert.match(result.stdout, /SENSITIVE: app\/code\/Acme\/Widget\/etc\/acl\.xml/);
  assert.match(result.stdout, /PENDING-APPROVAL/);
  assert.notEqual(gate(dir, 'verify', [plan.rel]).status, OK);
}));

test('plan-marked sensitive changes require approval regardless of path', () => fixture((dir) => {
  const plan = makePlan(dir, { changes: [{ path: PLAIN, before: null, after: php, sensitive: true }] });
  assert.equal(gate(dir, 'gate', [plan.rel], 'clean').status, APPROVAL);
}));

test('missing, non-interactive, cancelled, wrong or forged approval never accepts', () => fixture((dir) => {
  const plan = makePlan(dir, { changes: [{ path: SENSITIVE, before: null, after: '<config/>\n' }] });
  const base = ['approve', plan.rel, '--expected-plan-sha256', plan.sha];
  // Piped (agent-style) input is rejected: no terminal.
  const piped = spawnSync('python3', ['-B', gateScript, ...base, '--project-root', dir,
    '--scanner-cmd', scanner(dir, 'clean')], { input: `APPROVE ${plan.sha.slice(0, 12)}\n`, encoding: 'utf8' });
  assert.equal(piped.status, APPROVAL);
  // Cancelled / wrong phrase on a real terminal.
  assert.equal(approveWithTty(dir, plan, '').status, APPROVAL);
  assert.equal(approveWithTty(dir, plan, 'yes').status, APPROVAL);
  // A forged record is not accepted.
  put(dir, `.ccua/review/security-approval-hop1-chunk3-${plan.sha.slice(0, 12)}.json`, JSON.stringify({
    schemaVersion: 1, decision: 'approved', interactive: false, operator: 'agent',
    planSha256: plan.sha, policySha256: 'x', files: {} }));
  assert.equal(gate(dir, 'gate', [plan.rel], 'clean').status, APPROVAL);
  // Approval is refused outright while the scan is blocked.
  const blocked = spawnSync('python3', ['-B', gateScript, ...base, '--project-root', dir,
    '--scanner-cmd', scanner(dir, 'high')], { encoding: 'utf8' });
  assert.equal(blocked.status, BLOCKED);
}));

test('live human approval is bound to the plan and then allows acceptance', () => fixture((dir) => {
  const plan = makePlan(dir, { changes: [{ path: SENSITIVE, before: null, after: '<config/>\n' }] });
  const approved = approveWithTty(dir, plan, `APPROVE ${plan.sha.slice(0, 12)}`);
  assert.equal(approved.status, OK, approved.stdout + approved.stderr);
  assert.equal(gate(dir, 'gate', [plan.rel], 'clean').status, OK);
  assert.equal(gate(dir, 'verify', [plan.rel]).status, OK);
  // A High finding on a later re-run still blocks despite the existing approval.
  assert.equal(gate(dir, 'gate', [plan.rel], 'high').status, BLOCKED);
  // Changing the plan invalidates the approval (new plan hash).
  const changed = makePlan(dir, { name: 'plan-changed', changes: [{ path: SENSITIVE, before: null, after: '<config>x</config>\n' }] });
  assert.equal(gate(dir, 'gate', [changed.rel], 'clean').status, APPROVAL);
}));

test('post-upgrade scan covers files from every hop and blocks on findings or missing gates', () => fixture((dir) => {
  const log = join(dir, 'final.log');
  const hop1 = makePlan(dir, { hop: 1, chunk: 3, changes: [{ path: 'app/code/Acme/A/Model/One.php', before: null, after: php }] });
  const hop2 = makePlan(dir, { hop: 2, chunk: 3, changes: [{ path: 'app/code/Acme/B/Model/Two.php', before: null, after: php },
    { path: 'app/code/Acme/B/Model/Gone.php', before: php, after: null }] });
  assert.equal(gate(dir, 'gate', [hop1.rel], 'clean').status, OK);
  assert.equal(gate(dir, 'gate', [hop2.rel], 'clean').status, OK);
  put(dir, 'app/code/Acme/A/Model/One.php', php);
  put(dir, 'app/code/Acme/B/Model/Two.php', php);
  const run = (mode, plans) => spawnSync('python3', ['-B', gateScript, 'final', '--plans', ...plans,
    '--project-root', dir, '--scanner-cmd', scanner(dir, mode, log)], { encoding: 'utf8' });
  const ok = run('clean', [hop1.rel, hop2.rel]);
  assert.equal(ok.status, OK, ok.stdout + ok.stderr);
  const seen = readFileSync(log, 'utf8');
  assert.match(seen, /One\.php/);
  assert.match(seen, /Two\.php/);
  assert.doesNotMatch(seen, /Gone\.php/);
  assert.equal(JSON.parse(readFileSync(join(dir, '.ccua/review/security-final-report.json'), 'utf8')).status, 'accepted');
  assert.equal(run('critical', [hop1.rel, hop2.rel]).status, BLOCKED);
  const hop3 = makePlan(dir, { hop: 3, chunk: 3, changes: [{ path: 'app/code/Acme/C/Model/Three.php', before: null, after: php }] });
  gate(dir, 'gate', [hop3.rel], 'high');
  const missing = run('clean', [hop1.rel, hop2.rel, hop3.rel]);
  assert.equal(missing.status, BLOCKED);
  assert.match(missing.stdout, /chunk-gate-not-accepted:hop3-chunk3/);
}));

test('CI changed-scan fails on blocking findings and scanner errors, passes when clean', () => fixture((dir) => {
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 't@example.invalid'); git('config', 'user.name', 't');
  put(dir, 'README.md', 'x\n');
  git('add', '-A'); git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD').stdout.trim();
  put(dir, PLAIN, php); put(dir, 'docs/notes.txt', 'ignored\n');
  git('add', '-A'); git('commit', '-q', '-m', 'change');
  const run = (mode) => spawnSync('python3', ['-B', gateScript, 'changed-scan', '--base', base, '--head', 'HEAD',
    '--output', join(dir, 'report.json'), '--project-root', dir, '--scanner-cmd', scanner(dir, mode, join(dir, 'ci.log'))],
  { encoding: 'utf8' });
  assert.equal(run('clean').status, OK);
  assert.match(readFileSync(join(dir, 'ci.log'), 'utf8'), /Helper\.php/);
  assert.doesNotMatch(readFileSync(join(dir, 'ci.log'), 'utf8'), /notes\.txt/);
  assert.equal(run('high').status, BLOCKED);
  assert.equal(JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')).status, 'blocked');
  assert.equal(run('crash').status, BLOCKED);
  const bad = spawnSync('python3', ['-B', gateScript, 'changed-scan', '--base', 'no-such-rev', '--output',
    join(dir, 'r2.json'), '--project-root', dir, '--scanner-cmd', scanner(dir, 'clean')], { encoding: 'utf8' });
  assert.equal(bad.status, BLOCKED);
}));

test('CI workflow defines a least-privilege Security Scan job that cannot soft-fail', () => {
  const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
  const job = ci.slice(ci.indexOf('\n  security:'));
  assert.match(job, /name: Security Scan/);
  assert.match(job, /permissions:\n      contents: read/);
  assert.match(job, /security_gate\.py changed-scan/);
  assert.match(job, /Magento2\\\.Security/);
  assert.doesNotMatch(job, /continue-on-error/);
  assert.doesNotMatch(job, /pull_request_target/);
  assert.doesNotMatch(ci, /pull_request_target/);
  assert.doesNotMatch(job, /\|\| true/);
  assert.doesNotMatch(job, /\$\{\{\s*github\.(?:head_ref|event\.pull_request\.title)/);
  for (const use of job.match(/uses: \S+/g)) assert.match(use, /@[0-9a-f]{40}$/, `${use} must be pinned to a SHA`);
  assert.match(job, /semgrep==\d+\.\d+\.\d+/);
});

test('agent instructions and the workflow carry the mandatory security rules', () => {
  const guardrail = readFileSync(join(root, '.claude/guardrails/secure-code-generation.md'), 'utf8');
  for (const phrase of [/parameterized/i, /Escape output/i, /unserialize/i, /ObjectManager/, /ACL/,
    /encryption/i, /payment/i, /secrets, tokens/i, /Disabling, skipping, weakening/i,
    /Report every security-sensitive change/i, /ambiguous/i, /never approval/i]) {
    assert.match(guardrail, phrase);
  }
  const agents = ['architect', 'developer', 'devops-engineer', 'documentation-engineer', 'frontend-developer',
    'qa-engineer', 'security-reviewer', 'upgrade-analyst'];
  for (const name of agents) {
    assert.match(readFileSync(join(root, `.claude/agents/commerce-${name}.md`), 'utf8'),
      /guardrails\/secure-code-generation\.md/, name);
    assert.match(readFileSync(join(root, `.github/agents/commerce-${name}.agent.md`), 'utf8'),
      /instructions\/secure-code-generation\.instructions\.md/, name);
  }
  assert.equal(readFileSync(join(root, '.github/instructions/secure-code-generation.instructions.md'), 'utf8')
    .includes('security_gate.py'), true);
  for (const file of ['.claude/commands/upgrade-hop-execute.md', '.github/skills/upgrade-hop-execute/SKILL.md']) {
    const text = readFileSync(join(root, file), 'utf8');
    assert.match(text, /security_gate\.py gate/);
    assert.match(text, /security_gate\.py verify <plan> --applied/);
    assert.match(text, /security_gate\.py final --plans/);
    assert.match(text, /approve <plan> --expected-plan-sha256/);
  }
  for (const script of ['security_gate.py', 'security-gate-policy.json', 'semgrep-magento-security.yml']) {
    assert.equal(readFileSync(join(root, '.github/scripts', script), 'utf8'),
      readFileSync(join(root, '.claude/scripts', script), 'utf8'), `${script} mirror drifted`);
  }
});

// Real rule tests: only when Semgrep is installed (CI installs it).
const semgrep = process.env.SEMGREP_BIN || 'semgrep';
const haveSemgrep = spawnSync(semgrep, ['--version'], { encoding: 'utf8' }).status === 0;
if (process.env.CCUA_REQUIRE_SEMGREP === '1' && !haveSemgrep) throw new Error('CCUA_REQUIRE_SEMGREP=1 but semgrep is not installed');
const RULE_CASES = [
  ['sql-injection-concat', 'app/code/A/B/Model/ResourceModel/R.php', '<?php\n$c->query("SELECT * FROM t WHERE id=" . $id);\n', 'HIGH'],
  ['unsafe-unserialize', 'app/code/A/B/Model/U.php', '<?php\n$x = unserialize($data);\n', 'HIGH'],
  ['code-execution', 'app/code/A/B/Model/E.php', '<?php\nshell_exec($cmd);\n', 'CRITICAL'],
  ['objectmanager-dynamic-class', 'app/code/A/B/Model/O.php', '<?php\n$this->objectManager->create($class);\n', 'HIGH'],
  ['xss-request-data-unescaped', 'app/code/A/B/view/frontend/templates/t.phtml', '<?php echo $block->getRequest()->getParam("q"); ?>\n', 'HIGH'],
  ['admin-controller-allows-all', 'app/code/A/B/Controller/Adminhtml/X/Save.php', '<?php\nclass Save { protected function _isAllowed() { return true; } }\n', 'HIGH'],
  ['hardcoded-credential', 'app/code/A/B/Model/C.php', '<?php\n$apiKey = "abcdef123456";\n', 'HIGH'],
  ['webapi-anonymous-write', 'app/code/A/B/etc/webapi.xml', '<routes><route url="/V1/x" method="POST"><service class="A" method="b"/><resources><resource ref="anonymous"/></resources></route></routes>\n', 'HIGH'],
  ['csp-wildcard-source', 'app/code/A/B/etc/csp_whitelist.xml', '<csp_whitelist><policies><policy id="script-src"><values><value id="x" type="host">*</value></values></policy></policies></csp_whitelist>\n', 'HIGH'],
  ['di-security-preference', 'app/code/A/B/etc/di.xml', '<config><preference for="Magento\\Framework\\Encryption\\Encryptor" type="A\\B\\Enc"/></config>\n', 'MEDIUM'],
];
RULE_CASES.push(['di-security-plugin', 'app/code/A/B/etc/di.xml', '<config>\n  <type name="Magento\\Framework\\Encryption\\Encryptor">\n    <plugin name="x" type="A\\B\\P"/>\n  </type>\n</config>\n', 'MEDIUM']);
const CLEAN_CASES = [
  ['app/code/A/B/Model/R.php', '<?php\n$this->productRepository->get($sku);\n$this->itemFactory->create($data);\n'],
  ['app/code/A/B/Model/ResourceModel/R.php', '<?php\n$c->query("SELECT * FROM t WHERE id = ?", [$id]);\n$select->where("id = ?", $id);\n'],
  ['app/code/A/B/Model/U.php', '<?php\n$x = unserialize($data, ["allowed_classes" => false]);\n'],
  ['app/code/A/B/view/frontend/templates/t.phtml', '<?= $escaper->escapeHtml($block->getRequest()->getParam("q")) ?>\n<?= $block->getChildHtml("x") ?>\n'],
  ['app/code/A/B/etc/webapi.xml', '<routes><route url="/V1/x" method="POST"><service class="A" method="b"/><resources><resource ref="A_B::manage"/></resources></route></routes>\n'],
];

test('Semgrep rules detect each implemented class and spare safe patterns', { skip: !haveSemgrep && 'semgrep not installed' }, () => fixture((dir) => {
  const rules = join(root, '.claude/scripts/semgrep-magento-security.yml');
  const scan = (path, content) => {
    const target = mkdtempSync(join(dir, 'case-'));
    put(target, path, content);
    const out = spawnSync(semgrep, ['scan', '--config', rules, '--json', '--quiet', '--metrics=off',
      '--disable-version-check', '.'], { cwd: target, encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    const parsed = JSON.parse(out.stdout);
    assert.deepEqual(parsed.errors, []);
    return parsed.results;
  };
  for (const [rule, path, content, severity] of RULE_CASES) {
    const hit = scan(path, content).find((r) => r.check_id.endsWith(`ccua.${rule}`));
    assert.ok(hit, `rule ${rule} did not fire`);
    assert.equal(hit.extra.metadata.ccua_severity, severity);
  }
  for (const [path, content] of CLEAN_CASES) {
    assert.deepEqual(scan(path, content).map((r) => r.check_id), [], path);
  }
}));

test('skipped, oversized or unreported scan inputs fail closed', () => fixture((dir) => {
  const plan = makePlan(dir, { changes: [{ path: PLAIN, before: null, after: php }] });
  for (const mode of ['skipped', 'nopaths', 'emptyscan']) {
    const result = gate(dir, 'gate', [plan.rel], mode);
    assert.equal(result.status, BLOCKED, mode);
    assert.match(result.stdout, /scanner-(skipped-input|coverage-unknown|coverage-empty|coverage-partial)/);
  }
}));

test('editing the rule pack invalidates an accepted gate record', () => fixture((dir) => {
  // Mutate an isolated copy of the gate so the shared repository assets are never touched.
  const copy = join(dir, 'gate-copy');
  mkdirSync(copy);
  for (const file of ['security_gate.py', 'normalize_uct.py', 'security-gate-policy.json',
    'semgrep-magento-security.yml']) {
    writeFileSync(join(copy, file), readFileSync(join(root, '.claude/scripts', file)));
  }
  const run = (action, rel) => spawnSync('python3', ['-B', join(copy, 'security_gate.py'), action, rel,
    '--project-root', dir, ...(action === 'gate' ? ['--scanner-cmd', scanner(dir, 'clean')] : [])],
  { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  const plan = makePlan(dir, { changes: [{ path: PLAIN, before: null, after: php }] });
  assert.equal(run('gate', plan.rel).status, OK);
  assert.equal(run('verify', plan.rel).status, OK);
  const rules = join(copy, 'semgrep-magento-security.yml');
  writeFileSync(rules, Buffer.concat([readFileSync(rules), Buffer.from('\n# weakened\n')]));
  assert.equal(run('verify', plan.rel).status, INVALID);
}));

test('final blocks a file that became security-sensitive after its clean chunk gate', () => fixture((dir) => {
  const plan = makePlan(dir, { changes: [{ path: PLAIN, before: null, after: php }] });
  assert.equal(gate(dir, 'gate', [plan.rel], 'clean').status, OK);
  put(dir, PLAIN, '<?php\nuse Magento\\Framework\\Encryption\\Encryptor;\nclass Helper {}\n');
  const result = gate(dir, 'final', ['--plans', plan.rel], 'clean');
  assert.equal(result.status, BLOCKED);
  assert.match(result.stdout, /sensitive-file-changed-after-approval/);
}));

test('removing security-sensitive code from an ordinary path still needs approval', () => fixture((dir) => {
  const before = '<?php\nuse Magento\\Framework\\Encryption\\Encryptor;\nclass Helper {}\n';
  const plan = makePlan(dir, { changes: [{ path: PLAIN, before, after: php }] });
  assert.equal(gate(dir, 'gate', [plan.rel], 'clean').status, APPROVAL);
}));

test('sensitive class families in neutral PHP paths require approval', () => fixture((dir) => {
  const uses = ['Magento\\Customer\\Model\\Authentication', 'Magento\\Authorization\\Model\\Acl',
    'Magento\\Payment\\Model\\Method\\Adapter', 'Magento\\Backend\\Model\\Auth\\Session',
    'Magento\\Integration\\Model\\Oauth\\Token', 'Magento\\User\\Model\\User'];
  uses.forEach((name, i) => {
    const plan = makePlan(dir, { hop: i + 1, chunk: 1, changes: [{ path: PLAIN, before: null,
      after: `<?php\nuse ${name};\nclass Helper {}\n` }] });
    assert.equal(gate(dir, 'gate', [plan.rel], 'clean').status, APPROVAL, name);
  });
}));

test('post-upgrade scan blocks when an added file is missing and passes planned deletions', () => fixture((dir) => {
  const added = makePlan(dir, { hop: 1, chunk: 1, changes: [{ path: PLAIN, before: null, after: php }] });
  const removed = makePlan(dir, { hop: 2, chunk: 1, changes: [{ path: PLAIN, before: php, after: null }] });
  assert.equal(gate(dir, 'gate', [added.rel], 'clean').status, OK);
  let result = gate(dir, 'final', ['--plans', added.rel], 'clean');
  assert.equal(result.status, BLOCKED);
  assert.match(result.stdout, /expected-file-missing/);
  assert.equal(gate(dir, 'gate', [removed.rel], 'clean').status, OK);
  result = gate(dir, 'final', ['--plans', added.rel, removed.rel], 'clean');
  assert.equal(result.status, OK, result.stdout);
}));

test('post-upgrade scan blocks drift of an approved sensitive file', () => fixture((dir) => {
  const plan = makePlan(dir, { changes: [{ path: SENSITIVE, before: null, after: '<config/>\n' }] });
  assert.equal(approveWithTty(dir, plan, 'APPROVE ' + plan.sha.slice(0, 12)).status, OK);
  assert.equal(gate(dir, 'gate', [plan.rel], 'clean').status, OK);
  put(dir, SENSITIVE, '<config><changed/></config>\n');
  const result = gate(dir, 'final', ['--plans', plan.rel], 'clean');
  assert.equal(result.status, BLOCKED);
  assert.match(result.stdout, /sensitive-file-changed-after-approval/);
}));

test('scanner command disables inline suppressions and ignore-file shortcuts', () => {
  const policy = JSON.parse(readFileSync(join(root, '.claude/scripts/security-gate-policy.json'), 'utf8'));
  for (const flag of ['--disable-nosem', '--no-git-ignore']) assert.ok(policy.scanner.command.includes(flag), flag);
  assert.match(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8'), /--ignore-annotations/);
});

test('configuration-only and documentation-only proposals pass when no rule targets them', () => fixture((dir) => {
  const plan = makePlan(dir, { changes: [
    { path: 'composer.json', before: null, after: '{"name":"a/b"}\n' },
    { path: '.magento/services.yaml', before: null, after: 'db:\n  type: mysql\n' }] });
  const result = gate(dir, 'gate', [plan.rel], 'emptyscan');
  assert.equal(result.status, OK, result.stdout + result.stderr);
}));

test('a rule-targeted PHP file missing from the scanned inventory still fails closed', () => fixture((dir) => {
  const plan = makePlan(dir, { changes: [
    { path: 'composer.json', before: null, after: '{"name":"a/b"}\n' },
    { path: PLAIN, before: null, after: php }] });
  const result = gate(dir, 'gate', [plan.rel], 'emptyscan');
  assert.equal(result.status, BLOCKED);
  assert.match(result.stdout, /scanner-coverage-empty/);
}));
