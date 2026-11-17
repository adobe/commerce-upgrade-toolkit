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
import {
  MCP_REGISTRY,
  getMandatoryMcps,
} from '../scripts/lib/mcp-registry.mjs';

test('every registry entry has an id, label, description, mandatory flag, and install function', () => {
  for (const mcp of MCP_REGISTRY) {
    assert.equal(typeof mcp.id, 'string');
    assert.equal(typeof mcp.label, 'string');
    assert.equal(typeof mcp.description, 'string');
    assert.equal(typeof mcp.mandatory, 'boolean');
    assert.equal(typeof mcp.install, 'function');
  }
});

test('no MCP is mandatory; registry cannot activate CodeGraph', async () => {
  assert.deepEqual(getMandatoryMcps(), []);
  const mcp = MCP_REGISTRY.find((entry) => entry.id === 'codegraph');
  assert.equal(mcp.mandatory, false);
  await assert.rejects(mcp.install({ projectRoot: '.', enableCodegraph: true }), /activation blocked/);
});
