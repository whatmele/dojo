import path from 'node:path';
import { DOJO_DIR } from '../types.js';
import { fileExists } from '../utils/fs.js';

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
