#!/usr/bin/env bash
# Copyright 2026 Adobe. All rights reserved.
# This file is licensed to you under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License. You may obtain a copy
# of the License at http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software distributed under
# the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
# OF ANY KIND, either express or implied. See the License for the specific language
# governing permissions and limitations under the License.
# SPDX-License-Identifier: Apache-2.0
# =============================================================================
# Adobe Commerce Upgrade Toolkit – Setup Script
# =============================================================================
# Installs the selected upgrade toolkit into an existing Adobe Commerce project.
#
# Usage (interactive):
#   ./setup.sh
#
# Usage (non-interactive):
#   ./setup.sh --project /path/to/project
# =============================================================================

BOLD='\033[1m'
DIM='\033[2m'
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
RESET='\033[0m'

info()    { printf "  ${CYAN}>${RESET} %s\n" "$1"; }
success() { printf "  ${GREEN}✓${RESET} %s\n" "$1"; }
warn()    { printf "  ${YELLOW}!${RESET} %s\n" "$1"; }
err()     { printf "  ${RED}✗${RESET} %s\n" "$1" >&2; }
step()    { printf "\n${BOLD}${BLUE}── %s ${RESET}\n" "$1"; }
die()     { err "$1"; exit 1; }

show_banner() {
  printf "\n${BOLD}${BLUE}  Adobe Commerce Upgrade Toolkit${RESET}\n"
  printf "${DIM}  Agent setup for Commerce version-upgrade work${RESET}\n\n"
}

check_prereqs() {
  step "Checking prerequisites"
  local failed=0

  if ! command -v node &>/dev/null; then
    err "node not found — install Node.js >= 18 and retry"; failed=1
  else
    local nv
    nv=$(node --version | sed 's/v//' | cut -d. -f1)
    if [[ "$nv" -lt 18 ]]; then
      err "node $(node --version) is too old — need >= 18"; failed=1
    else
      success "node $(node --version)"
    fi
  fi

  if [[ $failed -eq 1 ]]; then die "Fix the issues above and re-run setup."; fi
}

prompt_project_path() {
  step "Commerce project"
  while true; do
    read -rp "  Project path (absolute): " raw_path
    local path="${raw_path/#\~/$HOME}"
    if [[ -z "$path" ]]; then
      warn "Path cannot be empty"
    elif [[ ! -d "$path" ]]; then
      warn "Directory not found: $path"
    else
      PROJECT_PATH="$path"
      break
    fi
  done
}

show_summary() {
  printf "\n${BOLD}${GREEN}  ✔ Setup complete${RESET}\n\n"
  printf "  ${BOLD}Project:${RESET}  %s\n" "$PROJECT_PATH"
  printf "\n  ${BOLD}Next steps:${RESET}\n"
  if [[ "$SETUP_AGENT" == "github-copilot" ]]; then
    printf "    Open %s in VS Code or Copilot CLI and request the upgrade-hop skill.\n" "$PROJECT_PATH"
    printf "    Then use upgrade-hop-execute with the next approved hop version.\n\n"
  else
    printf "    1. Open %s in your terminal\n" "$PROJECT_PATH"
    printf "    2. Run: ${CYAN}claude${RESET}\n"
    printf "    3. Type: ${CYAN}/upgrade-hop${RESET}  — detect your environment and generate a hop roadmap\n"
    printf "    4. Type: ${CYAN}/upgrade-hop-execute <version>${RESET}  — implement fixes for a hop\n\n"
  fi
}

main() {
  PROJECT_PATH=""
  SETUP_AGENT="claude-code"
  local enable_codegraph=0 skip_codegraph=0 project_seen=0
  local args=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --project|-p)
        [[ $# -ge 2 && "$2" != -* ]] || die "Missing value for $1"
        [[ $project_seen -eq 0 ]] || die "Duplicate flag: --project"
        project_seen=1
        PROJECT_PATH="$2"; shift ;;
      --agent|-a|--install-type|--environment)
        [[ $# -ge 2 && "$2" != -* ]] || die "Missing value for $1"
        [[ "$1" == "--agent" || "$1" == "-a" ]] && SETUP_AGENT="$2"
        case "$1" in -a) args+=(--agent "$2");; *) args+=("$1" "$2");; esac
        shift ;;
      --enable-codegraph) enable_codegraph=1; args+=("$1") ;;
      --skip-codegraph) skip_codegraph=1; args+=("$1") ;;
      -h|--help)
        printf "Usage:\n"
        printf "  %s\n" "$0"
        printf "  %s --project PATH [--agent claude-code|github-copilot] [--skip-codegraph]\n" "$0"
        printf "CodeGraph is disabled by default. --enable-codegraph is blocked pending independent review.\n"
        exit 0
        ;;
      *) die "Unknown flag or argument: $1" ;;
    esac
    shift
  done
  [[ $enable_codegraph -eq 1 && $skip_codegraph -eq 1 ]] && die "--enable-codegraph and --skip-codegraph conflict"
  [[ $enable_codegraph -eq 1 ]] && die "CodeGraph activation blocked: no independently reviewed approved profile exists. Use direct project read/search; see docs/security-migration.md for pending requirements."
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  show_banner
  check_prereqs

  if [[ -z "$PROJECT_PATH" ]]; then
    prompt_project_path
  elif [[ ! -d "$PROJECT_PATH" ]]; then
    die "Project directory does not exist: $PROJECT_PATH"
  fi

  node "$SCRIPT_DIR/scripts/setup-project.mjs" --project "$PROJECT_PATH" "${args[@]}" \
    || die "setup-project.mjs failed"

  show_summary
}

main "$@"
