import path from 'node:path';
import type { ObservedGitState, ObservedWorkspaceState, WorkspaceConfig } from '../types.js';
import { fileExists } from '../utils/fs.js';
import {
  getCurrentBranch,
  hasUpstreamBranch,
  isDetachedHead,
  isDirty,
} from './git.js';
import { resolveRepoPath } from './workspace.js';

async function observeGitState(repoPath: string): Promise<ObservedGitState> {
  if (!fileExists(repoPath)) {
    return {
      exists: false,
      is_git_repo: false,
      current_branch: null,
      dirty: false,
      detached: false,
      has_upstream: null,
    };
  }

  if (!fileExists(path.join(repoPath, '.git'))) {
    return {
      exists: true,
      is_git_repo: false,
      current_branch: null,
      dirty: false,
      detached: false,
      has_upstream: null,
    };
  }

  try {
    const detached = await isDetachedHead(repoPath);
    const currentBranch = detached ? null : await getCurrentBranch(repoPath);
    const dirty = await isDirty(repoPath);
    const hasUpstream = detached ? null : await hasUpstreamBranch(repoPath);

    return {
      exists: true,
      is_git_repo: true,
      current_branch: currentBranch,
      dirty,
      detached,
      has_upstream: hasUpstream,
    };
  } catch {
    return {
      exists: true,
      is_git_repo: false,
      current_branch: null,
      dirty: false,
      detached: false,
      has_upstream: null,
    };
  }
}

export async function observeWorkspaceState(
  root: string,
  config: WorkspaceConfig,
): Promise<ObservedWorkspaceState> {
  const repos: ObservedWorkspaceState['repos'] = {};
  for (const repo of config.repos) {
    repos[repo.name] = await observeGitState(resolveRepoPath(root, repo.path));
  }

  return {
    root: await observeGitState(root),
    repos,
  };
}
