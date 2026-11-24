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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync,
  symlinkSync, linkSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const checkerScript = join(repoRoot, '.claude', 'scripts', 'check-encryption-changes.mjs');
const mirroredCheckerScript = join(repoRoot, '.github', 'scripts', 'check-encryption-changes.mjs');

const REDACTION_SENTINEL = '<redacted-test-value>';

function git(dir, args) {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'ccua-enc-test-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  mkdirSync(join(dir, 'app', 'code', 'Foo', 'Model'), { recursive: true });
  writeFileSync(join(dir, 'README.md'), 'init\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}

function runChecker(dir, args = [], script = checkerScript) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30000,
  });
  return result;
}

function parseJson(result) {
  return JSON.parse(result.stdout);
}

test('PR CI scans committed changes against the base and fails on missing base', () => {
  const workflow = readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
  const step = workflow.match(/      - name: Run encryption-safety checker[\s\S]*?        run: \|\n([\s\S]*?)(?=\n      - name:)/);
  assert.ok(step, 'encryption workflow step must be present');
  const command = step[1].replace(/^          /gm, '');

  for (const unsafe of [false, true]) {
    const dir = makeRepo();
    try {
      const base = git(dir, ['rev-parse', 'HEAD']).trim();
      mkdirSync(join(dir, '.claude', 'scripts'), { recursive: true });
      for (const file of ['check-encryption-changes.mjs', 'anchored-fs.mjs']) {
        writeFileSync(join(dir, '.claude', 'scripts', file),
          readFileSync(join(repoRoot, '.claude', 'scripts', file)));
      }
      writeFileSync(join(dir, 'app', 'code', 'Foo', 'Model', 'Changed.php'),
        unsafe ? '<?php openssl_encrypt($value, $cipher, $key);\n' : '<?php echo "safe";\n');
      git(dir, ['add', '-A']);
      git(dir, ['commit', '-q', '-m', 'test: PR scan']);
      const result = spawnSync('bash', ['-e', '-c', command], {
        cwd: dir,
        encoding: 'utf8',
        timeout: 30000,
        env: { ...process.env, PR_BASE_SHA: base },
      });
      assert.equal(result.status, unsafe ? 1 : 0, result.stdout + result.stderr);
      const out = parseJson(result);
      assert.equal(out.status, unsafe ? 'blocked' : 'ok');
      if (unsafe) {
        assert.ok(out.violations.some((v) => v.rule === 'ENC_DIRECT_CIPHER_CALL' && v.source === 'committed'));
      }
      for (const missingBase of ['', 'no-such-commit']) {
        const rejected = spawnSync('bash', ['-e', '-c', command], {
          cwd: dir, encoding: 'utf8', timeout: 30000,
          env: { ...process.env, PR_BASE_SHA: missingBase },
        });
        assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
        assert.match(rejected.stdout, /::error::/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('tracked vendor modifications are blocked by path without scanning scheduled baseline content', () => {
  const vendorPath = 'vendor/magento/framework/Encryption/Encryptor.php';
  for (const source of ['staged', 'worktree', 'committed']) {
    const dir = makeRepo();
    try {
      mkdirSync(join(dir, 'vendor', 'magento', 'framework', 'Encryption'), { recursive: true });
      writeFileSync(join(dir, vendorPath), '<?php openssl_encrypt($value, $cipher, $key);\n');
      git(dir, ['add', '-A']);
      git(dir, ['commit', '-q', '-m', 'test(fixture): add vendor source']);
      const base = git(dir, ['rev-parse', 'HEAD']).trim();
      writeFileSync(join(dir, vendorPath), '<?php return "changed";\n');
      if (source !== 'worktree') git(dir, ['add', '-A']);
      if (source === 'committed') git(dir, ['commit', '-q', '-m', 'test(fixture): change vendor source']);
      const args = source === 'committed' ? ['--base', base] : [];

      for (const script of [checkerScript, mirroredCheckerScript]) {
        const result = runChecker(dir, args, script);
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.ok(parseJson(result).violations.some((violation) =>
          violation.rule === 'ENC_VENDOR_MODIFICATION' &&
          violation.file === vendorPath &&
          violation.source === source));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('untracked vendor files are blocked without reading their contents', () => {
  const dir = makeRepo();
  try {
    const vendorPath = 'vendor/magento/framework/Encryption/Encryptor.php';
    mkdirSync(join(dir, 'vendor', 'magento', 'framework', 'Encryption'), { recursive: true });
    writeFileSync(join(dir, vendorPath), '<?php openssl_encrypt($value, $cipher, $key);\n');

    for (const script of [checkerScript, mirroredCheckerScript]) {
      const result = runChecker(dir, [], script);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.ok(parseJson(result).violations.some((violation) =>
        violation.rule === 'ENC_VENDOR_MODIFICATION' &&
        violation.file === vendorPath &&
        violation.source === 'untracked'));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scheduled baseline does not classify committed vendor paths as modifications', () => {
  const dir = makeRepo();
  try {
    const vendorPath = 'vendor/magento/framework/Encryption/Encryptor.php';
    mkdirSync(join(dir, 'vendor', 'magento', 'framework', 'Encryption'), { recursive: true });
    writeFileSync(join(dir, vendorPath), '<?php openssl_encrypt($value, $cipher, $key);\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'test(fixture): add vendor baseline']);

    for (const script of [checkerScript, mirroredCheckerScript]) {
      const result = runChecker(dir, ['--base', '4b825dc642cb6eb9a060e54bf8d69288fbee4904'], script);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.deepEqual(parseJson(result), { status: 'ok', violations: [] });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unsafe new PHP (direct cipher call) is blocked as untracked', () => {
  const dir = makeRepo();
  try {
    writeFileSync(
      join(dir, 'app', 'code', 'Foo', 'Model', 'Unsafe.php'),
      '<?php\nclass Unsafe {\n    public function go($v, $k) { return openssl_encrypt($v, "aes-256-cbc", $k); }\n}\n'
    );
    const result = runChecker(dir);
    assert.equal(result.status, 1);
    const out = parseJson(result);
    assert.equal(out.status, 'blocked');
    assert.ok(out.violations.some((v) => v.rule === 'ENC_DIRECT_CIPHER_CALL' && v.source === 'untracked'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('multiline cipher, password and key-generation calls are detected by both flavours', () => {
  const dir = makeRepo();
  try {
    const path = join(dir, 'app', 'code', 'Foo', 'Model', 'Multiline.php');
    const cases = [
      ['openssl_encrypt\n($value, $cipher, $key);', 'ENC_DIRECT_CIPHER_CALL'],
      ['OPENSSL_ENCRYPT($value, $cipher, $key);', 'ENC_DIRECT_CIPHER_CALL'],
      ['SoDiUm_CrYpTo_SeCrEtBoX_OpEn($value, $nonce, $key);', 'ENC_DIRECT_CIPHER_CALL'],
      ['HASH_PBKDF2($algorithm, $password, $salt, $iterations);', 'ENC_DIRECT_CIPHER_CALL'],
      ['sodium_crypto_secretbox_open\n($value, $nonce, $key);', 'ENC_DIRECT_CIPHER_CALL'],
      ['password_hash\n($password, PASSWORD_DEFAULT);', 'ENC_PASSWORD_HASH_OVERRIDE'],
      ['PaSsWoRd_HaSh($password, PASSWORD_DEFAULT);', 'ENC_PASSWORD_HASH_OVERRIDE'],
      ['PASSWORD_VERIFY($password, $hash);', 'ENC_PASSWORD_HASH_OVERRIDE'],
      ['CRYPT($password);', 'ENC_PASSWORD_HASH_OVERRIDE'],
      ['crypt\n($password);', 'ENC_PASSWORD_HASH_OVERRIDE'],
      ['md5\n(\n$password\n);', 'ENC_WEAK_PASSWORD_HASH'],
      ["md5($password . ';');", 'ENC_WEAK_PASSWORD_HASH'],
      ['sha1($password . ";");', 'ENC_WEAK_PASSWORD_HASH'],
      ['$this->encryptionKey =\nrandom_bytes\n(32);', 'ENC_KEY_MATERIAL_GENERATION'],
      ['$key = RANDOM_BYTES(32);', 'ENC_KEY_MATERIAL_GENERATION'],
    ];
    for (const [code, rule] of cases) {
      writeFileSync(path, `<?php\n${code}\n`);
      for (const script of [checkerScript, mirroredCheckerScript]) {
        const result = runChecker(dir, [], script);
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.ok(parseJson(result).violations.some((v) => v.rule === rule), rule);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('changing only the opening parenthesis line of a cipher call still triggers detection', () => {
  const dir = makeRepo();
  try {
    const path = join(dir, 'app', 'code', 'Foo', 'Model', 'Call.php');
    writeFileSync(path, '<?php\nopenssl_encrypt\n;\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'test(fixture): record non-call source']);
    writeFileSync(path, '<?php\nopenssl_encrypt\n($value, $cipher, $key);\n');
    const result = runChecker(dir);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.ok(parseJson(result).violations.some((v) => v.rule === 'ENC_DIRECT_CIPHER_CALL' && v.line === 2));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('custom hash and hash_hmac password hashing is blocked while cache and checksum hashing is allowed', () => {
  const dir = makeRepo();
  try {
    const path = join(dir, 'app', 'code', 'Foo', 'Model', 'Hashes.php');
    const unsafe = [
      "hash('sha256', $password);",
      "hash_hmac('sha256', $password, $key);",
      "hash_hmac('sha256', trim($payload), $password);",
      "HASH\n('sha256', $this->password);",
      "hash('sha256', $credentials['password']);",
      "md5($_POST['pass']);",
      "hash('sha256', $credentials->getPassword());",
      "hash('sha256', trim($pass));",
    ];
    for (const code of unsafe) {
      writeFileSync(path, `<?php\n${code}\n`);
      for (const script of [checkerScript, mirroredCheckerScript]) {
        const result = runChecker(dir, [], script);
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.ok(parseJson(result).violations.some((v) => v.rule === 'ENC_WEAK_PASSWORD_HASH'));
      }
    }
    writeFileSync(path, [
      '<?php',
      "hash('sha256', $cacheKey);",
      "hash_hmac('sha256', trim($payload), $checksumKey);",
      "md5($bypassCache);",
      "hash('sha256', '/password-reset/cache');",
      "hash('sha256', trim(';()') /* ) */);",
      "$label = 'hash(';",
      '// hash($password',
      '/* hash_hmac($password */',
      '',
    ].join('\n'));
    for (const script of [checkerScript, mirroredCheckerScript]) {
      const result = runChecker(dir, [], script);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('HTML quotes and comments cannot hide password hashing inside PHTML PHP regions', () => {
  const dir = makeRepo();
  try {
    const path = join(dir, 'app', 'code', 'Foo', 'Model', 'Template.phtml');
    const unsafe = [
      "<p>Customer's account</p>\n<?php echo md5($password); ?>",
      '<div title="hash(">Account</div>\n<?= hash("sha256", $password) ?>',
      "<?php // template header ?>\n<p>Customer's account</p>\n<?= hash_hmac('sha256', $password, $key) ?>",
      "<?php $label = 'account'; ?>\n<p>Customer's account</p>\n<?php echo sha1($password); ?>",
    ];
    for (const code of unsafe) {
      writeFileSync(path, code);
      for (const script of [checkerScript, mirroredCheckerScript]) {
        const result = runChecker(dir, [], script);
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.ok(parseJson(result).violations.some((v) => v.rule === 'ENC_WEAK_PASSWORD_HASH'));
      }
    }
    writeFileSync(path, "<p>Customer's md5($password) documentation</p>\n<?php $label = 'hash('; ?>\n<?= hash('sha256', $cacheKey) ?>");
    const result = runChecker(dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('native encryptor hash consumer and names in comments or strings are allowed', () => {
  const dir = makeRepo();
  try {
    writeFileSync(
      join(dir, 'app', 'code', 'Foo', 'Model', 'Safe.php'),
      [
        '<?php',
        'namespace Foo\\Model;',
        '// Do not use openssl_encrypt() or password_hash() here.',
        '/* openssl_decrypt( is forbidden */',
        'class Safe',
        '{',
        '    private $note = "never call openssl_encrypt(";',
        '    public function go($password) { return $this->encryptor->hash($password); }',
        '}',
        '',
      ].join('\n')
    );
    const result = runChecker(dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ordinary EncryptorInterface consumer is allowed', () => {
  const dir = makeRepo();
  try {
    writeFileSync(
      join(dir, 'app', 'code', 'Foo', 'Model', 'Safe.php'),
      [
        '<?php',
        'namespace Foo\\Model;',
        'use Magento\\Framework\\Encryption\\EncryptorInterface;',
        'class Safe',
        '{',
        '    private EncryptorInterface $encryptor;',
        '    public function __construct(EncryptorInterface $encryptor) { $this->encryptor = $encryptor; }',
        '    public function go($v) { return $this->encryptor->encrypt($v); }',
        '}',
        '',
      ].join('\n')
    );
    const result = runChecker(dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(parseJson(result).status, 'ok');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unrelated change to a file with preexisting weak hashing does not flag the untouched line', () => {
  const dir = makeRepo();
  try {
    const legacyPath = join(dir, 'app', 'code', 'Foo', 'Model', 'Legacy.php');
    writeFileSync(legacyPath, '<?php\nclass Legacy {\n    public function hashPassword($password) { return md5($password); }\n}\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'add legacy file with preexisting weak hash']);

    // Touch an unrelated line only — the preexisting md5($password) line is never a
    // newly-added line in this diff and must not be flagged.
    writeFileSync(legacyPath, '<?php\nclass Legacy {\n    public function hashPassword($password) { return md5($password); }\n    // unrelated comment\n}\n');
    const result = runChecker(dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(parseJson(result).status, 'ok');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a staged violation is still detected when the working tree copy is reverted to something safe', () => {
  const dir = makeRepo();
  try {
    const target = join(dir, 'app', 'code', 'Foo', 'Model', 'Reverse.php');
    writeFileSync(target, '<?php\nclass Reverse { public function go($p) { return crypt($p); }\n}\n');
    git(dir, ['add', '-A']);

    // Working tree now differs from the staged (unsafe) version and is itself safe —
    // the staged violation must still surface, not be hidden by the worktree state.
    writeFileSync(target, '<?php\nclass Reverse { public function go($p) { return "noop"; }\n}\n');

    const result = runChecker(dir);
    assert.equal(result.status, 1);
    const out = parseJson(result);
    assert.ok(out.violations.some((v) => v.rule === 'ENC_PASSWORD_HASH_OVERRIDE' && v.source === 'staged'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reverse: a worktree violation is detected even when the staged version is safe', () => {
  const dir = makeRepo();
  try {
    const target = join(dir, 'app', 'code', 'Foo', 'Model', 'Reverse.php');
    writeFileSync(target, '<?php\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'add safe stub']);

    writeFileSync(target, '<?php\nclass Reverse { public function go($p) { return crypt($p); }\n}\n');

    const result = runChecker(dir);
    assert.equal(result.status, 1);
    const out = parseJson(result);
    assert.ok(out.violations.some((v) => v.rule === 'ENC_PASSWORD_HASH_OVERRIDE' && v.source === 'worktree'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a committed change on a branch is detected with --base pointing at the parent branch', () => {
  const dir = makeRepo();
  try {
    git(dir, ['config', 'color.ui', 'always']);
    git(dir, ['checkout', '-q', '-b', 'feature']);
    writeFileSync(
      join(dir, 'app', 'code', 'Foo', 'Model', 'Bad.php'),
      '<?php\nclass Bad { public function go($v, $k) { return openssl_decrypt($v, "aes-256-cbc", $k); } }\n'
    );
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'add bad file']);

    const withBase = runChecker(dir, ['--base', 'main']);
    assert.equal(withBase.status, 1);
    assert.ok(parseJson(withBase).violations.some((v) => v.rule === 'ENC_DIRECT_CIPHER_CALL' && v.source === 'committed'));

    // Without --base, committed history is out of scope — nothing is staged/dirty/untracked.
    const withoutBase = runChecker(dir);
    assert.equal(withoutBase.status, 0);
    assert.equal(parseJson(withoutBase).status, 'ok');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('untracked unsafe files are detected including brand-new files', () => {
  const dir = makeRepo();
  try {
    writeFileSync(
      join(dir, 'app', 'code', 'Foo', 'Model', 'NewFile.php'),
      '<?php\nclass NewFile { public function go($p) { return password_hash($p, PASSWORD_DEFAULT); } }\n'
    );
    const result = runChecker(dir);
    assert.equal(result.status, 1);
    const out = parseJson(result);
    assert.ok(out.violations.some((v) => v.rule === 'ENC_PASSWORD_HASH_OVERRIDE' && v.source === 'untracked'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a multiline/aliased Encryptor di.xml preference is blocked', () => {
  const dir = makeRepo();
  try {
    mkdirSync(join(dir, 'app', 'code', 'Foo', 'etc'), { recursive: true });
    const diPath = join(dir, 'app', 'code', 'Foo', 'etc', 'di.xml');
    writeFileSync(diPath, '<?xml version="1.0"?>\n<config><preference for="X" type="Y"/></config>\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'add benign di.xml']);

    writeFileSync(
      diPath,
      [
        '<?xml version="1.0"?>',
        '<config>',
        '    <preference',
        '        for="Magento\\Framework\\Encryption\\EncryptorInterface"',
        '        type="Foo\\Model\\CustomEncryptor" />',
        '</config>',
        '',
      ].join('\n')
    );
    const result = runChecker(dir);
    assert.equal(result.status, 1);
    const out = parseJson(result);
    assert.ok(out.violations.some((v) => v.rule === 'ENC_ENCRYPTOR_DI_OVERRIDE'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('native whole env.php addition is blocked', () => {
  const dir = makeRepo();
  try {
    mkdirSync(join(dir, 'app', 'etc'), { recursive: true });
    writeFileSync(
      join(dir, 'app', 'etc', 'env.php'),
      `<?php\nreturn [\n    'crypt' => [\n        'key' => '${REDACTION_SENTINEL}',\n    ],\n];\n`
    );
    const result = runChecker(dir);
    assert.equal(result.status, 1);
    const out = parseJson(result);
    assert.ok(out.violations.some((v) => v.rule === 'ENC_ENV_CRYPT_KEY_CHANGE'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const source of ['untracked', 'staged', 'committed']) {
  test(`an empty new env.php is blocked in the ${source} scan`, () => {
    const dir = makeRepo();
    try {
      const path = 'app/etc/env.php';
      mkdirSync(join(dir, 'app', 'etc'), { recursive: true });
      const base = git(dir, ['rev-parse', 'HEAD']).trim();
      writeFileSync(join(dir, path), '');
      if (source !== 'untracked') git(dir, ['add', path]);
      if (source === 'committed') git(dir, ['commit', '-q', '-m', 'test(fixture): record empty configuration']);
      const args = source === 'committed' ? ['--base', base] : [];
      for (const script of [checkerScript, mirroredCheckerScript]) {
        const result = runChecker(dir, args, script);
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.ok(parseJson(result).violations.some((v) =>
          v.rule === 'ENC_ENV_CRYPT_KEY_CHANGE' && v.source === source && v.file === path));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('renaming an empty source into env.php is blocked', () => {
  const dir = makeRepo();
  try {
    mkdirSync(join(dir, 'app', 'etc'), { recursive: true });
    writeFileSync(join(dir, 'app', 'etc', 'empty.php'), '');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'test(fixture): record empty source']);
    git(dir, ['mv', 'app/etc/empty.php', 'app/etc/env.php']);
    const result = runChecker(dir);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.ok(parseJson(result).violations.some((v) => v.rule === 'ENC_ENV_CRYPT_KEY_CHANGE'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('empty-tree base scans committed additions instead of failing to resolve a commit', () => {
  const dir = makeRepo();
  try {
    writeFileSync(join(dir, 'app', 'code', 'Foo', 'Model', 'Unsafe.php'),
      '<?php\nreturn openssl_encrypt($value, $cipher, $key);\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'add unsafe cipher']);
    const result = runChecker(dir, ['--base', '4b825dc642cb6eb9a060e54bf8d69288fbee4904']);
    assert.equal(result.status, 1, result.stderr);
    assert.ok(parseJson(result).violations.some((v) => v.source === 'committed'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Encryptor DI overrides are blocked regardless of attribute order or quoting', () => {
  const dir = makeRepo();
  try {
    const path = join(dir, 'app', 'code', 'Foo', 'etc', 'di.xml');
    mkdirSync(join(dir, 'app', 'code', 'Foo', 'etc'), { recursive: true });
    const declarations = [
      '<preference type="Foo\\Model\\Custom" for="Magento\\Framework\\Encryption\\EncryptorInterface"/>',
      "<preference type='Foo\\Model\\Custom'\n for='Magento\\Framework\\Encryption\\Encryptor'/>",
      '<virtualType type="Magento\\Framework\\Encryption\\Encryptor" name="Alias"/>',
      "<type name='Magento\\Framework\\Encryption\\Encryptor'><plugin type='Foo\\Plugin' name='custom'/></type>",
      '<preference for="\\Magento\\Framework\\Encryption\\EncryptorInterface" type="Foo\\Model\\Custom"/>',
    ];
    for (const declaration of declarations) {
      writeFileSync(path, `<config>${declaration}</config>\n`);
      for (const script of [checkerScript, mirroredCheckerScript]) {
        const result = runChecker(dir, [], script);
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.ok(parseJson(result).violations.some((v) => v.rule === 'ENC_ENCRYPTOR_DI_OVERRIDE'));
      }
    }
    for (const declaration of [
      '<preference for="Foo\\Api\\EncryptorInterface" type="Foo\\Model\\Encryptor"/>',
      '<virtualType type="Foo\\Crypto\\Encryptor" name="Alias"/>',
      '<type name="Foo\\Crypto\\Encryptor"><plugin type="Foo\\Plugin" name="custom"/></type>',
      '<type name="Magento\\Framework\\Encryption\\Encryptor"><arguments/></type>',
    ]) {
      writeFileSync(path, `<config>${declaration}</config>\n`);
      for (const script of [checkerScript, mirroredCheckerScript]) {
        const result = runChecker(dir, [], script);
        assert.equal(result.status, 0, result.stdout + result.stderr);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Encryptor inheritance and implementation through ordinary PHP import aliases are blocked', () => {
  const dir = makeRepo();
  try {
    const path = join(dir, 'app', 'code', 'Foo', 'Model', 'Alias.php');
    const blocked = [
      ...[['EncryptorInterface', 'implements'], ['Encryptor', 'extends']].map(([type, keyword]) =>
        `use Magento\\Framework\\Encryption\\${type} as CryptoContract; class Custom ${keyword} CryptoContract {}`),
      'use Magento\\Framework\\Encryption\\EncryptorInterface as Contract, Foo\\Bar; class Custom implements Contract {}',
      'use Foo\\Bar, Magento\\Framework\\Encryption\\EncryptorInterface as Contract; class Custom implements Contract {}',
    ];
    for (const code of blocked) {
      writeFileSync(path, `<?php\n${code}\n`);
      for (const script of [checkerScript, mirroredCheckerScript]) {
        const result = runChecker(dir, [], script);
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.ok(parseJson(result).violations.some((v) => v.rule === 'ENC_ENCRYPTOR_IMPLEMENTATION'));
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('only resolved Magento Encryptor types are blocked, not module-local names', () => {
  const dir = makeRepo();
  try {
    const path = join(dir, 'app', 'code', 'Foo', 'Model', 'Types.php');
    const allowed = [
      'namespace Foo; interface EncryptorInterface {} class Adapter implements EncryptorInterface {}',
      'namespace Foo; class Encryptor {} class Adapter extends Encryptor {}',
      'interface EncryptorInterface {} class Adapter implements EncryptorInterface {}',
      'namespace Foo; use Foo\\Api\\EncryptorInterface as Contract; class Adapter implements Contract {}',
      'namespace Foo; use Foo\\Api\\{EncryptorInterface as Contract, Encryptor}; class Adapter implements Contract {}',
      'use function Magento\\Framework\\Encryption\\EncryptorInterface as Contract; class Adapter implements Contract {}',
      'use const Magento\\Framework\\Encryption\\EncryptorInterface as Contract; class Adapter implements Contract {}',
      'class Earlier { use Magento\\Framework\\Encryption\\EncryptorInterface; } class Adapter implements EncryptorInterface {}',
      'namespace Foo; interface EncryptorInterface {} $adapter = new class implements EncryptorInterface {};',
      'namespace First { use Magento\\Framework\\Encryption\\EncryptorInterface; class Consumer {} }\n' +
        'namespace Second { interface EncryptorInterface {} class Adapter implements EncryptorInterface {} }',
    ];
    const blocked = [
      'namespace Foo; class Adapter implements \\Magento\\Framework\\Encryption\\EncryptorInterface {}',
      'namespace Foo; class Adapter extends \\Magento\\Framework\\Encryption\\Encryptor {}',
      'namespace Foo; use Magento\\Framework\\Encryption\\EncryptorInterface; class Adapter implements EncryptorInterface {}',
      'namespace Foo; use Magento\\Framework\\Encryption as Crypto; class Adapter implements Crypto\\EncryptorInterface {}',
      'namespace Magento\\Framework\\Encryption; class Adapter implements EncryptorInterface {}',
      'namespace Foo; use Magento\\Framework\\Encryption\\{Encryptor, EncryptorInterface}; class Adapter implements EncryptorInterface {}',
      'namespace Foo; use Magento\\Framework\\Encryption\\{Encryptor as Base, EncryptorInterface as Contract}; class Adapter extends Base implements Contract {}',
      '$adapter = new class implements \\Magento\\Framework\\Encryption\\EncryptorInterface {};',
      'namespace Foo; use Magento\\Framework\\Encryption\\EncryptorInterface; $adapter = new class($value) implements EncryptorInterface {};',
      'NaMeSpAcE Magento\\Framework\\Encryption; $adapter = NeW ClAsS ImPlEmEnTs EncryptorInterface {};',
      'use Magento\\Framework\\Encryption\\Encryptor as Base; $adapter = new class extends Base {};',
      'namespace Foo; CLASS Adapter EXTENDS \\Magento\\Framework\\Encryption\\Encryptor {}',
    ];
    for (const code of allowed) {
      writeFileSync(path, `<?php\n${code}\n`);
      for (const script of [checkerScript, mirroredCheckerScript]) {
        const result = runChecker(dir, [], script);
        assert.equal(result.status, 0, result.stdout + result.stderr);
      }
    }
    for (const code of blocked) {
      writeFileSync(path, `<?php\n${code}\n`);
      for (const script of [checkerScript, mirroredCheckerScript]) {
        const result = runChecker(dir, [], script);
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.ok(parseJson(result).violations.some((v) => v.rule === 'ENC_ENCRYPTOR_IMPLEMENTATION'));
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('key generation in instance and static properties is blocked without blocking random cache IDs', () => {
  const dir = makeRepo();
  try {
    const path = join(dir, 'app', 'code', 'Foo', 'Model', 'Generator.php');
    for (const target of ['$this->key', 'self::$key', '$encryptionKey', '$cryptoIV', '$secret_key', '$nonce', '$salt', '$keys', '$salts', '$secretkey', '$masterkey', '$apikeys']) {
      writeFileSync(path, `<?php\n${target} = random_bytes(32);\n`);
      const result = runChecker(dir);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.ok(parseJson(result).violations.some((v) => v.rule === 'ENC_KEY_MATERIAL_GENERATION'));
    }
    writeFileSync(path, [
      '<?php',
      '$cacheId = random_int(1, 1000);',
      '$deliveryId = random_int(1, 1000);',
      '$activityId = random_int(1, 1000);',
      '$this->deliveryId = random_bytes(16);',
      'self::$activityId = random_bytes(16);',
      '$keyboardId = random_int(1, 1000);',
      '$saltwaterId = random_int(1, 1000);',
      '',
    ].join('\n'));
    assert.equal(runChecker(dir).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const source of ['staged', 'committed']) {
  test(`a path-only ${source} rename does not flag untouched legacy crypto`, () => {
    const dir = makeRepo();
    try {
      const oldPath = 'app/code/Foo/Model/Legacy.php';
      const newPath = 'app/code/Foo/Model/Renamed.php';
      writeFileSync(join(dir, oldPath), '<?php\nreturn md5($password);\n');
      git(dir, ['add', '-A']);
      git(dir, ['commit', '-q', '-m', 'test(fixture): record legacy crypto']);
      const base = git(dir, ['rev-parse', 'HEAD']).trim();
      git(dir, ['config', 'diff.renames', 'false']);
      git(dir, ['mv', oldPath, newPath]);
      if (source === 'committed') git(dir, ['commit', '-q', '-m', 'test(fixture): rename legacy source']);
      const args = source === 'committed' ? ['--base', base] : [];
      const result = runChecker(dir, args);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('a renamed file still flags newly added unsafe crypto without flagging unchanged legacy code', () => {
  const dir = makeRepo();
  try {
    const oldPath = 'app/code/Foo/Model/Legacy.php';
    const newPath = 'app/code/Foo/Model/Renamed.php';
    const original = '<?php\nclass Legacy {\n    public function legacy($password) { return md5($password); }\n}\n';
    writeFileSync(join(dir, oldPath), original);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'test(fixture): record legacy crypto']);
    git(dir, ['mv', oldPath, newPath]);
    writeFileSync(join(dir, newPath), original + 'openssl_encrypt($value, $cipher, $key);\n');
    git(dir, ['add', '-A']);
    const result = runChecker(dir);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const violations = parseJson(result).violations;
    assert.ok(violations.some((v) => v.rule === 'ENC_DIRECT_CIPHER_CALL' && v.file === newPath));
    assert.ok(!violations.some((v) => v.rule === 'ENC_WEAK_PASSWORD_HASH'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const source of ['staged', 'worktree', 'committed']) {
  test(`binary attributes cannot hide unsafe PHP or DI XML in the ${source} scan`, () => {
    const dir = makeRepo();
    try {
      const phpPath = 'app/code/Foo/Model/Binary.php';
      const xmlPath = 'app/code/Foo/etc/di.xml';
      mkdirSync(join(dir, 'app', 'code', 'Foo', 'etc'), { recursive: true });
      writeFileSync(join(dir, phpPath), '<?php\nreturn "safe";\n');
      writeFileSync(join(dir, xmlPath), '<config/>\n');
      writeFileSync(join(dir, '.gitattributes'), '*.php -diff\n*.xml -diff\n');
      git(dir, ['add', '-A']);
      git(dir, ['commit', '-q', '-m', 'test(fixture): record binary attributes']);
      const base = git(dir, ['rev-parse', 'HEAD']).trim();
      writeFileSync(join(dir, phpPath), '<?php\nreturn md5($password);\n');
      writeFileSync(join(dir, xmlPath),
        '<config><preference for="Magento\\Framework\\Encryption\\EncryptorInterface" type="Foo\\Model\\Custom"/></config>\n');
      if (source !== 'worktree') git(dir, ['add', '-A']);
      if (source === 'committed') git(dir, ['commit', '-q', '-m', 'test(fixture): record unsafe crypto']);
      const args = source === 'committed' ? ['--base', base] : [];
      const result = runChecker(dir, args);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      const violations = parseJson(result).violations;
      assert.ok(violations.some((v) => v.rule === 'ENC_WEAK_PASSWORD_HASH' && v.source === source));
      assert.ok(violations.some((v) => v.rule === 'ENC_ENCRYPTOR_DI_OVERRIDE' && v.source === source));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('changes to quoted or array-form tracked crypt keys are blocked without exposing values', () => {
  const dir = makeRepo();
  try {
    const path = join(dir, 'app', 'etc', 'env.php');
    mkdirSync(join(dir, 'app', 'etc'), { recursive: true });
    writeFileSync(path, '<?php\nreturn ["crypt" => ["key" => [\n    "<redacted>",\n]]];\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'add test key configuration']);
    writeFileSync(path, `<?php\nreturn ["crypt" => ["key" => [\n    "${REDACTION_SENTINEL}",\n]]];\n`);
    const result = runChecker(dir);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.ok(parseJson(result).violations.some((v) => v.rule === 'ENC_ENV_CRYPT_KEY_CHANGE'));
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(REDACTION_SENTINEL));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('normal gitignored runtime env.php remains outside the diff checker scope', () => {
  const dir = makeRepo();
  try {
    mkdirSync(join(dir, 'app', 'etc'), { recursive: true });
    writeFileSync(join(dir, '.gitignore'), '/app/etc/env.php\n');
    writeFileSync(join(dir, 'app', 'etc', 'env.php'),
      `<?php\nreturn ["crypt" => ["key" => "${REDACTION_SENTINEL}"]];\n`);
    const result = runChecker(dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(REDACTION_SENTINEL));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const source of ['staged', 'worktree', 'committed']) {
  test(`all tracked env.php touches are blocked path-only in the ${source} scan`, () => {
    for (const change of ['delete', 'remove-key', 'non-key-edit', 'rename-away']) {
      const dir = makeRepo();
      try {
        const path = 'app/etc/env.php';
        mkdirSync(join(dir, 'app', 'etc'), { recursive: true });
        const original = `<?php return ["crypt" => ["key" => "${REDACTION_SENTINEL}"], "label" => "before"];\n`;
        writeFileSync(join(dir, path), original);
        git(dir, ['add', '-A']);
        git(dir, ['commit', '-q', '-m', 'test(fixture): record redacted configuration']);
        const base = git(dir, ['rev-parse', 'HEAD']).trim();
        assert.equal(runChecker(dir).status, 0, 'untouched configuration is out of scope');
        if (change === 'delete') unlinkSync(join(dir, path));
        else if (change === 'rename-away') renameSync(join(dir, path), join(dir, 'app', 'etc', 'config.txt'));
        else writeFileSync(join(dir, path),
          change === 'remove-key' ? '<?php return [];\n' : original.replace('"before"', '"after"'));
        if (source !== 'worktree') git(dir, ['add', '-A']);
        if (source === 'committed') git(dir, ['commit', '-q', '-m', 'test(fixture): change protected path']);
        for (const script of [checkerScript, mirroredCheckerScript]) {
          const result = runChecker(dir, source === 'committed' ? ['--base', base] : [], script);
          assert.equal(result.status, 1, result.stdout + result.stderr);
          assert.ok(parseJson(result).violations.some((v) =>
            v.rule === 'ENC_ENV_CRYPT_KEY_CHANGE' && v.file === path && v.source === source));
          assert.doesNotMatch(result.stdout + result.stderr, new RegExp(REDACTION_SENTINEL));
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
}

test('untracked env.php is blocked before attempting to follow a symlink', () => {
  const dir = makeRepo();
  try {
    mkdirSync(join(dir, 'app', 'etc'), { recursive: true });
    symlinkSync(join(dir, 'README.md'), join(dir, 'app', 'etc', 'env.php'));
    for (const script of [checkerScript, mirroredCheckerScript]) {
      const result = runChecker(dir, [], script);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.ok(parseJson(result).violations.some((v) => v.rule === 'ENC_ENV_CRYPT_KEY_CHANGE'));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a conflicted relevant file fails closed before source scanning', () => {
  const dir = makeRepo();
  try {
    const path = 'app/code/Foo/Model/Conflict.php';
    writeFileSync(join(dir, path), '<?php return "base";\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'test(fixture): record conflict base']);
    git(dir, ['checkout', '-q', '-b', 'topic']);
    writeFileSync(join(dir, path), '<?php return "topic";\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'test(fixture): topic edit']);
    git(dir, ['checkout', '-q', 'main']);
    writeFileSync(join(dir, path), '<?php return "main";\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'test(fixture): main edit']);
    const merge = spawnSync('git', ['merge', 'topic'], { cwd: dir, encoding: 'utf8' });
    assert.equal(merge.status, 1);
    for (const script of [checkerScript, mirroredCheckerScript]) {
      const result = runChecker(dir, [], script);
      assert.equal(result.status, 2, result.stdout + result.stderr);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /Resolve unmerged source files/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('source symlinks fail closed in every scan source without exposing outside contents', () => {
  for (const source of ['untracked', 'worktree', 'staged', 'committed']) {
    const dir = makeRepo();
    const outside = mkdtempSync(join(tmpdir(), 'ccua-enc-outside-'));
    try {
      const path = 'app/code/Foo/Model/Linked.php';
      writeFileSync(join(outside, 'target.php'), `<?php echo "${REDACTION_SENTINEL}";\n`);
      const base = git(dir, ['rev-parse', 'HEAD']).trim();
      if (source === 'worktree') {
        writeFileSync(join(dir, path), '<?php return "safe";\n');
        git(dir, ['add', '-A']);
        git(dir, ['commit', '-q', '-m', 'test(fixture): regular source']);
        unlinkSync(join(dir, path));
      }
      symlinkSync(join(outside, 'target.php'), join(dir, path));
      if (source === 'staged' || source === 'committed') git(dir, ['add', '-A']);
      if (source === 'committed') git(dir, ['commit', '-q', '-m', 'test(fixture): linked source']);
      for (const script of [checkerScript, mirroredCheckerScript]) {
        const result = runChecker(dir, source === 'committed' ? ['--base', base] : [], script);
        assert.equal(result.status, 2, result.stdout + result.stderr);
        assert.equal(result.stdout, '');
        assert.doesNotMatch(result.stderr, new RegExp(REDACTION_SENTINEL));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  }
});

test('a hardlinked working source fails closed before reading its content', () => {
  const dir = makeRepo();
  try {
    writeFileSync(join(dir, 'source.txt'), REDACTION_SENTINEL);
    linkSync(join(dir, 'source.txt'), join(dir, 'app', 'code', 'Foo', 'Model', 'Hardlink.php'));
    for (const script of [checkerScript, mirroredCheckerScript]) {
      const result = runChecker(dir, [], script);
      assert.equal(result.status, 2, result.stdout + result.stderr);
      assert.doesNotMatch(result.stdout + result.stderr, new RegExp(REDACTION_SENTINEL));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an ancestor swapped during source opening cannot redirect the read outside the repo',
  { skip: !['linux', 'darwin'].includes(process.platform) ? 'Linux procfs or macOS volfs descriptor protections required' : false }, () => {
    for (const script of [checkerScript, mirroredCheckerScript]) {
      const dir = makeRepo();
      const outside = mkdtempSync(join(tmpdir(), 'ccua-enc-outside-'));
      try {
        const parent = join(dir, 'app', 'code', 'Foo', 'Model');
        writeFileSync(join(parent, 'Race.php'), '<?php return "safe";\n');
        writeFileSync(join(outside, 'Race.php'), REDACTION_SENTINEL);
        const swapped = join(dir, 'swapped.txt');
        const openedOutside = join(dir, 'outside-opened.txt');
        const preload = join(dir, 'race-preload.cjs');
        writeFileSync(preload, `
const fs = require('node:fs');
const original = fs.openSync;
const outsideFile = fs.statSync(${JSON.stringify(join(outside, 'Race.php'))});
let swapped = false;
fs.openSync = function(file, ...args) {
  if (!swapped && /^\\/(?:proc\\/self\\/fd|\\.vol)\\//.test(String(file)) && String(file).endsWith('/Race.php')) {
    swapped = true;
    fs.renameSync(${JSON.stringify(parent)}, ${JSON.stringify(join(dir, 'held-model'))});
    fs.symlinkSync(${JSON.stringify(outside)}, ${JSON.stringify(parent)});
    fs.writeFileSync(${JSON.stringify(swapped)}, 'swapped');
  }
  const descriptor = original(file, ...args);
  const opened = fs.fstatSync(descriptor);
  if (opened.dev === outsideFile.dev && opened.ino === outsideFile.ino) {
    fs.writeFileSync(${JSON.stringify(openedOutside)}, 'outside descriptor opened');
  }
  return descriptor;
};
require('node:module').syncBuiltinESMExports();
`);
        const result = spawnSync(process.execPath, ['--require', preload, script], {
          cwd: dir, encoding: 'utf8', timeout: 30000,
        });
        assert.equal(result.status, 2, result.stdout + result.stderr);
        assert.ok(existsSync(swapped), 'the ancestor swap must actually occur');
        assert.equal(existsSync(openedOutside), false, 'no outside descriptor may be opened');
        assert.doesNotMatch(result.stdout + result.stderr, new RegExp(REDACTION_SENTINEL));
      } finally {
        rmSync(dir, { recursive: true, force: true });
        rmSync(outside, { recursive: true, force: true });
      }
    }
  });

test('a missing safe-reader dependency fails with the sanitized exit-2 contract', () => {
  const dir = makeRepo();
  try {
    const isolated = join(dir, 'isolated-checker.mjs');
    writeFileSync(isolated, readFileSync(checkerScript));
    const result = runChecker(dir, [], isolated);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Unable to load the safe source reader/);
    assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND|file:\/\//);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('option-shaped base references and unsupported arguments fail closed without echoing arguments', () => {
  const dir = makeRepo();
  try {
    for (const args of [['--base', '--fork-point'], ['--base='], [REDACTION_SENTINEL]]) {
      const result = runChecker(dir, args);
      assert.equal(result.status, 2);
      assert.equal(result.stdout, '');
      assert.doesNotMatch(result.stderr, new RegExp(REDACTION_SENTINEL));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('invalid --base reference fails closed with a sanitized message, no git stderr', () => {
  const dir = makeRepo();
  try {
    const result = spawnSync(process.execPath, [checkerScript, '--base', 'this-ref-does-not-exist'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Invalid or unresolvable --base reference/);
    assert.doesNotMatch(result.stderr, /fatal:/);
    assert.doesNotMatch(result.stderr, /not a valid object name/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('running outside a git repository fails closed with a sanitized message, no git stderr', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccua-enc-notrepo-'));
  try {
    const result = spawnSync(process.execPath, [checkerScript], { cwd: dir, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Not a git repository/);
    assert.doesNotMatch(result.stderr, /fatal:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unsupported CLI argument fails closed rather than silently ignoring it', () => {
  const dir = makeRepo();
  try {
    const result = runChecker(dir, ['--does-not-exist']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Unsupported arguments/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('diagnostics never contain the redaction sentinel or any matched source text', () => {
  const dir = makeRepo();
  try {
    mkdirSync(join(dir, 'app', 'etc'), { recursive: true });
    writeFileSync(
      join(dir, 'app', 'etc', 'env.php'),
      `<?php\nreturn [\n    'crypt' => [\n        'key' => '${REDACTION_SENTINEL}',\n    ],\n];\n`
    );
    writeFileSync(
      join(dir, 'app', 'code', 'Foo', 'Model', 'Unsafe.php'),
      `<?php\nclass Unsafe { public function go($v) { return openssl_encrypt($v, "aes-256-cbc", "${REDACTION_SENTINEL}"); } }\n`
    );
    const result = runChecker(dir);
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout, new RegExp(REDACTION_SENTINEL));
    assert.doesNotMatch(result.stderr, new RegExp(REDACTION_SENTINEL));
    // Only rule id / file / line / source — never raw matched line content.
    assert.doesNotMatch(result.stdout, /openssl_encrypt\(/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Both toolkit flavours ship the same guardrail + checker ------------------------------

test('both the Claude Code and GitHub Copilot flavour scanners run and agree on a clean repo', () => {
  const dir = makeRepo();
  try {
    writeFileSync(
      join(dir, 'app', 'code', 'Foo', 'Model', 'Safe.php'),
      '<?php\nclass Safe { public function go($v) { return hash("crc32b", $v); } }\n'
    );
    const claude = runChecker(dir, [], checkerScript);
    const github = runChecker(dir, [], mirroredCheckerScript);
    assert.equal(claude.status, 0, claude.stdout + claude.stderr);
    assert.equal(github.status, 0, github.stdout + github.stderr);
    assert.equal(parseJson(claude).status, 'ok');
    assert.equal(parseJson(github).status, 'ok');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('both flavour scanners detect the same unsafe untracked file', () => {
  const dir = makeRepo();
  try {
    writeFileSync(
      join(dir, 'app', 'code', 'Foo', 'Model', 'Unsafe.php'),
      '<?php\nclass Unsafe { public function go($v, $k) { return openssl_encrypt($v, "aes-256-cbc", $k); } }\n'
    );
    const claude = runChecker(dir, [], checkerScript);
    const github = runChecker(dir, [], mirroredCheckerScript);
    assert.equal(claude.status, 1);
    assert.equal(github.status, 1);
    assert.ok(parseJson(claude).violations.some((v) => v.rule === 'ENC_DIRECT_CIPHER_CALL'));
    assert.ok(parseJson(github).violations.some((v) => v.rule === 'ENC_DIRECT_CIPHER_CALL'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
