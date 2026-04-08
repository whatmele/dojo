#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SMOKE_DIR="$ROOT_DIR/tty-smoke-test/failures"
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
    printf 'TTY failure smoke assertion failed: %s\n' "$message" >&2
    printf 'Checked file: %s\n' "$file" >&2
    exit 1
  fi
}

prepare_smoke_dir() {
  mkdir -p "$SMOKE_DIR"
  rm -rf "$WORKSPACE_DIR" "$LOCAL_REPO_DIR" "$TRANSCRIPTS_DIR"
  mkdir -p "$TRANSCRIPTS_DIR"
}

build_dist() {
  log 'building dist for failure-path tty smoke...'
  (cd "$ROOT_DIR" && npm run build >/dev/null)
}

prepare_local_repo() {
  mkdir -p "$LOCAL_REPO_DIR"
  git -C "$LOCAL_REPO_DIR" init -b master >/dev/null
  printf '# tty failures\n' > "$LOCAL_REPO_DIR/README.md"
  git -C "$LOCAL_REPO_DIR" add README.md
  git -C "$LOCAL_REPO_DIR" commit -m 'init' >/dev/null
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

run_expect_fail() {
  local name="$1"
  shift
  local output_file="$TRANSCRIPTS_DIR/$name.txt"
  set +e
  (
    cd "$WORKSPACE_DIR"
    "$@"
  ) >"$output_file" 2>&1
  local exit_code=$?
  set -e
  if [ "$exit_code" -eq 0 ]; then
    printf 'TTY failure smoke assertion failed: command unexpectedly succeeded (%s)\n' "$name" >&2
    cat "$output_file" >&2
    exit 1
  fi
}

main() {
  prepare_smoke_dir
  build_dist
  prepare_local_repo

  run_tty_step create
  run_tty_step repo-add
  run_tty_step session-new

  run_expect_fail resume-missing node "$DOJO_BIN" session resume missing-session
  assert_contains "$TRANSCRIPTS_DIR/resume-missing.txt" 'does not exist' 'resume missing should explain that the session does not exist'

  run_expect_fail repo-duplicate node "$DOJO_BIN" repo add --local "$LOCAL_REPO_DIR"
  assert_contains "$TRANSCRIPTS_DIR/repo-duplicate.txt" 'already in this workspace' 'duplicate repo add should be rejected'

  (
    cd "$WORKSPACE_DIR"
    node "$DOJO_BIN" session none
  ) > "$TRANSCRIPTS_DIR/session-none.txt"
  assert_contains "$TRANSCRIPTS_DIR/session-none.txt" 'baseline runtime mode' 'session none should succeed before task-status failure check'

  run_expect_fail task-without-session node "$DOJO_BIN" task status
  assert_contains "$TRANSCRIPTS_DIR/task-without-session.txt" 'No active session' 'task status should require an active session'

  run_expect_fail session-status-missing node "$DOJO_BIN" session status missing-session
  assert_contains "$TRANSCRIPTS_DIR/session-status-missing.txt" 'does not exist' 'session status should reject an unknown session id'

  log
  log "tty failure smoke passed"
  log "artifacts:"
  log "  workspace:   $WORKSPACE_DIR"
  log "  local repo:  $LOCAL_REPO_DIR"
  log "  transcripts: $TRANSCRIPTS_DIR"
}

main "$@"
