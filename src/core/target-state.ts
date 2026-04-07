import type {
  RepoConfig,
  SessionRepoBinding,
  SessionState,
  SessionWorkspaceRootBinding,
  WorkspaceConfig,
  WorkspaceTargetState,
} from '../types.js';
import { getWorkspaceRootBaselineBranch } from './baseline.js';
import { resolveRepoPath } from './workspace.js';

function toSessionRepoBinding(
  repoName: string,
  targetBranch: string,
  config: WorkspaceConfig,
): SessionRepoBinding {
  const repo = config.repos.find((item) => item.name === repoName);
  return {
    repo: repoName,
    path_snapshot: repo?.path ?? repoName,
    target_branch: targetBranch,
    base_branch: repo?.default_branch ?? 'main',
    branch_source: 'existing',
  };
}

export function normalizeSessionState(
  session: SessionState,
  config: WorkspaceConfig,
): SessionState {
  const workspace_root: SessionWorkspaceRootBinding = session.workspace_root ?? {
    target_branch: session.workspace_branch ?? `feature/${session.id}`,
    base_branch: getWorkspaceRootBaselineBranch(config),
    branch_source: 'existing',
  };

  const repos = session.repos ?? Object.entries(session.repo_branches ?? {})
    .map(([repoName, branch]) => toSessionRepoBinding(repoName, branch, config));

  return {
    ...session,
    updated_at: session.updated_at ?? session.created_at,
    workspace_root,
    repos,
  };
}

function expectedBranchForRepo(
  repo: RepoConfig,
  session: SessionState | null,
): { expected_branch: string; source: 'session' | 'baseline' } {
  if (!session) {
    return {
      expected_branch: repo.default_branch,
      source: 'baseline',
    };
  }

  const normalized = session.repos ?? [];
  const binding = normalized.find((item) => item.repo === repo.name);
  if (binding) {
    return {
      expected_branch: binding.target_branch,
      source: 'session',
    };
  }

  return {
    expected_branch: repo.default_branch,
    source: 'baseline',
  };
}

export function buildWorkspaceTargetState(
  root: string,
  config: WorkspaceConfig,
  session: SessionState | null,
): WorkspaceTargetState {
  const normalized = session ? normalizeSessionState(session, config) : null;

  return {
    mode: normalized ? 'session' : 'no-session',
    session_id: normalized?.id ?? null,
    root: {
      expected_branch: normalized?.workspace_root?.target_branch ?? getWorkspaceRootBaselineBranch(config),
    },
    repos: config.repos.map((repo) => {
      const resolved = expectedBranchForRepo(repo, normalized);
      return {
        repo: repo.name,
        path: resolveRepoPath(root, repo.path),
        expected_branch: resolved.expected_branch,
        source: resolved.source,
      };
    }),
  };
}
