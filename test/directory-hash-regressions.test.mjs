// Copyright 2026 Adobe. All rights reserved.
// Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// Linux uses /proc/self/fd and macOS uses volfs; both back the anchored directory helper.
const anchored = ['linux', 'darwin'].includes(process.platform);
function run(binary, args) {
  const result = spawnSync(binary, args, { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

for (const prefix of ['.claude', '.github']) {
  for (const phase of ['directory-open', 'stage-open', 'replace']) {
    test(`${prefix} normalizer rejects ${phase} directory swaps without touching outside targets`, () => {
      run('python3', ['-B', '-c', `
import importlib.util, os, pathlib, re, tempfile
prefix, phase = ${JSON.stringify(prefix)}, ${JSON.stringify(phase)}
spec = importlib.util.spec_from_file_location("fixture_normalizer",
    pathlib.Path(prefix) / "scripts/normalize_uct.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory(prefix="ccua-directory-race-") as fixture:
    root = pathlib.Path(fixture)
    parent = root / "context"
    parent.mkdir()
    outside = root / "outside"
    outside.mkdir()
    target = parent / "upgrade-findings.normalized.json"
    sentinel = outside / target.name
    sentinel.write_bytes(b"OUTSIDE_SENTINEL")
    original_open, original_rename = os.open, os.rename
    swapped = [False]
    def swap():
        if not swapped[0]:
            original_rename(parent, root / "held-context")
            parent.symlink_to(outside, target_is_directory=True)
            swapped[0] = True
    def opened(path, flags, *args, **kwargs):
        descriptor = original_open(path, flags, *args, **kwargs)
        if ((phase == "directory-open" and str(path) == "context") or
            (phase == "stage-open" and str(path).startswith(".upgrade-findings."))):
            swap()
        return descriptor
    def renamed(*args, **kwargs):
        if phase == "replace":
            swap()
        return original_rename(*args, **kwargs)
    os.open, os.rename = opened, renamed
    # Preserve the feature check for the test's equivalent open wrapper.
    original_supports = os.supports_dir_fd
    os.supports_dir_fd = original_supports | {opened, renamed}
    try:
        try:
            module.write_artifacts(((target, "NON_SECRET_FIXTURE\\n"),))
        except ValueError as error:
            assert re.search("artifact directory changed|Artifact published to held directory", str(error)), str(error)
        else:
            raise AssertionError("directory swap must block completion")
    finally:
        os.open, os.rename = original_open, original_rename
        os.supports_dir_fd = original_supports
    assert swapped[0], "race injection did not run"
    assert sentinel.read_bytes() == b"OUTSIDE_SENTINEL"
    assert sorted(p.name for p in outside.iterdir()) == [target.name]
    held = root / "held-context"
    assert not any(p.name.startswith(".upgrade-findings.") for p in held.iterdir())
`]);
    });
  }

  test(`${prefix} review parses the exact evidence, normalized, plan and policy buffers`, () => {
    run('python3', ['-B', '-c', `
import contextlib, hashlib, io, json, pathlib, sys, tempfile
sys.path.insert(0, str(pathlib.Path(${JSON.stringify(prefix)}) / "scripts"))
import review_change_plan as module
real_artifact = module.artifact
encode = lambda value: json.dumps(value).encode()
policy_fixture = {"schemaVersion": 1, "roles": {}, "denied": [], "restricted": [], "commandEffects": []}
normalized = encode({"normalizerVersion": 1, "targetVersion": "2.4.8",
    "accepted": [], "quarantine": [], "counts": {"accepted": 0, "quarantined": 0, "total": 0},
    "blocked": False, "rawSha256": "0" * 64})
ledger = encode({"schemaVersion": 1, "fromVersion": "2.4.7", "toVersion": "2.4.8",
    "normalized": ".ccua/review/normalized.json",
    "normalizedSha256": hashlib.sha256(normalized).hexdigest(), "sources": []})
counts = {}
def memory_read(path):
    name = pathlib.Path(path).name
    counts[name] = counts.get(name, 0) + 1
    assert counts[name] == 1, "hashed input reopened: " + name
    return {"evidence.json": ledger, "normalized.json": normalized,
            "plan.json": encode({"marker": "reviewed"}),
            "write-policy.json": encode(policy_fixture)}[name]
module.read_bytes = memory_read
module.artifact = lambda root, name, policy, exists=True: root / name
with tempfile.TemporaryDirectory(prefix="ccua-hash-binding-") as fixture:
    root = pathlib.Path(fixture)
    plan = {"evidence": ".ccua/review/evidence.json",
        "evidenceSha256": hashlib.sha256(ledger).hexdigest(),
        "fromVersion": "2.4.7", "toVersion": "2.4.8"}
    assert module.evidence(root, plan, {"denied": []}) == (set(), set())
    assert counts == {"evidence.json": 1, "normalized.json": 1}
    counts.clear()
    def check(root, policy, plan, *args):
        assert plan == {"marker": "reviewed"}
        assert policy == policy_fixture
        return [], [], [], None
    module.check = check
    # Group fields are unrelated to the read-once property under test.
    module.escaped = lambda value: json.dumps(value, default=str)
    class Plan(dict):
        def __getitem__(self, key):
            if key in {"agent", "kind", "environment", "fromVersion", "toVersion", "hop", "chunk"}:
                return "fixture"
            return super().__getitem__(key)
    original_parse = module.parse_json
    def parse(raw):
        result = original_parse(raw)
        return Plan(result) if result == {"marker": "reviewed"} else result
    module.parse_json = parse
    sys.argv = ["review_change_plan.py", "review", ".ccua/review/plan.json",
        "--project-root", str(root)]
    with contextlib.redirect_stdout(io.StringIO()) as output:
        assert module.main() == 0
    emitted = json.loads(output.getvalue())
    assert emitted["planSha256"] == hashlib.sha256(encode({"marker": "reviewed"})).hexdigest()
    assert emitted["policySha256"] == hashlib.sha256(encode(policy_fixture)).hexdigest()
    assert counts == {"plan.json": 1, "write-policy.json": 1}
    directory = root / ".ccua/review"
    directory.mkdir(parents=True)
    allowed = directory / "allowed.json"
    allowed.write_bytes(b"{}")
    fixed_policy = {"denied": [r".*/auth\\.json"]}
    assert real_artifact(root, ".ccua/review/allowed.json", fixed_policy) == allowed
    try:
        real_artifact(root, ".ccua/review/auth.json", fixed_policy)
    except ValueError:
        pass
    else:
        raise AssertionError("captured policy denies were bypassed")
    assert counts == {"plan.json": 1, "write-policy.json": 1}, "artifact checks reread policy"
for raw in [b'{"a":1,"a":2}', b'{"a":NaN}']:
    try:
        original_parse(raw)
    except ValueError:
        pass
    else:
        raise AssertionError("strict JSON behavior was lost")
`]);
  });
}

for (const platform of ['win32', 'freebsd']) {
  test(`anchored Node operations explicitly reject unsupported ${platform} hosts`, () => {
    run(process.execPath, ['--input-type=module', '-e', `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const fixture = fs.mkdtempSync(join(tmpdir(), 'ccua-unsupported-host-'));
const missing = join(fixture, 'missing');
try {
  Object.defineProperty(process, 'platform', { value: ${JSON.stringify(platform)} });
  const { openAnchoredDirectory } = await import('./scripts/lib/anchored-fs.mjs');
  assert.throws(() => openAnchoredDirectory(missing), /requires Linux procfs or macOS volfs/);
  assert.throws(() => openAnchoredDirectory(missing,
    { create: true, createRoot: fixture }), /requires Linux procfs or macOS volfs/);
  assert.equal(fs.existsSync(missing), false);
} finally { fs.rmSync(fixture, { recursive: true, force: true }); }
`]);
  });
}

test('a held directory keeps writing to the original directory after its path becomes a symlink',
  { skip: !anchored }, () => {
    run(process.execPath, ['--input-type=module', '-e', `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openAnchoredDirectory } from './scripts/lib/anchored-fs.mjs';
// Resolve the temp directory first: system links such as /var are rejected by design.
const fixture = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'ccua-held-directory-')));
try {
  const project = join(fixture, 'project');
  const target = join(project, 'context');
  const outside = join(fixture, 'outside');
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(outside);
  const directory = openAnchoredDirectory(target);
  try {
    const { O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW } = fs.constants;
    fs.closeSync(fs.openSync(directory.entry('before.txt'), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600));
    fs.renameSync(target, join(project, 'held'));
    fs.symlinkSync(outside, target, 'dir');
    fs.closeSync(fs.openSync(directory.entry('after.txt'), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600));
    fs.renameSync(directory.entry('after.txt'), directory.entry('renamed.txt'));
    assert.deepEqual(fs.readdirSync(outside), [], 'nothing may reach the symlink target');
    assert.deepEqual(fs.readdirSync(join(project, 'held')).sort(), ['before.txt', 'renamed.txt']);
    assert.throws(() => directory.assertAttached(), /Directory changed during anchored operation|unavailable/);
  } finally { directory.close(); }
} finally { fs.rmSync(fixture, { recursive: true, force: true }); }
`]);
  });

test('anchored open rejects a symbolic link in any parent directory',
  { skip: !anchored }, () => {
    run(process.execPath, ['--input-type=module', '-e', `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openAnchoredDirectory } from './scripts/lib/anchored-fs.mjs';
const fixture = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'ccua-parent-link-')));
try {
  fs.mkdirSync(join(fixture, 'real', 'project'), { recursive: true });
  fs.symlinkSync(join(fixture, 'real'), join(fixture, 'linked'), 'dir');
  assert.throws(() => openAnchoredDirectory(join(fixture, 'linked', 'project')));
  openAnchoredDirectory(join(fixture, 'real', 'project')).close();
} finally { fs.rmSync(fixture, { recursive: true, force: true }); }
`]);
  });

for (const agent of ['claude-code', 'github-copilot']) {
  test(`${agent} marker replacement stays on held directory under a last-moment swap`,
    { skip: !anchored }, () => {
      run(process.execPath, ['--input-type=module', '-e', `
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import native from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeInstalledVersion } from './scripts/lib/sync-assets.mjs';
const fixture = native.mkdtempSync(join(tmpdir(), 'ccua-marker-race-'));
const parent = join(fixture, ${JSON.stringify(agent === 'claude-code' ? '.claude' : '.github')}, 'context');
const outside = join(fixture, 'outside');
native.mkdirSync(parent, { recursive: true });
native.mkdirSync(outside);
native.writeFileSync(join(parent, '.ccua-version'), '2.0.1\\n');
native.writeFileSync(join(outside, '.ccua-version'), '99.99.99\\n');
const original = fs.rename;
let swapped = false;
fs.rename = async (from, to) => {
  if (from.includes('/.ccua-version-')) {
    native.renameSync(parent, parent + '-held');
    native.symlinkSync(outside, parent, 'dir');
    swapped = true;
  }
  return original(from, to);
};
try {
  await assert.rejects(writeInstalledVersion(fixture, '2.0.2', ${JSON.stringify(agent)}),
    /Marker published to held directory/);
  assert.equal(swapped, true);
  assert.equal(native.readFileSync(join(outside, '.ccua-version'), 'utf8'), '99.99.99\\n');
  assert.deepEqual(native.readdirSync(outside), ['.ccua-version']);
  assert.ok(!native.readdirSync(parent + '-held').some(name => name.startsWith('.ccua-version-')));
} finally {
  fs.rename = original;
  native.rmSync(fixture, { recursive: true, force: true });
}
`]);
    });
}

for (const phase of ['config-rename', 'journal-open']) {
  test(`legacy reconciliation ${phase} remains anchored and never rewrites outside files`,
    { skip: !anchored }, () => {
      run(process.execPath, ['--input-type=module', '-e', `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { reconcileLegacyCodegraph } = await import('./scripts/lib/codegraph-policy.mjs');
const fixture = fs.mkdtempSync(join(tmpdir(), 'ccua-reconciliation-race-'));
const parent = join(fixture, ${JSON.stringify(phase === 'config-rename' ? '.vscode' : '.ccua')});
const outside = join(fixture, 'outside');
fs.mkdirSync(join(fixture, '.vscode'));
fs.mkdirSync(join(fixture, '.ccua'));
fs.mkdirSync(outside);
fs.writeFileSync(join(fixture, '.vscode/mcp.json'),
  JSON.stringify({ servers: { codegraph: { command: 'codegraph', args: ['serve', '--mcp'] } } }));
fs.writeFileSync(join(outside, 'mcp.json'), '{"outside":true}\\n');
fs.writeFileSync(join(outside, 'legacy-reconciliation.json'), '{"outside":true}\\n');
const originalRename = fs.renameSync, originalOpen = fs.openSync;
let swapped = false;
const swap = () => {
  if (!swapped) {
    originalRename(parent, parent + '-held');
    fs.symlinkSync(outside, parent, 'dir');
    swapped = true;
  }
};
fs.renameSync = (from, to) => {
  if (${JSON.stringify(phase)} === 'config-rename' && String(from).includes('/.ccua-reconcile-')) swap();
  return originalRename(from, to);
};
fs.openSync = (path, flags, ...args) => {
  if (${JSON.stringify(phase)} === 'journal-open' &&
      String(path).endsWith('/legacy-reconciliation.json') && (flags & fs.constants.O_CREAT)) swap();
  return originalOpen(path, flags, ...args);
};
syncBuiltinESMExports();
try {
  assert.throws(() => reconcileLegacyCodegraph(fixture),
    ${JSON.stringify(phase)} === 'config-rename'
      ? /Config published to held directory/ : /Directory changed during anchored operation/);
  assert.equal(swapped, true);
  for (const name of ['mcp.json', 'legacy-reconciliation.json']) {
    assert.equal(fs.readFileSync(join(outside, name), 'utf8'), '{"outside":true}\\n');
  }
  assert.deepEqual(fs.readdirSync(outside).sort(), ['legacy-reconciliation.json', 'mcp.json']);
} finally {
  fs.renameSync = originalRename;
  fs.openSync = originalOpen;
  syncBuiltinESMExports();
  fs.rmSync(fixture, { recursive: true, force: true });
}
`]);
    });
}
for (const prefix of ['.claude', '.github']) {
  test(`${prefix} normalizer stages both artifacts before publication and refuses missing dir_fd support`, () => {
    run('python3', ['-B', '-c', `
import importlib.util, os, pathlib, tempfile
spec = importlib.util.spec_from_file_location("fixture_normalizer",
    pathlib.Path(${JSON.stringify(prefix)}) / "scripts/normalize_uct.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory(prefix="ccua-normal-publication-") as fixture:
    parent = pathlib.Path(fixture)
    one, two = parent / "upgrade-findings.normalized.json", parent / "upgrade-findings.quarantine.json"
    original_rename, original_supports = os.rename, os.supports_dir_fd
    calls = []
    def renamed(source, target, **kwargs):
        assert kwargs["src_dir_fd"] == kwargs["dst_dir_fd"]
        if not calls:
            assert len([name for name in os.listdir(kwargs["src_dir_fd"])
                        if name.startswith(".upgrade-findings.")]) == 2
        calls.append(target)
        return original_rename(source, target, **kwargs)
    os.rename = renamed
    os.supports_dir_fd = original_supports | {renamed}
    try:
        module.write_artifacts(((one, "one\\n"), (two, "two\\n")))
    finally:
        os.rename, os.supports_dir_fd = original_rename, original_supports
    assert calls == [one.name, two.name]
    assert one.read_text() == "one\\n" and two.read_text() == "two\\n"
    assert one.stat().st_mode & 0o777 == 0o600
    assert two.stat().st_mode & 0o777 == 0o600
    assert sorted(p.name for p in parent.iterdir()) == sorted([one.name, two.name])
    os.supports_dir_fd = original_supports - {original_rename}
    try:
        try:
            module.write_artifacts(((one, "must not publish"),))
        except ValueError as error:
            assert "directory-relative publication support required" in str(error)
        else:
            raise AssertionError("missing support accepted")
    finally:
        os.supports_dir_fd = original_supports
    assert one.read_text() == "one\\n"
`]);
  });
}

test('Linux directory creation requires an existing root and rejects scope escapes',
  { skip: !anchored }, () => {
    run(process.execPath, ['--input-type=module', '-e', `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openAnchoredDirectory } from './scripts/lib/anchored-fs.mjs';
const fixture = fs.mkdtempSync(join(tmpdir(), 'ccua-anchor-bounds-'));
try {
  const missingRoot = join(fixture, 'missing-root');
  assert.throws(() => openAnchoredDirectory(join(missingRoot, 'context'),
    { create: true, createRoot: missingRoot }), { code: 'ENOENT' });
  assert.equal(fs.existsSync(missingRoot), false);
  assert.throws(() => openAnchoredDirectory(join(fixture, 'outside'),
    { create: true, createRoot: join(fixture, 'project') }), /outside reviewed project root/);
  assert.equal(fs.existsSync(join(fixture, 'outside')), false);
  const anchor = openAnchoredDirectory(join(fixture, '.claude/context'),
    { create: true, createRoot: fixture });
  try {
    anchor.assertAttached();
    fs.writeFileSync(anchor.entry('fixture.txt'), 'NON_SECRET_FIXTURE');
    anchor.sync();
  } finally { anchor.close(); }
  assert.equal(fs.readFileSync(join(fixture, '.claude/context/fixture.txt'), 'utf8'),
    'NON_SECRET_FIXTURE');
} finally { fs.rmSync(fixture, { recursive: true, force: true }); }
`]);
  });

for (const agent of ['claude-code', 'github-copilot']) {
  test(`${agent} normal marker publication preserves installation and update behavior`,
    { skip: !anchored }, () => {
      run(process.execPath, ['--input-type=module', '-e', `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeInstalledVersion, readInstalledVersion, detectInstalledAgent } from './scripts/lib/sync-assets.mjs';
const fixture = fs.mkdtempSync(join(tmpdir(), 'ccua-marker-positive-'));
try {
  await writeInstalledVersion(fixture, '2.0.1', ${JSON.stringify(agent)});
  assert.equal(await detectInstalledAgent(fixture), ${JSON.stringify(agent)});
  assert.equal(await readInstalledVersion(fixture, ${JSON.stringify(agent)}), '2.0.1');
  await writeInstalledVersion(fixture, '2.0.2', ${JSON.stringify(agent)});
  assert.equal(await readInstalledVersion(fixture, ${JSON.stringify(agent)}), '2.0.2');
  const context = join(fixture, ${JSON.stringify(agent === 'claude-code' ? '.claude' : '.github')}, 'context');
  assert.deepEqual(fs.readdirSync(context), ['.ccua-version']);
} finally { fs.rmSync(fixture, { recursive: true, force: true }); }
`]);
    });
}

test('Linux legacy cleanup keeps configuration modes and removes successful recovery metadata',
  { skip: !anchored }, () => {
    run(process.execPath, ['--input-type=module', '-e', `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { reconcileLegacyCodegraph } from './scripts/lib/codegraph-policy.mjs';
const fixture = fs.mkdtempSync(join(tmpdir(), 'ccua-reconcile-positive-'));
fs.mkdirSync(join(fixture, '.vscode'));
const target = join(fixture, '.vscode/mcp.json');
fs.writeFileSync(target, JSON.stringify({ servers: {
  codegraph: { command: 'codegraph', args: ['serve', '--mcp'] },
  preserved: { type: 'stdio', command: 'NON_EXECUTED_FIXTURE', args: [] }
} }), { mode: 0o640 });
const originalChmod = fs.fchmodSync;
let inspected = false;
fs.fchmodSync = (descriptor, mode) => {
  assert.equal(fs.fstatSync(descriptor).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(join(fixture, '.ccua/legacy-reconciliation.json')), true);
  inspected = true;
  return originalChmod(descriptor, mode);
};
syncBuiltinESMExports();
try {
  reconcileLegacyCodegraph(fixture);
  assert.equal(inspected, true);
  assert.equal(fs.statSync(target).mode & 0o777, 0o640);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(target, 'utf8')).servers), ['preserved']);
  assert.deepEqual(fs.readdirSync(join(fixture, '.ccua')), []);
  assert.deepEqual(fs.readdirSync(join(fixture, '.vscode')), ['mcp.json']);
} finally {
  fs.fchmodSync = originalChmod;
  syncBuiltinESMExports();
  fs.rmSync(fixture, { recursive: true, force: true });
}
`]);
  });
for (const prefix of ['.claude', '.github']) {
  test(`${prefix} shared reads enforce descriptor bounds and reject links, FIFOs and growth`, () => {
    run('python3', ['-B', '-c', `
import errno, importlib.util, os, pathlib, tempfile
spec = importlib.util.spec_from_file_location("fixture_normalizer",
    pathlib.Path(${JSON.stringify(prefix)}) / "scripts/normalize_uct.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory(prefix="ccua-bounded-read-") as fixture:
    root = pathlib.Path(fixture)
    source = root / "fixture.txt"
    source.write_bytes(b"abc")
    assert module.read_file_bytes(source, 3) == b"abc"
    try:
        module.read_file_bytes(source, 2)
    except ValueError as error:
        assert "oversized bounded read" in str(error)
    else:
        raise AssertionError("oversized read accepted")
    alias = root / "alias.txt"
    alias.symlink_to(source)
    try:
        module.read_file_bytes(alias, 10)
    except OSError as error:
        assert error.errno == errno.ELOOP
    else:
        raise AssertionError("symlink read accepted")
    hardlink = root / "hardlink.txt"
    os.link(source, hardlink)
    try:
        module.read_file_bytes(source, 10)
    except ValueError as error:
        assert "unsafe" in str(error)
    else:
        raise AssertionError("multiple links accepted")
    hardlink.unlink()
    fifo = root / "fifo.txt"
    os.mkfifo(fifo)
    try:
        module.read_file_bytes(fifo, 10)
    except ValueError as error:
        assert "unsafe" in str(error)
    else:
        raise AssertionError("FIFO accepted")
    original_read = os.read
    lengths, grew = [], [False]
    def read(descriptor, length):
        chunk = original_read(descriptor, length)
        lengths.append(len(chunk))
        if not grew[0]:
            with source.open("ab") as stream:
                stream.write(b"growth")
            grew[0] = True
        return chunk
    os.read = read
    try:
        try:
            module.read_file_bytes(source, 10)
        except ValueError as error:
            assert "changed during bounded read" in str(error)
        else:
            raise AssertionError("growing read accepted")
    finally:
        os.read = original_read
    assert grew[0] and sum(lengths) <= 4
`]);
  });

  test(`${prefix} publication cleanup failure retains the original drift diagnosis`, () => {
    run('python3', ['-B', '-c', `
import importlib.util, os, pathlib, tempfile
spec = importlib.util.spec_from_file_location("fixture_normalizer",
    pathlib.Path(${JSON.stringify(prefix)}) / "scripts/normalize_uct.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory(prefix="ccua-cleanup-error-") as fixture:
    root = pathlib.Path(fixture)
    parent, outside = root / "context", root / "outside"
    parent.mkdir()
    outside.mkdir()
    original_rename, original_unlink, original_supports = os.rename, os.unlink, os.supports_dir_fd
    swapped = [False]
    def rename(*args, **kwargs):
        original_rename(parent, root / "held")
        parent.symlink_to(outside, target_is_directory=True)
        swapped[0] = True
        return original_rename(*args, **kwargs)
    def unlink(path, *args, **kwargs):
        if str(path).startswith(".upgrade-findings."):
            raise PermissionError("NON_SECRET_FIXTURE_CLEANUP_FAILURE")
        return original_unlink(path, *args, **kwargs)
    os.rename, os.unlink = rename, unlink
    os.supports_dir_fd = original_supports | {rename, unlink}
    try:
        try:
            module.write_artifacts(((parent / "upgrade-findings.normalized.json", "{}"),))
        except OSError as error:
            assert "cleanup failed" in str(error)
            assert isinstance(error.__cause__, ValueError)
            assert "Artifact published to held directory" in str(error.__cause__)
        else:
            raise AssertionError("cleanup failure accepted")
    finally:
        os.rename, os.unlink, os.supports_dir_fd = original_rename, original_unlink, original_supports
    assert swapped[0] and list(outside.iterdir()) == []
`]);
  });
}

test('Linux recovery keeps the journal lock anchor alive through borrowed reads',
  { skip: !anchored }, () => {
    run(process.execPath, ['--input-type=module', '-e', `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { recoverLegacyCodegraph } from './scripts/lib/codegraph-policy.mjs';
const fixture = fs.mkdtempSync(join(tmpdir(), 'ccua-borrowed-anchor-'));
const hash = source => createHash('sha256').update(source).digest('hex');
fs.mkdirSync(join(fixture, '.vscode'));
fs.mkdirSync(join(fixture, '.ccua'));
const before = JSON.stringify({ servers: {
  codegraph: { command: 'codegraph', args: ['serve', '--mcp'] }
} });
const after = JSON.stringify({ servers: {} }, null, 2) + '\\n';
fs.writeFileSync(join(fixture, '.vscode/mcp.json'), before);
fs.writeFileSync(join(fixture, '.ccua/legacy-reconciliation.json'), JSON.stringify({
  schemaVersion: 1,
  files: ['.mcp.json', '.vscode/mcp.json', '.claude/settings.json', '.claude/settings.local.json'].map(path => ({
    path,
    beforeSha256: path === '.vscode/mcp.json' ? hash(before) : null,
    afterSha256: path === '.vscode/mcp.json' ? hash(after) : null
  }))
}));
try {
  recoverLegacyCodegraph(fixture);
  assert.equal(fs.readFileSync(join(fixture, '.vscode/mcp.json'), 'utf8'), after);
  assert.deepEqual(fs.readdirSync(join(fixture, '.ccua')), []);
} finally { fs.rmSync(fixture, { recursive: true, force: true }); }
`]);
  });

test('Linux reconciliation cleanup errors retain the primary published-state error first',
  { skip: !anchored }, () => {
    run(process.execPath, ['--input-type=module', '-e', `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { reconcileLegacyCodegraph } from './scripts/lib/codegraph-policy.mjs';
const fixture = fs.mkdtempSync(join(tmpdir(), 'ccua-primary-error-'));
const parent = join(fixture, '.vscode');
const outside = join(fixture, 'outside');
fs.mkdirSync(parent);
fs.mkdirSync(outside);
fs.writeFileSync(join(parent, 'mcp.json'),
  JSON.stringify({ servers: { codegraph: { command: 'codegraph', args: ['serve', '--mcp'] } } }));
const originalRename = fs.renameSync, originalUnlink = fs.unlinkSync;
let swapped = false;
fs.renameSync = (source, target) => {
  if (String(source).includes('/.ccua-reconcile-')) {
    originalRename(parent, parent + '-held');
    fs.symlinkSync(outside, parent, 'dir');
    swapped = true;
  }
  return originalRename(source, target);
};
fs.unlinkSync = path => {
  if (String(path).includes('/.ccua-reconcile-')) throw new Error('NON_SECRET_FIXTURE_CLEANUP_FAILURE');
  return originalUnlink(path);
};
syncBuiltinESMExports();
try {
  assert.throws(() => reconcileLegacyCodegraph(fixture), error => {
    assert.ok(error instanceof AggregateError);
    assert.match(error.errors[0].message, /Config published to held directory/);
    assert.ok(error.errors.some(item => /NON_SECRET_FIXTURE_CLEANUP_FAILURE/.test(item.message)));
    return true;
  });
  assert.equal(swapped, true);
  assert.deepEqual(fs.readdirSync(outside), []);
} finally {
  fs.renameSync = originalRename;
  fs.unlinkSync = originalUnlink;
  syncBuiltinESMExports();
  fs.rmSync(fixture, { recursive: true, force: true });
}
`]);
  });

for (const prefix of ['.claude', '.github']) {
  test(`${prefix} validates captured policy and preserves scoped source checks`, () => {
    run('python3', ['-B', '-c', `
import copy, difflib, hashlib, json, pathlib, sys, tempfile
sys.path.insert(0, str(pathlib.Path(${JSON.stringify(prefix)}) / "scripts"))
import normalize_uct as normalizer
import review_change_plan as review
policy = {"schemaVersion": 1, "roles": {}, "denied": [], "restricted": [], "commandEffects": []}
assert normalizer.validate_policy(policy) is policy
invalid = [None, {**policy, "schemaVersion": True}, {**policy, "roles": []},
    {**policy, "roles": {"developer": "app/code/.*"}},
    {**policy, "denied": ".*"}, {**policy, "restricted": [None]},
    {**policy, "commandEffects": [""]}, {**policy, "denied": ["["]}]
for bad in invalid:
    try:
        normalizer.validate_policy(bad)
    except ValueError as error:
        assert "invalid fixed policy" in str(error)
    else:
        raise AssertionError("malformed policy accepted")
with tempfile.TemporaryDirectory(prefix="ccua-policy-capture-") as fixture:
    root = pathlib.Path(fixture)
    (root / "source.php").write_text("NON_EXECUTED_FIXTURE")
    calls = []
    def capture():
        calls.append(True)
        return policy if len(calls) == 1 else {**policy, "denied": [".*"]}
    normalizer.load_source_policy = capture
    row = {"code": "MC-43", "type": "PLUGIN_INTERSECTION", "file": "source.php", "line": 1,
           "message": r"Method Magento\\Catalog\\Model\\Product::old() was removed"}
    report = {"errors": [row, dict(row)], "targetVersion": "2.4.8"}
    normalized, evidence = normalizer.normalize(report, root)
    assert normalized["counts"] == {"accepted": 2, "quarantined": 0, "total": 2}
    assert len(calls) == 1 and not normalized["blocked"] and evidence == []
    def unavailable():
        raise OSError("NON_SECRET_POLICY_FAILURE")
    normalizer.load_source_policy = unavailable
    try:
        normalizer.normalize(report, root)
    except OSError as error:
        assert str(error) == "NON_SECRET_POLICY_FAILURE"
    else:
        raise AssertionError("policy failure quarantined as an input row")
    directory = root / ".ccua/review"
    directory.mkdir(parents=True)
    encode = lambda value: json.dumps(value).encode()
    digest = lambda raw: hashlib.sha256(raw).hexdigest()
    for vendor_first in (True, False):
        denied = [r"vendor(?:/.*)?", r".*/auth\\.json"]
        if not vendor_first:
            denied.reverse()
        for kind in ("source", "uct"):
            ledger = {"schemaVersion": 1, "fromVersion": "2.4.7", "toVersion": "2.4.8",
                      "normalized": None, "normalizedSha256": None, "sources": []}
            if kind == "source":
                ledger["sources"] = [{"id": "BC-fixture", "reference": "vendor/magento/auth.json", "sha256": "0" * 64}]
            else:
                accepted = [{"id": 1, "file": "vendor/magento/auth.json", "line": 1, "code": row["code"],
                             "type": row["type"], "symbol": r"Magento\\Catalog\\Model\\Product::old", "severity": "error"}]
                raw = encode({"normalizerVersion": 1, "targetVersion": "2.4.8", "accepted": accepted,
                              "quarantine": [], "counts": {"accepted": 1, "quarantined": 0, "total": 1},
                              "blocked": False, "rawSha256": "0" * 64})
                (directory / "normalized.json").write_bytes(raw)
                ledger.update(normalized=".ccua/review/normalized.json", normalizedSha256=digest(raw))
            raw = encode(ledger)
            (directory / "evidence.json").write_bytes(raw)
            plan = {"evidence": ".ccua/review/evidence.json", "evidenceSha256": digest(raw),
                    "fromVersion": "2.4.7", "toVersion": "2.4.8"}
            try:
                review.evidence(root, plan, {**policy, "denied": denied})
            except ValueError:
                pass
            else:
                raise AssertionError("secret denied by position-dependent rules")
    before, after = b'BEFORE\\n', b'AFTER\\n'
    (directory / "source.before").write_bytes(before)
    (directory / "source.after").write_bytes(after)
    target = root / "scoped.json"
    target.write_bytes(before)
    review.scope = lambda *args: target
    review.evidence = lambda *args: (set(), {"BC-fixture"})
    diff = "".join(difflib.unified_diff(before.decode().splitlines(keepends=True),
        after.decode().splitlines(keepends=True), fromfile="a/target.json", tofile="b/target.json"))
    change = {"path": "target.json", "issue": {"kind": "source", "id": "BC-fixture"},
              "before": ".ccua/review/source.before", "after": ".ccua/review/source.after",
              "beforeSha256": digest(before), "afterSha256": digest(after),
              "diffSha256": digest(diff.encode()), "sensitive": False}
    plan = {"schemaVersion": 1, "agent": "developer", "kind": "patch", "environment": "fixture",
            "fromVersion": "2.4.7", "toVersion": "2.4.8", "hop": 1, "chunk": 1,
            "evidence": ".ccua/review/evidence.json", "evidenceSha256": "0" * 64, "changes": [change]}
    assert not (root / "target.json").exists()
    reviews, metadata, blockers, listing = review.check(root, policy, plan, "review", None, None)
    assert len(reviews) == len(metadata) == 1 and blockers == [] and listing is None
`]);
  });

  for (const phase of ['normal', 'directory-open', 'file-open', 'write', 'leaf-swap', 'short-write', 'no-progress', 'cleanup']) {
    test(`${prefix} audit ${phase} uses held directories and reports failures`, { skip: !anchored }, () => {
      run('python3', ['-B', '-c', `
import json, os, pathlib, sys, tempfile
sys.path.insert(0, str(pathlib.Path(${JSON.stringify(prefix)}) / "scripts"))
import review_change_plan as module
phase = ${JSON.stringify(phase)}
with tempfile.TemporaryDirectory(prefix="ccua-audit-anchor-") as fixture:
    root = pathlib.Path(fixture)
    parent, outside = root / ".ccua", root / "outside"
    outside.mkdir()
    sentinel = outside / "audit-log.jsonl"
    sentinel.write_bytes(b"OUTSIDE_SENTINEL")
    original_open, original_write, original_close, original_supports = os.open, os.write, os.close, os.supports_dir_fd
    injected, closed, writes = [False], [], []
    fd_directory = "/proc/self/fd" if os.path.isdir("/proc/self/fd") else "/dev/fd"
    before_fds = set(os.listdir(fd_directory))
    def swap():
        if not injected[0]:
            os.rename(parent, root / "held")
            parent.symlink_to(outside, target_is_directory=True)
            injected[0] = True
    def opened(path, flags, *args, **kwargs):
        descriptor = original_open(path, flags, *args, **kwargs)
        if phase == "directory-open" and str(path) == ".ccua":
            swap()
        elif phase == "file-open" and str(path) == "audit-log.jsonl":
            swap()
        return descriptor
    def written(descriptor, raw):
        if phase == "write":
            swap()
        elif phase == "leaf-swap" and not injected[0]:
            os.rename(parent / "audit-log.jsonl", parent / "held-log")
            (parent / "audit-log.jsonl").symlink_to(sentinel)
            injected[0] = True
        elif phase == "no-progress":
            injected[0] = True
            return 0
        elif phase == "short-write":
            injected[0] = True
            raw = raw[:7]
        writes.append(len(raw))
        return original_write(descriptor, raw)
    def close(descriptor):
        closed.append(descriptor)
        original_close(descriptor)
        if phase == "cleanup" and not injected[0]:
            injected[0] = True
            raise OSError("NON_SECRET_CLOSE_FAILURE")
    os.open, os.write, os.close = opened, written, close
    os.supports_dir_fd = original_supports | {opened}
    try:
        try:
            module.audit(root, {"schemaVersion": 1, "event": "fixture", "planSha256": "0" * 64})
        except (ValueError, OSError) as error:
            if phase in ("directory-open", "file-open"):
                assert "artifact directory changed" in str(error)
            elif phase in ("write", "leaf-swap"):
                assert "Audit appended to held directory" in str(error)
            elif phase == "no-progress":
                assert "made no progress" in str(error)
            elif phase == "cleanup":
                assert "cleanup failed" in str(error) and str(error.__cause__) == "NON_SECRET_CLOSE_FAILURE"
            else:
                raise
        else:
            assert phase in ("normal", "short-write"), "audit failure accepted"
    finally:
        os.open, os.write, os.close, os.supports_dir_fd = original_open, original_write, original_close, original_supports
    assert set(os.listdir(fd_directory)) == before_fds, "audit descriptor leaked"
    assert len(closed) == len(set(closed)) and closed
    assert sentinel.read_bytes() == b"OUTSIDE_SENTINEL"
    assert sorted(p.name for p in outside.iterdir()) == ["audit-log.jsonl"]
    if phase != "normal":
        assert injected[0], "injection did not run"
    if phase in ("normal", "short-write", "cleanup"):
        path = parent / "audit-log.jsonl"
        value = json.loads(path.read_bytes())
        assert value["event"] == "fixture" and "recordedAt" in value
        assert path.stat().st_mode & 0o777 == 0o600
        assert parent.stat().st_mode & 0o777 == 0o700
    if phase == "short-write":
        assert len(writes) > 1
    if phase in ("file-open", "no-progress"):
        log = (root / "held" if phase == "file-open" else parent) / "audit-log.jsonl"
        assert log.read_bytes() == b""
`]);
    });
  }
}
