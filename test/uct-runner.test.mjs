// Copyright 2026 Adobe. All rights reserved.
// Licensed under the Apache License, Version 2.0.
// https://www.apache.org/licenses/LICENSE-2.0
// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const OUT = '.github/context/.uct-capture-' + 'a'.repeat(32) + '/report.json';

function fixture(run) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'uct-runner-')));
  try {
    const project = join(dir, 'project'), uct = join(dir, 'uct'), bin = join(dir, 'bin');
    for (const path of [join(project, '.github/context'), join(uct, 'bin'), bin]) mkdirSync(path, { recursive: true });
    writeFileSync(join(uct, 'bin/uct'), '');
    writeFileSync(join(bin, 'docker'), `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/argv.txt"\nenv > "${dir}/env.txt"\n`);
    chmodSync(join(bin, 'docker'), 0o755);
    const call = (args, env = {}) => {
      const result = spawnSync('python3', ['-B', join(root, '.claude/scripts/uct_runner.py'),
        '--project-root', project, ...args], { cwd: project, encoding: 'utf8', timeout: 20000,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, COMPOSER_AUTH: 'secret', ...env } });
      let argv = null;
      try { argv = readFileSync(join(dir, 'argv.txt'), 'utf8').trim().split('\n'); } catch { /* not launched */ }
      return { result, argv };
    };
    run({ dir, project, uct, call });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('runner builds a hardened docker argv with a read-only project and writable context only', () => fixture(({ project, uct, call, dir }) => {
  const { result, argv } = call(['--image', 'ccua-uct-runner:php8.4', '--uct-path', uct, '--',
    'upgrade:check', '.', '--current-version=2.4.4-p9', '--coming-version=2.4.9',
    '--ignore-current-version-compatibility-issues', `--json-output-path=${OUT}`,
    '--min-issue-level=warning', '--no-interaction']);
  assert.equal(result.status, 0, result.stderr);
  const text = argv.join(' ');
  for (const flag of ['--network none', '--cap-drop ALL', 'no-new-privileges', '--read-only']) assert.ok(text.includes(flag), flag);
  assert.ok(argv.includes(`${project}:/app:ro`));
  assert.ok(argv.includes(`${uct}:/uct:ro`));
  assert.ok(argv.includes(`${project}/.github/context:/app/.github/context`));
  assert.equal(argv.filter(arg => arg.includes(':/app')).length, 2, 'only project (ro) and context are mounted under /app');
  assert.doesNotMatch(text, /\.composer|\.ssh|auth\.json|COMPOSER_AUTH/);
  assert.ok(!readFileSync(join(dir, 'env.txt'), 'utf8').includes('COMPOSER_AUTH'), 'credential env not forwarded');
  assert.equal(argv[argv.indexOf('ccua-uct-runner:php8.4') + 1], 'php');
}));

test('runner defaults the image and finds UCT under ~/.claude/tools/uct-standalone/<project name>', () => fixture(({ dir, project, call }) => {
  const home = join(dir, 'home');
  const defaultUct = join(home, '.claude/tools/uct-standalone', 'project');
  mkdirSync(join(defaultUct, 'bin'), { recursive: true });
  writeFileSync(join(defaultUct, 'bin/uct'), '');
  const { result, argv } = call(['--', '--version'], { HOME: home });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(argv.includes(`${defaultUct}:/uct:ro`));
  assert.ok(argv.includes('ccua-uct-runner:php8.4'));
  const aio = join(home, '.aio-ccua/tools/uct-standalone', 'project');
  mkdirSync(join(aio, 'bin'), { recursive: true });
  writeFileSync(join(aio, 'bin/uct'), '');
  assert.ok(call(['--', '--version'], { HOME: home }).argv.includes(`${aio}:/uct:ro`), '.aio-ccua is preferred when present');
  const missing = call(['--', '--version'], { HOME: join(dir, 'nohome') });
  assert.equal(missing.result.status, 1);
  assert.match(missing.result.stderr, /existing absolute non-symlink directory/);
}));

test('runner version probe mounts no writable context', () => fixture(({ project, uct, call }) => {
  const { result, argv } = call(['--image', 'ccua-uct-runner:php8.4', '--uct-path', uct, '--', '--version']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!argv.some(arg => arg.includes('/app/.github/context')));
}));

test('runner rejects unsafe images, paths and UCT arguments before launching docker', () => fixture(({ project, uct, call, dir }) => {
  symlinkSync(uct, join(dir, 'link'));
  mkdirSync(join(dir, '.composer/uct/bin'), { recursive: true });
  writeFileSync(join(dir, '.composer/uct/bin/uct'), '');
  const base = ['--image', 'ccua-uct-runner:php8.4', '--uct-path', uct, '--'];
  const cases = [
    [['--image', 'img --privileged', '--uct-path', uct, '--', '--version'], /image name/],
    [['--image', 'ccua-uct-runner:php8.4', '--uct-path', join(dir, 'link'), '--', '--version'], /symbolic|non-symlink/],
    [['--image', 'ccua-uct-runner:php8.4', '--uct-path', join(dir, '.composer/uct'), '--', '--version'], /credential/],
    [['--image', 'ccua-uct-runner:php8.4', '--uct-path', 'relative', '--', '--version'], /absolute/],
    [[...base, 'upgrade:check', '/etc'], /project root/],
    [[...base, 'upgrade:check', '.', '--coming-version=2.4.9; rm'], /digits/],
    [[...base, 'upgrade:check', '.', '--json-output-path=/tmp/x.json'], /private report path/],
    [[...base, 'upgrade:check', '.', '--html-output-path=x'], /HTML/],
    [[...base, 'upgrade:check', '.', '--output', 'x'], /unsupported/],
    [[...base, 'refactor', '.'], /only --version/],
    [[...base, 'sh', '-c', 'id'], /only --version/],
  ];
  for (const [args, pattern] of cases) {
    const { result, argv } = call(args);
    assert.equal(result.status, 1, args.join(' '));
    assert.match(result.stderr, pattern);
    assert.equal(argv, null, 'docker must not launch');
  }
}));

test('runner is mirrored exactly for both agent flavours', () => {
  assert.equal(readFileSync(join(root, '.claude/scripts/uct_runner.py'), 'utf8'),
    readFileSync(join(root, '.github/scripts/uct_runner.py'), 'utf8'));
});
