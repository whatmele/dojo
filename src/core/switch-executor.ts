import type { SwitchPlan } from '../types.js';
import {
  checkoutBranch,
  checkoutTrackingBranch,
  createBranchFrom,
  getCurrentBranch,
} from './git.js';

export interface SwitchExecutionResult {
  success: boolean;
  error?: string;
  appliedActions: string[];
}

export async function executeSwitchPlan(plan: SwitchPlan): Promise<SwitchExecutionResult> {
  if (plan.blocking_issues.length > 0) {
    return {
      success: false,
      error: plan.blocking_issues[0],
      appliedActions: [],
    };
  }

  const snapshots = new Map<string, string | null>();
  const appliedActions: string[] = [];
  const ordered = [
    ...plan.actions.filter((item) => item.scope === 'root'),
    ...plan.actions.filter((item) => item.scope === 'repo').sort((a, b) => (a.repo ?? '').localeCompare(b.repo ?? '')),
  ];

  try {
    for (const action of ordered) {
      if (!snapshots.has(action.path)) {
        try {
          snapshots.set(action.path, await getCurrentBranch(action.path));
        } catch {
          snapshots.set(action.path, null);
        }
      }

      if (action.action === 'noop') {
        continue;
      }
      if (action.action === 'checkout-existing') {
        await checkoutBranch(action.path, action.target_branch);
      } else if (action.action === 'checkout-tracking-remote') {
        await checkoutTrackingBranch(action.path, action.target_branch);
      } else if (action.action === 'create-from-base') {
        await createBranchFrom(action.path, action.target_branch, action.base_branch ?? 'main');
      }

      appliedActions.push(`${action.scope}:${action.repo ?? 'workspace-root'}:${action.target_branch}`);
    }

    return {
      success: true,
      appliedActions,
    };
  } catch (error: unknown) {
    for (const [repoPath, branch] of snapshots.entries()) {
      if (!branch) continue;
      try {
        await checkoutBranch(repoPath, branch);
      } catch {
        // best effort rollback
      }
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      appliedActions,
    };
  }
}
