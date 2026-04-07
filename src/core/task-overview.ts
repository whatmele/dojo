import path from 'node:path';
import type { TaskManifestEntry, TaskOverview, TaskOverviewItem, TaskRuntimeStatus } from '../types.js';
import { readTaskManifest, readTaskState } from './state.js';
import { getSessionDir } from './workspace.js';
import { fileExists, listDirs } from '../utils/fs.js';

function normalizeDescription(value: string | undefined): string {
  return value?.trim() || '-';
}

function computeRuntimeStatus(
  taskName: string,
  completed: Set<string>,
  dependsOn: string[],
  isTracked: boolean,
  isCompleted: boolean,
): TaskRuntimeStatus {
  if (isCompleted) {
    return 'done';
  }
  if (!isTracked) {
    return 'untracked';
  }
  const blocked = dependsOn.some((dependency) => !completed.has(dependency));
  return blocked ? 'blocked' : 'ready';
}

function buildTaskDirAliases(entry: TaskManifestEntry): string[] {
  const aliases = [entry.name];
  if (entry.id?.trim()) {
    aliases.push(`${entry.id.trim()}-${entry.name}`);
  }
  return aliases;
}

export function buildTaskOverview(root: string, sessionId: string): TaskOverview {
  const sessionDir = getSessionDir(root, sessionId);
  const tasksDir = path.join(sessionDir, 'tasks');
  const manifest = readTaskManifest(root, sessionId);
  const taskDirs = fileExists(tasksDir) ? listDirs(tasksDir).filter((name) => name !== 'manifest.json') : [];
  const manifestEntries = manifest?.tasks ?? [];
  const manifestTaskNames = new Set(manifestEntries.map((entry) => entry.name));
  const canonicalToDir = new Map<string, string>();
  const consumedTaskDirs = new Set<string>();

  for (const entry of manifestEntries) {
    const matchingDir = buildTaskDirAliases(entry).find((alias) => taskDirs.includes(alias));
    if (matchingDir) {
      canonicalToDir.set(entry.name, matchingDir);
      consumedTaskDirs.add(matchingDir);
      continue;
    }
    canonicalToDir.set(entry.name, entry.name);
  }

  const untrackedTaskNames = taskDirs.filter((dirName) => !consumedTaskDirs.has(dirName));
  const allTaskNames = [...new Set([...manifestEntries.map((entry) => entry.name), ...untrackedTaskNames])];

  const completed = new Set<string>();
  for (const taskName of allTaskNames) {
    const state = readTaskState(root, sessionId, canonicalToDir.get(taskName) ?? taskName);
    if (state.is_completed) {
      completed.add(taskName);
    }
  }

  const manifestMap = new Map<string, TaskManifestEntry>(
    manifestEntries.map((entry) => [entry.name, entry]),
  );

  const items: TaskOverviewItem[] = allTaskNames.map((taskName) => {
    const entry = manifestMap.get(taskName);
    const dependsOn = entry?.depends_on ?? [];
    const taskDirName = canonicalToDir.get(taskName) ?? taskName;
    const state = readTaskState(root, sessionId, taskDirName);
    return {
      name: taskName,
      description: normalizeDescription(entry?.description),
      depends_on: dependsOn,
      dependency_status: computeRuntimeStatus(taskName, completed, dependsOn, manifestTaskNames.has(taskName), state.is_completed),
      is_completed: state.is_completed,
      task_dir: path.join(tasksDir, taskDirName),
    };
  });

  const ordered = items.sort((left, right) => left.name.localeCompare(right.name));
  const summary = ordered.reduce(
    (acc, item) => {
      acc.total += 1;
      if (item.dependency_status === 'done') acc.done += 1;
      if (item.dependency_status === 'ready') acc.ready += 1;
      if (item.dependency_status === 'blocked') acc.blocked += 1;
      if (item.dependency_status === 'untracked') acc.untracked += 1;
      return acc;
    },
    { total: 0, done: 0, ready: 0, blocked: 0, untracked: 0 },
  );

  return {
    session_id: sessionId,
    items: ordered,
    summary,
  };
}
