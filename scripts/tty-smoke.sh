#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SMOKE_DIR="$ROOT_DIR/tty-smoke-test"
WORKSPACE_DIR="$SMOKE_DIR/workspace"
LOCAL_REPO_DIR="$SMOKE_DIR/local-repo"
TRANSCRIPTS_DIR="$SMOKE_DIR/transcripts"
EXPECT_DRIVER="$ROOT_DIR/scripts/tty-smoke.expect"
DOJO_BIN="$ROOT_DIR/dist/bin/dojo.js"

log() {
  if [ "$#" -eq 0 ]; then
    printf '\n'
    return
  fi
  printf '%s\n' "$1"
}

assert_contains() {
  local file="$1"
  local pattern="$2"
  local message="$3"
  if ! rg -q --fixed-strings "$pattern" "$file"; then
    printf 'TTY smoke assertion failed: %s\n' "$message" >&2
    printf 'Checked file: %s\n' "$file" >&2
    exit 1
  fi
}

assert_git_clean() {
  local repo_path="$1"
  local message="$2"
  if [ -n "$(git -C "$repo_path" status --porcelain)" ]; then
    printf 'TTY smoke assertion failed: %s\n' "$message" >&2
    git -C "$repo_path" status --short >&2 || true
    exit 1
  fi
}

prepare_smoke_dir() {
  mkdir -p "$SMOKE_DIR"
  rm -rf "$WORKSPACE_DIR" "$LOCAL_REPO_DIR" "$TRANSCRIPTS_DIR"
  mkdir -p "$TRANSCRIPTS_DIR"
}

build_dist() {
  log 'building dist for tty smoke...'
  (cd "$ROOT_DIR" && npm run build >/dev/null)
}

commit_workspace_changes() {
  local message="$1"
  git -C "$WORKSPACE_DIR" add -A
  if git -C "$WORKSPACE_DIR" diff --cached --quiet; then
    return
  fi
  git -C "$WORKSPACE_DIR" commit -m "$message" >/dev/null
}

prepare_local_repo() {
  mkdir -p "$LOCAL_REPO_DIR"
  git -C "$LOCAL_REPO_DIR" init -b master >/dev/null
  printf '# tty smoke\n' > "$LOCAL_REPO_DIR/README.md"
  git -C "$LOCAL_REPO_DIR" add README.md
  git -C "$LOCAL_REPO_DIR" commit -m 'init' >/dev/null
  git -C "$LOCAL_REPO_DIR" branch develop
  git -C "$LOCAL_REPO_DIR" branch develop_xx
  git -C "$LOCAL_REPO_DIR" branch feat/test
}

run_tty_step() {
  local step="$1"
  log "running tty step: $step"
  ROOT_DIR="$ROOT_DIR" \
  SMOKE_DIR="$SMOKE_DIR" \
  WORKSPACE_DIR="$WORKSPACE_DIR" \
  LOCAL_REPO_DIR="$LOCAL_REPO_DIR" \
  TRANSCRIPTS_DIR="$TRANSCRIPTS_DIR" \
  expect "$EXPECT_DRIVER" "$step"
}

disable_auto_push() {
  node -e "
    const fs = require('node:fs');
    const path = require('node:path');
    const configPath = path.join(process.argv[1], '.dojo', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.runtime ??= {};
    config.runtime.remote ??= {};
    config.runtime.remote.auto_push_on_session_create = false;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  " "$WORKSPACE_DIR"
  commit_workspace_changes 'chore: configure tty smoke runtime'
}

capture_workspace_snapshot() {
  local prefix="$1"

  (
    cd "$WORKSPACE_DIR"
    node "$DOJO_BIN" status
  ) > "$TRANSCRIPTS_DIR/${prefix}-status.txt"

  (
    cd "$WORKSPACE_DIR"
    node "$DOJO_BIN" session status tty-smoke
  ) > "$TRANSCRIPTS_DIR/${prefix}-session-status.txt" 2>&1 || true

  git -C "$WORKSPACE_DIR" branch --show-current > "$TRANSCRIPTS_DIR/${prefix}-root-branch.txt"
  git -C "$LOCAL_REPO_DIR" branch --show-current > "$TRANSCRIPTS_DIR/${prefix}-repo-branch.txt"
}

verify_after_repo_add() {
  capture_workspace_snapshot "baseline"
  assert_contains "$TRANSCRIPTS_DIR/baseline-status.txt" "No active session (baseline mode)" 'baseline status should report no active session'
  assert_contains "$TRANSCRIPTS_DIR/baseline-status.txt" "workspace-root" 'baseline status table should include workspace root'
  assert_contains "$TRANSCRIPTS_DIR/baseline-status.txt" "local-repo" 'baseline status table should include local repo'
  assert_contains "$TRANSCRIPTS_DIR/baseline-root-branch.txt" "main" 'workspace root should stay on main before any session'
  assert_contains "$TRANSCRIPTS_DIR/baseline-repo-branch.txt" "master" 'local repo should stay on master before any session'
}

verify_after_session_new() {
  capture_workspace_snapshot "active"
  assert_contains "$TRANSCRIPTS_DIR/active-status.txt" "Active session \"tty-smoke\"" 'status should report the active session'
  assert_contains "$TRANSCRIPTS_DIR/active-status.txt" "feature/tty-smoke" 'workspace root should target the session branch'
  assert_contains "$TRANSCRIPTS_DIR/active-status.txt" "develop" 'repo should target the selected develop branch'
  assert_contains "$TRANSCRIPTS_DIR/active-session-status.txt" "Session \"tty-smoke\"" 'session status should render the session table'
  assert_contains "$TRANSCRIPTS_DIR/active-root-branch.txt" "feature/tty-smoke" 'workspace root should actually switch to feature/tty-smoke'
  assert_contains "$TRANSCRIPTS_DIR/active-repo-branch.txt" "develop" 'repo should actually switch to develop'
}

verify_after_session_none() {
  capture_workspace_snapshot "cleared"
  assert_contains "$TRANSCRIPTS_DIR/cleared-status.txt" "No active session (baseline mode)" 'status should return to baseline mode after clear'
  assert_contains "$TRANSCRIPTS_DIR/cleared-root-branch.txt" "main" 'workspace root should return to main after clear'
  assert_contains "$TRANSCRIPTS_DIR/cleared-repo-branch.txt" "master" 'repo should return to master after clear'
}

verify_after_session_resume() {
  capture_workspace_snapshot "resumed"
  assert_contains "$TRANSCRIPTS_DIR/resumed-status.txt" "Active session \"tty-smoke\"" 'status should show the resumed session'
  assert_contains "$TRANSCRIPTS_DIR/resumed-root-branch.txt" "feature/tty-smoke" 'workspace root should switch back to feature/tty-smoke after resume'
  assert_contains "$TRANSCRIPTS_DIR/resumed-repo-branch.txt" "develop" 'repo should switch back to develop after resume'
}

main() {
  prepare_smoke_dir
  build_dist
  prepare_local_repo

  run_tty_step create
  disable_auto_push
  run_tty_step repo-add
  assert_git_clean "$WORKSPACE_DIR" 'workspace should stay clean after repo add auto-commit'
  verify_after_repo_add

  run_tty_step session-new
  verify_after_session_new

  run_tty_step session-none
  verify_after_session_none

  run_tty_step session-resume
  verify_after_session_resume

  log
  log "tty smoke passed"
  log "artifacts:"
  log "  workspace:   $WORKSPACE_DIR"
  log "  local repo:  $LOCAL_REPO_DIR"
  log "  transcripts: $TRANSCRIPTS_DIR"
}

main "$@"
