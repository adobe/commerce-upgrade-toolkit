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

'use strict'

// Runs `aio commerce upgrade tools-setup` without the Adobe I/O CLI, for a temporary Linux
// container that mounts the Commerce project (see docs/setup-guide.md).
const path = require('node:path')
const { run } = require('@oclif/core')

// oclif reads the passwd database when SHELL is unset, which fails for a container UID without an entry.
process.env.SHELL ??= '/bin/sh'

run(['commerce:upgrade:tools-setup', ...process.argv.slice(2)], path.resolve(__dirname, '..'))
  .catch((error) => {
    console.error(error.message)
    process.exitCode = error.oclif?.exit ?? 1
  })
