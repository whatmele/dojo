import path from 'node:path';
import { DOJO_DIR } from '../types.js';
import type { WorkspaceConfig, RepoConfig } from '../types.js';
import { readJSON, writeJSON, fileExists } from '../utils/fs.js';

function configPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, DOJO_DIR, 'config.json');
}

export function readConfig(workspaceRoot: string): WorkspaceConfig {
  const p = configPath(workspaceRoot);
  if (!fileExists(p)) {
    throw new Error(`config.json not found at ${p}. Is this a Dojo workspace?`);
  }
  return readJSON<WorkspaceConfig>(p);
}

export function writeConfig(workspaceRoot: string, config: WorkspaceConfig): void {
  writeJSON(configPath(workspaceRoot), config);
}

export function addRepo(workspaceRoot: string, repo: RepoConfig): void {
  const config = readConfig(workspaceRoot);
  const exists = config.repos.find(r => r.name === repo.name);
  if (exists) {
    throw new Error(`Repo "${repo.name}" already exists in workspace.`);
  }
  config.repos.push(repo);
  writeConfig(workspaceRoot, config);
}

export function removeRepo(workspaceRoot: string, repoName: string): void {
  const config = readConfig(workspaceRoot);
  const idx = config.repos.findIndex(r => r.name === repoName);
  if (idx === -1) {
    throw new Error(`Repo "${repoName}" not found in workspace.`);
  }
  config.repos.splice(idx, 1);
  writeConfig(workspaceRoot, config);
}
