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
  printf '# tty failures\n' > "$LOCAL_REPO_DIR/README.md"
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
  commit_workspace_changes 'chore: configure failure tty smoke runtime'
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
  disable_auto_push
  run_tty_step repo-add
  run_tty_step session-new

  printf '\nroot dirty\n' >> "$WORKSPACE_DIR/AGENTS.md"
  run_expect_fail root-dirty-block node "$DOJO_BIN" session none
  assert_contains "$TRANSCRIPTS_DIR/root-dirty-block.txt" "workspace-root: uncommitted changes" 'root dirty block should mention workspace-root'
  git -C "$WORKSPACE_DIR" checkout -- AGENTS.md

  printf '\nrepo dirty\n' >> "$LOCAL_REPO_DIR/README.md"
  run_expect_fail repo-dirty-block node "$DOJO_BIN" session none
  assert_contains "$TRANSCRIPTS_DIR/repo-dirty-block.txt" "local-repo: uncommitted changes" 'repo dirty block should mention the repo'
  git -C "$LOCAL_REPO_DIR" checkout -- README.md

  (
    cd "$WORKSPACE_DIR"
    node "$DOJO_BIN" session exit
  ) > "$TRANSCRIPTS_DIR/session-exit.txt"
  assert_contains "$TRANSCRIPTS_DIR/session-exit.txt" "Workspace returned to no-session baseline mode." 'session exit alias should switch to no-session mode'

  log
  log "tty failure smoke passed"
  log "artifacts:"
  log "  workspace:   $WORKSPACE_DIR"
  log "  local repo:  $LOCAL_REPO_DIR"
  log "  transcripts: $TRANSCRIPTS_DIR"
}

main "$@"
