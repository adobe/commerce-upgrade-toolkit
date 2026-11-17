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

import { recoverLegacyCodegraph } from './lib/codegraph-policy.mjs'

try {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== '--project' || !args[1] || args[1].startsWith('-')) {
    throw new Error('Usage: node scripts/recover-legacy-codegraph.mjs --project <reviewed-project-root>')
  }
  recoverLegacyCodegraph(args[1])
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
