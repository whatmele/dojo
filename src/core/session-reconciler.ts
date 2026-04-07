import type {
  ObservedGitState,
  ReconcileStatus,
  ReconciledItem,
  SessionState,
  WorkspaceConfig,
  WorkspaceReconciliation,
} from '../types.js';
import { observeWorkspaceState } from './repo-observer.js';
import { buildWorkspaceTargetState } from './target-state.js';

function reconcileItem(
  name: string,
  expectedBranch: string,
  observed: ObservedGitState,
): ReconciledItem {
  let status: ReconcileStatus = 'aligned';

  if (!observed.exists) {
    status = 'missing-repo';
  } else if (!observed.is_git_repo) {
    status = 'not-git';
  } else if (observed.detached) {
    status = 'detached-head';
  } else if (observed.current_branch !== expectedBranch) {
    status = 'branch-mismatch';
  } else if (observed.dirty) {
    status = 'dirty';
  }

  return {
    name,
    expected_branch: expectedBranch,
    current_branch: observed.current_branch,
    dirty: observed.dirty,
    status,
  };
}

export async function reconcileWorkspaceState(
  root: string,
  config: WorkspaceConfig,
  session: SessionState | null,
): Promise<WorkspaceReconciliation> {
  const target = buildWorkspaceTargetState(root, config, session);
  const observed = await observeWorkspaceState(root, config);
  const rootItem = reconcileItem('workspace-root', target.root.expected_branch, observed.root);
  const repoItems = target.repos.map((repo) => reconcileItem(repo.repo, repo.expected_branch, observed.repos[repo.repo]));

  const allItems = [rootItem, ...repoItems];
  const blocking_issues = allItems.flatMap((item) => {
    const issues: string[] = [];
    if (item.dirty) {
      issues.push(`${item.name}: dirty`);
    }
    if (item.status === 'missing-repo' || item.status === 'not-git' || item.status === 'detached-head') {
      issues.push(`${item.name}: ${item.status}`);
    }
    return issues;
  });

  const hasDrift = allItems.some((item) => item.status !== 'aligned');

  return {
    mode: target.mode,
    session_id: target.session_id,
    overall: blocking_issues.length > 0 ? 'blocked' : hasDrift ? 'drifted' : 'aligned',
    root: rootItem,
    repos: repoItems,
    blocking_issues,
  };
}
