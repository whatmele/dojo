import path from 'node:path';
import { DOJO_DIR } from '../types.js';
import type { SessionState, WorkspaceConfig, TaskState, TaskManifest } from '../types.js';
import { writeText, fileExists, listFiles, listDirs, readJSON } from '../utils/fs.js';

interface TaskInfo {
  name: string;
  description: string;
  is_completed: boolean;
  depends_on: string[];
}

function scanFiles(dirPath: string): string[] {
  return listFiles(dirPath).filter(f => f !== '.DS_Store');
}

function scanTasks(tasksDir: string, manifest: TaskManifest | null): TaskInfo[] {
  if (manifest) {
    return manifest.tasks.map(entry => {
      const statePath = path.join(tasksDir, entry.name, 'state.json');
      let is_completed = false;
      if (fileExists(statePath)) {
        try {
          const state = readJSON<TaskState>(statePath);
          is_completed = state.is_completed;
        } catch { /* ignore */ }
      }
      return {
        name: entry.name,
        description: entry.description,
        is_completed,
        depends_on: entry.depends_on,
      };
    });
  }

  const taskDirs = listDirs(tasksDir);
  return taskDirs.map(name => {
    const statePath = path.join(tasksDir, name, 'state.json');
    let is_completed = false;
    if (fileExists(statePath)) {
      try {
        const state = readJSON<TaskState>(statePath);
        is_completed = state.is_completed;
      } catch { /* ignore */ }
    }
    return { name, description: '', is_completed, depends_on: [] };
  });
}

export function buildContextMarkdown(
  root: string,
  session: SessionState,
  config: WorkspaceConfig,
): string {
  const sessionDir = path.join(root, DOJO_DIR, 'sessions', session.id);
  const prdDir = path.join(sessionDir, 'product-requirements');
  const researchDir = path.join(sessionDir, 'research');
  const techDir = path.join(sessionDir, 'tech-design');
  const tasksDir = path.join(sessionDir, 'tasks');

  const prdFiles = scanFiles(prdDir);
  const researchFiles = scanFiles(researchDir);
  const techFiles = scanFiles(techDir);

  const manifestPath = path.join(tasksDir, 'manifest.json');
  let manifest: TaskManifest | null = null;
  if (fileExists(manifestPath)) {
    try { manifest = readJSON<TaskManifest>(manifestPath); } catch { /* ignore */ }
  }
  const tasks = scanTasks(tasksDir, manifest);

  const lines: string[] = [];
  lines.push('# Workspace context');
  lines.push('');
  lines.push(`This workspace is working on: **${session.description}**`);
  lines.push('');

  lines.push('## Current session');
  lines.push(`- Session ID: ${session.id}`);
  lines.push(`- Status: ${session.status}`);
  if (session.external_link) {
    lines.push(`- Link: ${session.external_link}`);
  }
  lines.push('');

  lines.push('## File index');
  lines.push('');

  if (prdFiles.length > 0) {
    lines.push('### PRD');
    for (const f of prdFiles) {
      lines.push(`- .dojo/sessions/${session.id}/product-requirements/${f}`);
    }
    lines.push('');
  }

  if (researchFiles.length > 0) {
    lines.push('### Research');
    for (const f of researchFiles) {
      lines.push(`- .dojo/sessions/${session.id}/research/${f}`);
    }
    lines.push('');
  }

  if (techFiles.length > 0) {
    lines.push('### Technical design');
    for (const f of techFiles) {
      lines.push(`- .dojo/sessions/${session.id}/tech-design/${f}`);
    }
    lines.push('');
  }

  if (tasks.length > 0) {
    lines.push('### Tasks');
    lines.push('');
    lines.push('Suggested order:');
    lines.push('');
    lines.push('| # | Task | Description | Depends on | Status |');
    lines.push('|---|------|-------------|------------|--------|');
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const status = t.is_completed ? 'Done' : 'Todo';
      const deps = t.depends_on.length > 0 ? t.depends_on.join(', ') : '-';
      const desc = t.description || '-';
      lines.push(`| ${i + 1} | ${t.name} | ${desc} | ${deps} | ${status} |`);
    }
    lines.push('');
  }

  const branchEntries = Object.entries(session.repo_branches);
  if (branchEntries.length > 0) {
    lines.push('## Repositories');
    lines.push('| Repo | Type | Branch |');
    lines.push('|------|------|--------|');
    for (const [repoName, branch] of branchEntries) {
      const repo = config.repos.find(r => r.name === repoName);
      const type = repo?.type ?? 'unknown';
      lines.push(`| ${repoName} | ${type} | ${branch} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export async function generateContext(
  root: string,
  session: SessionState,
  config: WorkspaceConfig,
): Promise<void> {
  const contextMd = buildContextMarkdown(root, session, config);
  writeText(path.join(root, DOJO_DIR, 'context.md'), contextMd);
}
