import type { WorkspaceConfig } from '../types.js';

export function getWorkspaceRootBaselineBranch(config: WorkspaceConfig): string {
  return config.runtime?.workspace_root?.default_branch?.trim() || 'main';
}
