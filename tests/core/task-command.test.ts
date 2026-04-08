import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { registerTaskCommand } from '../../src/commands/task.js';
import { writeConfig } from '../../src/core/config.js';
import { writeWorkspaceState, writeSessionState, writeTaskManifest, writeTaskState } from '../../src/core/state.js';

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-task-command-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  fs.mkdirSync(path.join(tmpDir, '.dojo', 'sessions', 'sess-1', 'tasks', 'design-api'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.dojo', 'sessions', 'sess-1', 'tasks', 'wire-ui'), { recursive: true });

  writeConfig(tmpDir, {
    workspace: { name: 'task-ws', description: 'task workspace' },
    agents: ['claude-code'],
    repos: [],
  });
  writeWorkspaceState(tmpDir, { active_session: 'sess-1' });
  writeSessionState(tmpDir, 'sess-1', {
    id: 'sess-1',
    description: 'Task session',
    created_at: new Date().toISOString(),
    status: 'active',
  });
  writeTaskManifest(tmpDir, 'sess-1', {
    tasks: [
      { name: 'design-api', description: 'Design contract', depends_on: [] },
      { name: 'wire-ui', description: 'Wire client', depends_on: ['design-api'] },
    ],
  });
  writeTaskState(tmpDir, 'sess-1', 'design-api', { is_completed: true });
  writeTaskState(tmpDir, 'sess-1', 'wire-ui', { is_completed: false });
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('task command', () => {
  it('prints a task overview table for the active session', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const program = new Command();
    program.name('dojo');
    registerTaskCommand(program);

    await program.parseAsync(['node', 'dojo', 'task', 'status']);

    const output = logSpy.mock.calls.map((call) => call.map((value) => String(value)).join(' ')).join('\n');
    expect(output).toContain('Session "sess-1" task overview');
    expect(output).toContain('design-api');
    expect(output).toContain('wire-ui');
    expect(output).toContain('ready');
    expect(output).toContain('done');
    expect(output).toContain('Current actionable tasks: wire-ui');
  });
});
