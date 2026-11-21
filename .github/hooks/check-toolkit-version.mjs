#!/usr/bin/env node
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

// SessionStart hook: checks whether a newer Adobe Commerce Upgrade Toolkit
// version is published, and if so, prints an actionable notice that becomes
// part of the session's context. Never blocks or fails the session — any
// error (offline, timeout, missing marker) is swallowed and the hook exits 0.

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';

const PACKAGE_NAME = '@adobe/commerce-upgrade-toolkit';
const NPM_VIEW_TIMEOUT_MS = 3000;

const projectRoot = process.cwd();
const versionMarkerPath = path.join(projectRoot, '.github', 'context', '.ccua-version');
const lastNotifiedPath = path.join(projectRoot, '.github', 'context', '.ccua-last-notified');

function readTrimmed(p) {
  try {
    return fs.readFileSync(p, 'utf8').trim();
  } catch {
    return null;
  }
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function fetchLatestVersion() {
  return new Promise((resolve) => {
    const child = execFile(
      'npm', ['view', PACKAGE_NAME, 'version'],
      { timeout: NPM_VIEW_TIMEOUT_MS },
      (error, stdout) => {
        if (error) return resolve(null);
        resolve(stdout.trim() || null);
      }
    );
    child.on('error', () => resolve(null));
  });
}

async function main() {
  const installedVersion = readTrimmed(versionMarkerPath);
  if (!installedVersion) return; // project predates the version marker — nothing to compare

  const latestVersion = await fetchLatestVersion();
  if (!latestVersion) return; // offline / registry unreachable — stay silent

  if (compareVersions(latestVersion, installedVersion) <= 0) return; // already current

  const lastNotified = readTrimmed(lastNotifiedPath);
  if (lastNotified === latestVersion) return; // already notified for this version

  const userNotice = `Adobe Commerce Upgrade Toolkit: a newer version (v${latestVersion}) is available — you have v${installedVersion}. Run "aio commerce upgrade tools-setup" and select the same agent to update.`;
  const modelContext =
    `A newer toolkit version (v${latestVersion}) is available; installed is v${installedVersion}.\n` +
    `Ask the user if they'd like to update now — if yes, run: aio commerce upgrade tools-setup and select the same agent.\n` +
    `After it finishes, tell the user to restart their coding agent session to pick up the changes.`;

  // `systemMessage` renders directly in the UI regardless of whether the user
  // has sent a first prompt yet — that's what actually makes this visible on
  // a fresh session. `hookSpecificOutput.additionalContext` separately feeds
  // the model so it can proactively offer to run the update once the user
  // does send a message.
  console.log(JSON.stringify({
    systemMessage: userNotice,
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: modelContext,
    },
  }));

  try {
    fs.mkdirSync(path.dirname(lastNotifiedPath), { recursive: true });
    fs.writeFileSync(lastNotifiedPath, `${latestVersion}\n`);
  } catch {
    // best-effort — a failed write just means we'd notify again next session
  }
}

main().catch(() => {}).finally(() => process.exit(0));
