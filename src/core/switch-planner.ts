import type {
  SessionRepoBinding,
  SessionState,
  SwitchAction,
  SwitchPlan,
  WorkspaceConfig,
} from '../types.js';
import {
  localBranchExists,
  remoteBranchExists,
} from './git.js';
import { observeWorkspaceState } from './repo-observer.js';
import { buildWorkspaceTargetState, normalizeSessionState } from './target-state.js';

function sessionBindingMap(session: SessionState | null): Map<string, SessionRepoBinding> {
  const map = new Map<string, SessionRepoBinding>();
  for (const binding of session?.repos ?? []) {
    map.set(binding.repo, binding);
  }
  return map;
}

async function determineBranchAction(
  repoPath: string,
  targetBranch: string,
  baseBranch: string | undefined,
  branchSource: 'existing' | 'created',
): Promise<SwitchAction['action'] | 'missing-branch' | 'missing-base'> {
  if (await localBranchExists(repoPath, targetBranch)) {
    return 'checkout-existing';
  }

  if (await remoteBranchExists(repoPath, targetBranch)) {
    return 'checkout-tracking-remote';
  }

  if (branchSource === 'created' && baseBranch) {
    if (!await localBranchExists(repoPath, baseBranch) && !await remoteBranchExists(repoPath, baseBranch)) {
      return 'missing-base';
    }
    return 'create-from-base';
  }

  return branchSource === 'created' ? 'missing-base' : 'missing-branch';
}

export async function planWorkspaceSwitch(
  root: string,
  config: WorkspaceConfig,
  session: SessionState | null,
): Promise<SwitchPlan> {
  const normalized = session ? normalizeSessionState(session, config) : null;
  const observed = await observeWorkspaceState(root, config);
  const target = buildWorkspaceTargetState(root, config, normalized);
  const bindingMap = sessionBindingMap(normalized);
  const blocking_issues: string[] = [];
  const warnings: string[] = [];
  const actions: SwitchAction[] = [];

  const checkObserved = (label: string, item: typeof observed.root): void => {
    if (!item.exists) {
      blocking_issues.push(`${label}: missing repo path`);
      return;
    }
    if (!item.is_git_repo) {
      blocking_issues.push(`${label}: not a git repository`);
      return;
    }
    if (item.detached) {
      blocking_issues.push(`${label}: detached HEAD`);
      return;
    }
    if (item.dirty) {
      blocking_issues.push(`${label}: uncommitted changes`);
    }
  };

  checkObserved('workspace-root', observed.root);
  for (const repo of config.repos) {
    checkObserved(repo.name, observed.repos[repo.name]);
  }

  const rootSource = normalized?.workspace_root?.branch_source ?? 'existing';
  const rootBase = normalized?.workspace_root?.base_branch;
  const rootAction = await determineBranchAction(root, target.root.expected_branch, rootBase, rootSource);
  if (rootAction === 'missing-branch') {
    blocking_issues.push(`workspace-root: missing target branch "${target.root.expected_branch}"`);
  } else if (rootAction === 'missing-base') {
    blocking_issues.push(`workspace-root: missing base branch "${rootBase ?? '-'}"`);
  } else {
    actions.push({
      scope: 'root',
      path: root,
      target_branch: target.root.expected_branch,
      base_branch: rootBase,
      action: rootAction,
    });
  }

  for (const repoTarget of target.repos) {
    const binding = bindingMap.get(repoTarget.repo);
    const branchSource = binding?.branch_source ?? 'existing';
    const baseBranch = binding?.base_branch ?? config.repos.find((repo) => repo.name === repoTarget.repo)?.default_branch;
    const action = await determineBranchAction(repoTarget.path, repoTarget.expected_branch, baseBranch, branchSource);
    if (action === 'missing-branch') {
      blocking_issues.push(`${repoTarget.repo}: missing target branch "${repoTarget.expected_branch}"`);
      continue;
    }
    if (action === 'missing-base') {
      blocking_issues.push(`${repoTarget.repo}: missing base branch "${baseBranch ?? '-'}"`);
      continue;
    }
    if (!binding && repoTarget.source === 'baseline') {
      warnings.push(`${repoTarget.repo}: using baseline branch ${repoTarget.expected_branch}`);
    }
    actions.push({
      scope: 'repo',
      repo: repoTarget.repo,
      path: repoTarget.path,
      target_branch: repoTarget.expected_branch,
      base_branch: baseBranch,
      action,
    });
  }

  return {
    mode: target.mode,
    session_id: target.session_id,
    actions,
    blocking_issues: [...new Set(blocking_issues)],
    warnings,
  };
}
