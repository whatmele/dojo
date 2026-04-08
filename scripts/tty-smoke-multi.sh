#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SMOKE_DIR="$ROOT_DIR/tty-smoke-test/multi"
WORKSPACE_DIR="$SMOKE_DIR/multi-workspace"
TRANSCRIPTS_DIR="$SMOKE_DIR/transcripts"
EXPECT_DRIVER="$ROOT_DIR/scripts/tty-smoke-multi.expect"
DOJO_BIN="$ROOT_DIR/dist/bin/dojo.js"
REPO_A_DIR="$SMOKE_DIR/repo-a"
REPO_B_DIR="$SMOKE_DIR/repo-b"
REPO_C_DIR="$SMOKE_DIR/repo-c"

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
    printf 'TTY multi smoke assertion failed: %s\n' "$message" >&2
    printf 'Checked file: %s\n' "$file" >&2
    exit 1
  fi
}

assert_git_clean() {
  local repo_path="$1"
  local message="$2"
  if [ -n "$(git -C "$repo_path" status --porcelain)" ]; then
    printf 'TTY multi smoke assertion failed: %s\n' "$message" >&2
    git -C "$repo_path" status --short >&2 || true
    exit 1
  fi
}

prepare_smoke_dir() {
  mkdir -p "$SMOKE_DIR"
  rm -rf "$WORKSPACE_DIR" "$TRANSCRIPTS_DIR" "$REPO_A_DIR" "$REPO_B_DIR" "$REPO_C_DIR"
  mkdir -p "$TRANSCRIPTS_DIR"
}

build_dist() {
  log 'building dist for multi-repo tty smoke...'
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
  local repo_path="$1"
  local title="$2"
  mkdir -p "$repo_path"
  git -C "$repo_path" init -b master >/dev/null
  printf '# %s\n' "$title" > "$repo_path/README.md"
  git -C "$repo_path" add README.md
  git -C "$repo_path" commit -m 'init' >/dev/null
}

prepare_local_repos() {
  prepare_local_repo "$REPO_A_DIR" "repo-a"
  prepare_local_repo "$REPO_B_DIR" "repo-b"
  prepare_local_repo "$REPO_C_DIR" "repo-c"
}

register_repo() {
  local repo_name="$1"
  local repo_path="$2"
  node -e "
    const fs = require('node:fs');
    const path = require('node:path');
    const configPath = path.join(process.argv[1], '.dojo', 'config.json');
    const repoName = process.argv[2];
    const repoPath = process.argv[3];
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.repos.push({
      name: repoName,
      type: 'biz',
      git: 'local:' + repoPath,
      path: repoPath,
      description: repoName,
    });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  " "$WORKSPACE_DIR" "$repo_name" "$repo_path"
}

register_local_repos() {
  register_repo "repo-a" "$REPO_A_DIR"
  register_repo "repo-b" "$REPO_B_DIR"
  register_repo "repo-c" "$REPO_C_DIR"
  commit_workspace_changes 'chore: register multi smoke repositories'
}

run_tty_step() {
  local step="$1"
  log "running tty step: $step"
  ROOT_DIR="$ROOT_DIR" \
  SMOKE_DIR="$SMOKE_DIR" \
  WORKSPACE_DIR="$WORKSPACE_DIR" \
  TRANSCRIPTS_DIR="$TRANSCRIPTS_DIR" \
  REPO_A_DIR="$REPO_A_DIR" \
  REPO_B_DIR="$REPO_B_DIR" \
  REPO_C_DIR="$REPO_C_DIR" \
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

  cp "$WORKSPACE_DIR/.dojo/context.md" "$TRANSCRIPTS_DIR/${prefix}-context.md"

  git -C "$WORKSPACE_DIR" branch --show-current > "$TRANSCRIPTS_DIR/${prefix}-root-branch.txt"
  git -C "$REPO_A_DIR" branch --show-current > "$TRANSCRIPTS_DIR/${prefix}-repo-a-branch.txt"
  git -C "$REPO_B_DIR" branch --show-current > "$TRANSCRIPTS_DIR/${prefix}-repo-b-branch.txt"
  git -C "$REPO_C_DIR" branch --show-current > "$TRANSCRIPTS_DIR/${prefix}-repo-c-branch.txt"
}

verify_after_repo_registration() {
  assert_git_clean "$WORKSPACE_DIR" 'workspace should stay clean after repo auto-commits'
  capture_workspace_snapshot "baseline"
  assert_contains "$TRANSCRIPTS_DIR/baseline-status.txt" 'Mode: baseline' 'baseline status should show baseline mode'
  assert_contains "$TRANSCRIPTS_DIR/baseline-status.txt" 'repo-a' 'status should include repo-a'
  assert_contains "$TRANSCRIPTS_DIR/baseline-status.txt" 'repo-b' 'status should include repo-b'
  assert_contains "$TRANSCRIPTS_DIR/baseline-status.txt" 'repo-c' 'status should include repo-c'
  assert_contains "$TRANSCRIPTS_DIR/baseline-root-branch.txt" 'main' 'root branch should remain main'
  assert_contains "$TRANSCRIPTS_DIR/baseline-repo-a-branch.txt" 'master' 'repo-a branch should remain master'
  assert_contains "$TRANSCRIPTS_DIR/baseline-repo-b-branch.txt" 'master' 'repo-b branch should remain master'
  assert_contains "$TRANSCRIPTS_DIR/baseline-repo-c-branch.txt" 'master' 'repo-c branch should remain master'
}

verify_after_session_a() {
  capture_workspace_snapshot "session-a"
  assert_contains "$TRANSCRIPTS_DIR/session-a-status.txt" 'Active session: session-a' 'status should show session-a active'
  assert_contains "$TRANSCRIPTS_DIR/session-a-context.md" '.dojo/sessions/session-a/' 'context should point at session-a artifacts'
  assert_contains "$TRANSCRIPTS_DIR/session-a-root-branch.txt" 'main' 'root branch should stay main in MVP mode'
}

verify_after_session_b() {
  capture_workspace_snapshot "session-b"
  assert_contains "$TRANSCRIPTS_DIR/session-b-status.txt" 'Active session: session-b' 'status should show session-b active'
  assert_contains "$TRANSCRIPTS_DIR/session-b-context.md" '.dojo/sessions/session-b/' 'context should point at session-b artifacts'
  assert_contains "$TRANSCRIPTS_DIR/session-b-root-branch.txt" 'main' 'root branch should still stay main in MVP mode'
}

verify_after_resume_a() {
  capture_workspace_snapshot "resumed-a"
  assert_contains "$TRANSCRIPTS_DIR/resumed-a-status.txt" 'Active session: session-a' 'status should show session-a active again'
  assert_contains "$TRANSCRIPTS_DIR/resumed-a-context.md" '.dojo/sessions/session-a/' 'context should point back at session-a artifacts'
  assert_contains "$TRANSCRIPTS_DIR/resumed-a-root-branch.txt" 'main' 'root branch should still stay main after resume'
}

main() {
  prepare_smoke_dir
  build_dist
  prepare_local_repos

  run_tty_step create
  register_local_repos
  verify_after_repo_registration

  run_tty_step session-new-a
  verify_after_session_a

  run_tty_step session-new-b
  verify_after_session_b

  run_tty_step session-resume-a
  verify_after_resume_a

  log
  log "tty multi smoke passed"
  log "artifacts:"
  log "  workspace:   $WORKSPACE_DIR"
  log "  repo-a:      $REPO_A_DIR"
  log "  repo-b:      $REPO_B_DIR"
  log "  repo-c:      $REPO_C_DIR"
  log "  transcripts: $TRANSCRIPTS_DIR"
}

main "$@"
