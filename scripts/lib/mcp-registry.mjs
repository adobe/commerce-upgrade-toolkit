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

import { setupCodegraph } from '../setup-codegraph.mjs'

// Registry metadata is not an approval artifact. No MCP is automatically provisioned.
export const MCP_REGISTRY = [
  {
    id: 'codegraph',
    label: 'CodeGraph',
    description: 'Optional source analysis optimization; disabled pending independently reviewed activation artifacts.',
    mandatory: false,
    install: ({ projectRoot, ...options }) => setupCodegraph(projectRoot, options),
  },
]

export function getMandatoryMcps() {
  return MCP_REGISTRY.filter((mcp) => mcp.mandatory)
}
