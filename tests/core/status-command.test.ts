import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { Command } from 'commander';
import { registerStatusCommand } from '../../src/commands/status.js';
import { writeConfig } from '../../src/core/config.js';
import {
  writeSessionState,
  writeTaskManifest,
  writeTaskState,
  writeWorkspaceState,
} from '../../src/core/state.js';

let tmpDir: string;
let originalCwd: string;

function writeFile(targetPath: string, content: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-status-command-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);

  writeConfig(tmpDir, {
    workspace: { name: 'test', description: 'A stylish runtime workspace' },
    agents: ['claude-code', 'codex'],
    repos: [],
  });
  writeWorkspaceState(tmpDir, { active_session: null });
  writeSessionState(tmpDir, 'test', {
    id: 'test',
    description: 'test',
    created_at: '2026-04-08T06:13:15.804Z',
    updated_at: '2026-04-08T06:13:15.804Z',
    status: 'suspended',
  });

  writeFile(path.join(tmpDir, 'AGENTS.md'), '# Workspace guide\n');
  writeFile(
    path.join(tmpDir, '.dojo', 'commands', 'dojo-gen-doc.md'),
    [
      '---',
      'description: Generate workspace docs',
      'scope: workspace',
      '---',
      '',
      'workspace doc',
    ].join('\n'),
  );
  writeFile(
    path.join(tmpDir, '.dojo', 'commands', 'dojo-research.md'),
    [
      '---',
      'description: Research command',
      'scope: session',
      '---',
      '',
      'session research',
    ].join('\n'),
  );
  writeFile(path.join(tmpDir, '.agents', 'commands', 'dojo-gen-doc.md'), 'rendered');
  writeFile(path.join(tmpDir, '.dojo', 'skills', 'dojo-template-authoring', 'SKILL.md'), '# Skill\n');
  writeFile(path.join(tmpDir, '.agents', 'skills', 'dojo-template-authoring', 'SKILL.md'), '# Skill\n');
  writeFile(path.join(tmpDir, '.claude', 'commands', 'dojo-gen-doc.md'), 'linked');
  writeFile(path.join(tmpDir, '.claude', 'skills', 'dojo-template-authoring', 'SKILL.md'), '# Skill\n');
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('status command', () => {
  it('prints a simplified dashboard by default', async () => {
    writeFile(path.join(tmpDir, '.dojo', 'commands', 'dojo-unrendered.md'), '---\nscope: workspace\n---\nnot rendered');
    writeFile(path.join(tmpDir, '.dojo', 'skills', 'dojo-source-only', 'SKILL.md'), '# Source only skill\n');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const program = new Command();
    program.name('dojo');
    program.command('session');
    registerStatusCommand(program);

    await program.parseAsync(['node', 'dojo', 'status']);

    const output = logSpy.mock.calls.map((call) => call.map((value) => String(value)).join(' ')).join('\n');
    expect(output).toContain('DOJO RUNTIME DASHBOARD');
    expect(output).toContain('OVERVIEW');
    expect(output).toContain('Commands');
    expect(output).toContain('Skills');
    expect(output).toContain('Repositories');
    expect(output).toContain('dojo-gen-doc');
    expect(output).toContain('dojo-template-authoring');
    expect(output).not.toContain('dojo-unrendered');
    expect(output).not.toContain('dojo-source-only');
    expect(output).not.toContain('RUNTIME ASSETS');
  });

  it('prints a full runtime dashboard when --full is provided', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const program = new Command();
    program.name('dojo');
    program.command('session');
    registerStatusCommand(program);

    await program.parseAsync(['node', 'dojo', 'status', '--full']);

    const output = logSpy.mock.calls.map((call) => call.map((value) => String(value)).join(' ')).join('\n');
    expect(output).toContain('DOJO RUNTIME DASHBOARD');
    expect(output).toContain('RUNTIME ASSETS');
    expect(output).toContain('Command templates');
    expect(output).toContain('dojo-gen-doc');
    expect(output).toContain('dojo-template-authoring');
    expect(output).toContain('Claude Code');
    expect(output).toContain('No repositories registered yet');
    expect(output).toContain('SESSIONS');
  });

  it('shows work pulse details for the active session', async () => {
    writeWorkspaceState(tmpDir, { active_session: 'test' });
    writeSessionState(tmpDir, 'test', {
      id: 'test',
      description: 'test',
      created_at: '2026-04-08T06:13:15.804Z',
      updated_at: '2026-04-10T08:00:00.000Z',
      status: 'active',
    });
    writeTaskManifest(tmpDir, 'test', {
      tasks: [
        { name: 'design-api', description: 'Design API', depends_on: [] },
        { name: 'ship-ui', description: 'Ship UI', depends_on: ['design-api'] },
      ],
    });
    writeTaskState(tmpDir, 'test', 'design-api', { is_completed: true });
    writeTaskState(tmpDir, 'test', 'ship-ui', { is_completed: false });
    fs.mkdirSync(path.join(tmpDir, '.dojo', 'sessions', 'test', 'tasks', 'design-api'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.dojo', 'sessions', 'test', 'tasks', 'ship-ui'), { recursive: true });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const program = new Command();
    program.name('dojo');
    program.command('session');
    registerStatusCommand(program);

    await program.parseAsync(['node', 'dojo', 'status', '--full']);

    const output = logSpy.mock.calls.map((call) => call.map((value) => String(value)).join(' ')).join('\n');
    expect(output).toContain('WORK PULSE');
    expect(output).toContain('Active session');
    expect(output).toContain('Actionable now');
    expect(output).toContain('ship-ui');
  });

  it('shows per-repository git status when --git is provided', async () => {
    const repoPath = path.join(tmpDir, 'repos', 'dev', 'svc-a');
    fs.mkdirSync(repoPath, { recursive: true });
    const git = simpleGit(repoPath);
    await git.init();
    await git.addConfig('user.name', 'Dojo Test');
    await git.addConfig('user.email', 'dojo@example.com');
    writeFile(path.join(repoPath, 'README.md'), 'hello\n');
    await git.add('.');
    await git.commit('init');
    writeFile(path.join(repoPath, 'README.md'), 'hello\nworld\n');
    writeFile(path.join(repoPath, 'new-file.txt'), 'new\n');

    writeConfig(tmpDir, {
      workspace: { name: 'test', description: 'A stylish runtime workspace' },
      agents: ['claude-code', 'codex'],
      repos: [{
        name: 'svc-a',
        type: 'dev',
        path: 'repos/dev/svc-a',
        git: 'git@example.com:org/svc-a.git',
        description: 'Service A',
      }],
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const program = new Command();
    program.name('dojo');
    program.command('session');
    registerStatusCommand(program);

    await program.parseAsync(['node', 'dojo', 'status', '--git']);

    const output = logSpy.mock.calls.map((call) => call.map((value) => String(value)).join(' ')).join('\n');
    expect(output).toContain('GIT STATUS');
    expect(output).toContain('svc-a');
    expect(output).toContain('dirty');
    expect(output).toContain('changed');
    expect(output).toContain('untracked');
  });
});
