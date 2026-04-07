import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTaskOverview } from '../../src/core/task-overview.js';
import { writeTaskManifest, writeTaskState } from '../../src/core/state.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-task-overview-'));
  fs.mkdirSync(path.join(tmpDir, '.dojo', 'sessions', 'sess-1', 'tasks'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('buildTaskOverview', () => {
  it('derives ready, blocked, done, and untracked tasks from manifest and state files', () => {
    writeTaskManifest(tmpDir, 'sess-1', {
      tasks: [
        { name: 'design-api', description: 'Design the API contract', depends_on: [] },
        { name: 'wire-ui', description: 'Wire the UI to the API', depends_on: ['design-api'] },
        { name: 'verify-e2e', description: 'Run end-to-end validation', depends_on: ['wire-ui'] },
      ],
    });

    writeTaskState(tmpDir, 'sess-1', 'design-api', { is_completed: true });
    writeTaskState(tmpDir, 'sess-1', 'wire-ui', { is_completed: false });
    fs.mkdirSync(path.join(tmpDir, '.dojo', 'sessions', 'sess-1', 'tasks', 'notes-only'), { recursive: true });

    const overview = buildTaskOverview(tmpDir, 'sess-1');
    const byName = new Map(overview.items.map((item) => [item.name, item]));

    expect(overview.summary).toEqual({
      total: 4,
      done: 1,
      ready: 1,
      blocked: 1,
      untracked: 1,
    });
    expect(byName.get('design-api')?.dependency_status).toBe('done');
    expect(byName.get('wire-ui')?.dependency_status).toBe('ready');
    expect(byName.get('verify-e2e')?.dependency_status).toBe('blocked');
    expect(byName.get('notes-only')?.dependency_status).toBe('untracked');
  });

  it('normalizes id-prefixed task directories and legacy manifest fields without duplicating tasks', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.dojo', 'sessions', 'sess-1', 'tasks', 'manifest.json'),
      JSON.stringify({
        session: 'sess-1',
        tasks: [
          { id: '01', name: 'project-setup', title: 'Project Setup', dependencies: [] },
          { id: '02', name: 'dependencies', title: 'Dependencies Setup', dependencies: ['01'] },
        ],
      }, null, 2),
    );

    fs.mkdirSync(path.join(tmpDir, '.dojo', 'sessions', 'sess-1', 'tasks', '01-project-setup'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.dojo', 'sessions', 'sess-1', 'tasks', '02-dependencies'), { recursive: true });
    writeTaskState(tmpDir, 'sess-1', '01-project-setup', { is_completed: true });

    const overview = buildTaskOverview(tmpDir, 'sess-1');
    const byName = new Map(overview.items.map((item) => [item.name, item]));

    expect(overview.summary).toEqual({
      total: 2,
      done: 1,
      ready: 1,
      blocked: 0,
      untracked: 0,
    });
    expect([...byName.keys()]).toEqual(['dependencies', 'project-setup']);
    expect(byName.get('project-setup')?.task_dir).toContain('01-project-setup');
    expect(byName.get('dependencies')?.depends_on).toEqual(['project-setup']);
    expect(byName.get('dependencies')?.description).toBe('Dependencies Setup');
    expect(byName.get('dependencies')?.dependency_status).toBe('ready');
  });
});
