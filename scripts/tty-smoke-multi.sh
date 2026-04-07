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
  commit_workspace_changes 'chore: configure multi tty smoke runtime'
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
      default_branch: 'master',
      description: repoName,
    });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  " "$WORKSPACE_DIR" "$repo_name" "$repo_path"
  commit_workspace_changes "chore: register repository $repo_name"
}

register_local_repos() {
  register_repo "repo-a" "$REPO_A_DIR"
  register_repo "repo-b" "$REPO_B_DIR"
  register_repo "repo-c" "$REPO_C_DIR"
}

capture_workspace_snapshot() {
  local prefix="$1"

  (
    cd "$WORKSPACE_DIR"
    node "$DOJO_BIN" status
  ) > "$TRANSCRIPTS_DIR/${prefix}-status.txt"

  git -C "$WORKSPACE_DIR" branch --show-current > "$TRANSCRIPTS_DIR/${prefix}-root-branch.txt"
  git -C "$REPO_A_DIR" branch --show-current > "$TRANSCRIPTS_DIR/${prefix}-repo-a-branch.txt"
  git -C "$REPO_B_DIR" branch --show-current > "$TRANSCRIPTS_DIR/${prefix}-repo-b-branch.txt"
  git -C "$REPO_C_DIR" branch --show-current > "$TRANSCRIPTS_DIR/${prefix}-repo-c-branch.txt"
}

verify_after_repo_registration() {
  assert_git_clean "$WORKSPACE_DIR" 'workspace should stay clean after repo auto-commits'
  capture_workspace_snapshot "baseline"
  assert_contains "$TRANSCRIPTS_DIR/baseline-status.txt" "No active session (baseline mode)" 'baseline status should show no active session'
  assert_contains "$TRANSCRIPTS_DIR/baseline-root-branch.txt" "main" 'root should stay on main before sessions'
  assert_contains "$TRANSCRIPTS_DIR/baseline-repo-a-branch.txt" "master" 'repo-a should stay on baseline master'
  assert_contains "$TRANSCRIPTS_DIR/baseline-repo-b-branch.txt" "master" 'repo-b should stay on baseline master'
  assert_contains "$TRANSCRIPTS_DIR/baseline-repo-c-branch.txt" "master" 'repo-c should stay on baseline master'
}

verify_after_session_a() {
  capture_workspace_snapshot "session-a"
  assert_contains "$TRANSCRIPTS_DIR/session-a-status.txt" "Active session \"session-a\"" 'status should show session-a active'
  assert_contains "$TRANSCRIPTS_DIR/session-a-root-branch.txt" "feature/session-a-root" 'root should switch to session-a root branch'
  assert_contains "$TRANSCRIPTS_DIR/session-a-repo-a-branch.txt" "feature/session-a-repo-a" 'repo-a should switch into session-a branch'
  assert_contains "$TRANSCRIPTS_DIR/session-a-repo-b-branch.txt" "feature/session-a-repo-b" 'repo-b should switch into session-a branch'
  assert_contains "$TRANSCRIPTS_DIR/session-a-repo-c-branch.txt" "master" 'repo-c should stay on baseline during session-a'
}

verify_after_session_b() {
  capture_workspace_snapshot "session-b"
  assert_contains "$TRANSCRIPTS_DIR/session-b-status.txt" "Active session \"session-b\"" 'status should show session-b active'
  assert_contains "$TRANSCRIPTS_DIR/session-b-root-branch.txt" "feature/session-b-root" 'root should switch to session-b root branch'
  assert_contains "$TRANSCRIPTS_DIR/session-b-repo-a-branch.txt" "master" 'repo-a should return to baseline during session-b'
  assert_contains "$TRANSCRIPTS_DIR/session-b-repo-b-branch.txt" "feature/session-b-repo-b" 'repo-b should switch into session-b branch'
  assert_contains "$TRANSCRIPTS_DIR/session-b-repo-c-branch.txt" "feature/session-b-repo-c" 'repo-c should switch into session-b branch'
}

verify_after_resume_a() {
  capture_workspace_snapshot "resumed-a"
  assert_contains "$TRANSCRIPTS_DIR/resumed-a-status.txt" "Active session \"session-a\"" 'status should show session-a active again'
  assert_contains "$TRANSCRIPTS_DIR/resumed-a-root-branch.txt" "feature/session-a-root" 'root should switch back to session-a root branch'
  assert_contains "$TRANSCRIPTS_DIR/resumed-a-repo-a-branch.txt" "feature/session-a-repo-a" 'repo-a should switch back into session-a branch'
  assert_contains "$TRANSCRIPTS_DIR/resumed-a-repo-b-branch.txt" "feature/session-a-repo-b" 'repo-b should switch back into session-a branch'
  assert_contains "$TRANSCRIPTS_DIR/resumed-a-repo-c-branch.txt" "master" 'repo-c should return to baseline when resuming session-a'
}

main() {
  prepare_smoke_dir
  build_dist
  prepare_local_repos

  run_tty_step create
  disable_auto_push
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
