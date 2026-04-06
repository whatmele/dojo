import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  readWorkspaceState, writeWorkspaceState,
  readSessionState, writeSessionState,
  readTaskState, writeTaskState,
  listSessions, getActiveSession, sessionExists,
} from '../../src/core/state.js';
import type { SessionState } from '../../src/types.js';

let tmpDir: string;

function setup(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-test-state-'));
  fs.mkdirSync(path.join(tmpDir, '.dojo', 'sessions'), { recursive: true });
  return tmpDir;
}

const testSession: SessionState = {
  id: 'test-session',
  description: 'Test session',
  created_at: '2026-04-04T10:00:00Z',
  status: 'active',
  repo_branches: { 'svc-a': 'feature/test' },
};

beforeEach(() => { tmpDir = setup(); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe('workspace state', () => {
  it('readWorkspaceState returns default when file missing', () => {
    const state = readWorkspaceState(tmpDir);
    expect(state.active_session).toBeNull();
  });

  it('writeWorkspaceState / readWorkspaceState round-trips', () => {
    writeWorkspaceState(tmpDir, { active_session: 'sess-1' });
    const state = readWorkspaceState(tmpDir);
    expect(state.active_session).toBe('sess-1');
  });
});

describe('session state', () => {
  it('writeSessionState creates dir and file', () => {
    writeSessionState(tmpDir, 'test-session', testSession);
    expect(sessionExists(tmpDir, 'test-session')).toBe(true);
  });

  it('readSessionState returns correct data', () => {
    writeSessionState(tmpDir, 'test-session', testSession);
    const state = readSessionState(tmpDir, 'test-session');
    expect(state.id).toBe('test-session');
    expect(state.status).toBe('active');
    expect(state.repo_branches['svc-a']).toBe('feature/test');
  });

  it('readSessionState throws when not found', () => {
    expect(() => readSessionState(tmpDir, 'nonexistent')).toThrow();
  });

  it('listSessions returns all sessions', () => {
    writeSessionState(tmpDir, 'sess-1', { ...testSession, id: 'sess-1' });
    writeSessionState(tmpDir, 'sess-2', { ...testSession, id: 'sess-2', status: 'suspended' });
    const sessions = listSessions(tmpDir);
    expect(sessions).toHaveLength(2);
    const ids = sessions.map(s => s.id).sort();
    expect(ids).toEqual(['sess-1', 'sess-2']);
  });

  it('getActiveSession returns session when active', () => {
    writeSessionState(tmpDir, 'test-session', testSession);
    writeWorkspaceState(tmpDir, { active_session: 'test-session' });
    const session = getActiveSession(tmpDir);
    expect(session).not.toBeNull();
    expect(session!.id).toBe('test-session');
  });

  it('getActiveSession returns null when no active session', () => {
    writeWorkspaceState(tmpDir, { active_session: null });
    const session = getActiveSession(tmpDir);
    expect(session).toBeNull();
  });
});

describe('task state', () => {
  it('readTaskState returns default when missing', () => {
    const state = readTaskState(tmpDir, 'test-session', 'task-a');
    expect(state.is_completed).toBe(false);
  });

  it('writeTaskState / readTaskState round-trips', () => {
    writeTaskState(tmpDir, 'test-session', 'task-a', { is_completed: true });
    const state = readTaskState(tmpDir, 'test-session', 'task-a');
    expect(state.is_completed).toBe(true);
  });
});
