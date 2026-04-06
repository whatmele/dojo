import path from 'node:path';
import { DOJO_DIR } from '../types.js';
import type { WorkspaceState, SessionState, TaskState, TaskManifest } from '../types.js';
import { readJSON, writeJSON, fileExists, listDirs } from '../utils/fs.js';

function workspaceStatePath(root: string): string {
  return path.join(root, DOJO_DIR, 'state.json');
}

function sessionStatePath(root: string, sessionId: string): string {
  return path.join(root, DOJO_DIR, 'sessions', sessionId, 'state.json');
}

function taskStatePath(root: string, sessionId: string, taskName: string): string {
  return path.join(root, DOJO_DIR, 'sessions', sessionId, 'tasks', taskName, 'state.json');
}

export function readWorkspaceState(root: string): WorkspaceState {
  const p = workspaceStatePath(root);
  if (!fileExists(p)) {
    return { active_session: null };
  }
  return readJSON<WorkspaceState>(p);
}

export function writeWorkspaceState(root: string, state: WorkspaceState): void {
  writeJSON(workspaceStatePath(root), state);
}

export function readSessionState(root: string, sessionId: string): SessionState {
  const p = sessionStatePath(root, sessionId);
  if (!fileExists(p)) {
    throw new Error(`Session "${sessionId}" not found.`);
  }
  return readJSON<SessionState>(p);
}

export function writeSessionState(root: string, sessionId: string, state: SessionState): void {
  writeJSON(sessionStatePath(root, sessionId), state);
}

export function sessionExists(root: string, sessionId: string): boolean {
  return fileExists(sessionStatePath(root, sessionId));
}

export function readTaskState(root: string, sessionId: string, taskName: string): TaskState {
  const p = taskStatePath(root, sessionId, taskName);
  if (!fileExists(p)) {
    return { is_completed: false };
  }
  return readJSON<TaskState>(p);
}

export function writeTaskState(root: string, sessionId: string, taskName: string, state: TaskState): void {
  writeJSON(taskStatePath(root, sessionId, taskName), state);
}

function taskManifestPath(root: string, sessionId: string): string {
  return path.join(root, DOJO_DIR, 'sessions', sessionId, 'tasks', 'manifest.json');
}

export function readTaskManifest(root: string, sessionId: string): TaskManifest | null {
  const p = taskManifestPath(root, sessionId);
  if (!fileExists(p)) return null;
  try {
    return readJSON<TaskManifest>(p);
  } catch {
    return null;
  }
}

export function writeTaskManifest(root: string, sessionId: string, manifest: TaskManifest): void {
  writeJSON(taskManifestPath(root, sessionId), manifest);
}

export function listSessions(root: string): SessionState[] {
  const sessionsDir = path.join(root, DOJO_DIR, 'sessions');
  const dirs = listDirs(sessionsDir);
  return dirs
    .filter(d => fileExists(sessionStatePath(root, d)))
    .map(d => readJSON<SessionState>(sessionStatePath(root, d)));
}

export function getActiveSession(root: string): SessionState | null {
  const ws = readWorkspaceState(root);
  if (!ws.active_session) return null;
  try {
    return readSessionState(root, ws.active_session);
  } catch {
    return null;
  }
}
