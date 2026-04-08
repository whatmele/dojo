#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SMOKE_DIR="$ROOT_DIR/tty-smoke-test/main"
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

prepare_local_repo() {
  mkdir -p "$LOCAL_REPO_DIR"
  git -C "$LOCAL_REPO_DIR" init -b master >/dev/null
  printf '# tty smoke\n' > "$LOCAL_REPO_DIR/README.md"
  git -C "$LOCAL_REPO_DIR" add README.md
  git -C "$LOCAL_REPO_DIR" commit -m 'init' >/dev/null
  git -C "$LOCAL_REPO_DIR" branch develop
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

capture_workspace_snapshot() {
  local prefix="$1"

  (
    cd "$WORKSPACE_DIR"
    node "$DOJO_BIN" context reload >/dev/null
  )

  (
    cd "$WORKSPACE_DIR"
    node "$DOJO_BIN" status
  ) > "$TRANSCRIPTS_DIR/${prefix}-status.txt"

  (
    cd "$WORKSPACE_DIR"
    node "$DOJO_BIN" session status tty-smoke
  ) > "$TRANSCRIPTS_DIR/${prefix}-session-status.txt" 2>&1 || true

  cp "$WORKSPACE_DIR/.dojo/context.md" "$TRANSCRIPTS_DIR/${prefix}-context.md"

  git -C "$WORKSPACE_DIR" branch --show-current > "$TRANSCRIPTS_DIR/${prefix}-root-branch.txt"
  git -C "$LOCAL_REPO_DIR" branch --show-current > "$TRANSCRIPTS_DIR/${prefix}-repo-branch.txt"
}

verify_after_repo_add() {
  capture_workspace_snapshot "baseline"
  assert_contains "$TRANSCRIPTS_DIR/baseline-status.txt" 'Mode: baseline' 'baseline status should report baseline mode'
  assert_contains "$TRANSCRIPTS_DIR/baseline-status.txt" 'Active session: -' 'baseline status should report no active session'
  assert_contains "$TRANSCRIPTS_DIR/baseline-status.txt" 'local-repo' 'baseline status should include the registered repo'
  assert_contains "$TRANSCRIPTS_DIR/baseline-context.md" 'Mode: baseline' 'baseline context should show baseline mode'
  assert_contains "$TRANSCRIPTS_DIR/baseline-root-branch.txt" 'main' 'workspace root should stay on main before any session'
  assert_contains "$TRANSCRIPTS_DIR/baseline-repo-branch.txt" 'master' 'local repo branch should not be changed by repo registration'
}

verify_after_session_new() {
  capture_workspace_snapshot "active"
  assert_contains "$TRANSCRIPTS_DIR/active-status.txt" 'Mode: session' 'status should switch to session mode'
  assert_contains "$TRANSCRIPTS_DIR/active-status.txt" 'Active session: tty-smoke' 'status should show the active session'
  assert_contains "$TRANSCRIPTS_DIR/active-session-status.txt" 'Session "tty-smoke"' 'session status should render the selected session'
  assert_contains "$TRANSCRIPTS_DIR/active-context.md" '.dojo/sessions/tty-smoke/' 'active context should point at the session artifact root'
  assert_contains "$TRANSCRIPTS_DIR/active-root-branch.txt" 'main' 'workspace root branch should remain unchanged in MVP mode'
  assert_contains "$TRANSCRIPTS_DIR/active-repo-branch.txt" 'master' 'repo branch should remain unchanged in MVP mode'
}

verify_after_session_none() {
  capture_workspace_snapshot "cleared"
  assert_contains "$TRANSCRIPTS_DIR/cleared-status.txt" 'Mode: baseline' 'status should return to baseline mode after session none'
  assert_contains "$TRANSCRIPTS_DIR/cleared-context.md" 'Mode: baseline' 'context should return to baseline mode after session none'
  assert_contains "$TRANSCRIPTS_DIR/cleared-root-branch.txt" 'main' 'workspace root branch should still be main after session none'
  assert_contains "$TRANSCRIPTS_DIR/cleared-repo-branch.txt" 'master' 'repo branch should still be master after session none'
}

verify_after_session_resume() {
  capture_workspace_snapshot "resumed"
  assert_contains "$TRANSCRIPTS_DIR/resumed-status.txt" 'Active session: tty-smoke' 'status should show the resumed session'
  assert_contains "$TRANSCRIPTS_DIR/resumed-context.md" '.dojo/sessions/tty-smoke/' 'context should point back to the resumed session'
  assert_contains "$TRANSCRIPTS_DIR/resumed-root-branch.txt" 'main' 'workspace root branch should remain unchanged after resume'
  assert_contains "$TRANSCRIPTS_DIR/resumed-repo-branch.txt" 'master' 'repo branch should remain unchanged after resume'
}

main() {
  prepare_smoke_dir
  build_dist
  prepare_local_repo

  run_tty_step create
  run_tty_step repo-add
  assert_git_clean "$WORKSPACE_DIR" 'workspace should stay clean after repo auto-commit'
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
