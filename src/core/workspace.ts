import path from 'node:path';
import { DOJO_DIR } from '../types.js';
import type { WorkspaceConfig, SessionState } from '../types.js';
import { fileExists } from '../utils/fs.js';
import { isDirty } from './git.js';

export function findWorkspaceRoot(from?: string): string {
  let dir = from ?? process.cwd();
  while (true) {
    if (isDojoWorkspace(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('Not inside a Dojo workspace. Run "dojo init" first.');
    }
    dir = parent;
  }
}

export function isDojoWorkspace(dir: string): boolean {
  return fileExists(path.join(dir, DOJO_DIR, 'config.json'));
}

export function getDojoDir(root: string): string {
  return path.join(root, DOJO_DIR);
}

export function getSessionDir(root: string, sessionId: string): string {
  return path.join(root, DOJO_DIR, 'sessions', sessionId);
}

export function getTaskDir(root: string, sessionId: string, taskName: string): string {
  return path.join(root, DOJO_DIR, 'sessions', sessionId, 'tasks', taskName);
}

export function resolveRepoPath(root: string, repoPath: string): string {
  return path.isAbsolute(repoPath) ? repoPath : path.join(root, repoPath);
}

export interface CleanCheckResult {
  clean: boolean;
  dirtyRepos: string[];
}

export async function checkWorkspaceClean(
  root: string,
  _session: SessionState | null,
  config: WorkspaceConfig,
): Promise<CleanCheckResult> {
  const dirtyRepos: string[] = [];

  if (await isDirty(root)) {
    dirtyRepos.push('workspace (root)');
  }

  for (const repo of config.repos) {
    const repoPath = resolveRepoPath(root, repo.path);
    if (!fileExists(repoPath)) continue;
    try {
      if (await isDirty(repoPath)) {
        dirtyRepos.push(repo.name);
      }
    } catch {
      // repo not a git dir, skip
    }
  }

  return { clean: dirtyRepos.length === 0, dirtyRepos };
}
