import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { simpleGit } from 'simple-git';
import { writeConfig } from '../../src/core/config.js';
import type { WorkspaceConfig } from '../../src/types.js';

const {
  inputMock,
  selectMock,
  confirmMock,
  checkboxMock,
} = vi.hoisted(() => ({
  inputMock: vi.fn(),
  selectMock: vi.fn(),
  confirmMock: vi.fn(),
  checkboxMock: vi.fn(),
}));

vi.mock('@inquirer/prompts', () => ({
  input: inputMock,
  select: selectMock,
  confirm: confirmMock,
  checkbox: checkboxMock,
}));

const { registerRepoCommand } = await import('../../src/commands/repo.js');

let tmpDir: string;
let workspaceRoot: string;
let localRepoRoot: string;
let remoteRepoRoot: string;
let originalCwd: string;

describe('repo add', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-repo-add-'));
    workspaceRoot = path.join(tmpDir, 'workspace');
    localRepoRoot = path.join(tmpDir, 'local-repo');
    remoteRepoRoot = path.join(tmpDir, 'remote-repo.git');
    originalCwd = process.cwd();

    fs.mkdirSync(path.join(workspaceRoot, '.dojo'), { recursive: true });
    writeConfig(workspaceRoot, {
      workspace: { name: 'repo-test', description: 'repo add test' },
      agents: ['codex'],
      repos: [],
    } satisfies WorkspaceConfig);

    const workspaceGit = simpleGit(workspaceRoot);
    await workspaceGit.init(['--initial-branch=main']);
    fs.writeFileSync(path.join(workspaceRoot, '.gitignore'), '.dojo/state.json\n.dojo/context.md\n');
    await workspaceGit.add('.');
    await workspaceGit.commit('init workspace');

    fs.mkdirSync(localRepoRoot, { recursive: true });
    const localGit = simpleGit(localRepoRoot);
    await localGit.init(['--initial-branch=main']);
    fs.writeFileSync(path.join(localRepoRoot, 'README.md'), '# local repo\n');
    await localGit.add('.');
    await localGit.commit('init local repo');
    await localGit.checkoutLocalBranch('develop');
    await localGit.checkout('main');

    inputMock.mockReset();
    selectMock.mockReset();
    confirmMock.mockReset();
    checkboxMock.mockReset();
    selectMock.mockResolvedValue('biz');
    inputMock.mockImplementation(async ({ message }: { message: string }) => {
      if (message.includes('Main branch')) return '';
      return 'Local repository';
    });
    confirmMock.mockResolvedValue(false);
    checkboxMock.mockResolvedValue(['local-repo']);

    process.chdir(workspaceRoot);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exitCode = undefined;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('registers a local repo without changing its current git branch', async () => {
    const program = new Command();
    registerRepoCommand(program);

    await program.parseAsync(['node', 'dojo', 'repo', 'add', '--local', localRepoRoot]);

    expect(await simpleGit(localRepoRoot).revparse(['--abbrev-ref', 'HEAD'])).toBe('main');
    const config = JSON.parse(fs.readFileSync(path.join(workspaceRoot, '.dojo', 'config.json'), 'utf-8')) as WorkspaceConfig;
    expect(config.repos).toHaveLength(1);
    expect(config.repos[0]?.git).toBe(`local:${localRepoRoot}`);
  });

  it('uses origin remote URL for local repos when available', async () => {
    await simpleGit().init(remoteRepoRoot, true);
    await simpleGit(localRepoRoot).addRemote('origin', remoteRepoRoot);

    const program = new Command();
    registerRepoCommand(program);

    await program.parseAsync(['node', 'dojo', 'repo', 'add', '--local', localRepoRoot]);

    const config = JSON.parse(fs.readFileSync(path.join(workspaceRoot, '.dojo', 'config.json'), 'utf-8')) as WorkspaceConfig;
    expect(config.repos).toHaveLength(1);
    expect(config.repos[0]?.git).toBe(remoteRepoRoot);
  });

  it('stores an optional main branch for local repos', async () => {
    inputMock.mockImplementation(async ({ message }: { message: string }) => {
      if (message.includes('Main branch')) return 'main';
      return 'Local repository';
    });

    const program = new Command();
    registerRepoCommand(program);

    await program.parseAsync(['node', 'dojo', 'repo', 'add', '--local', localRepoRoot]);

    const config = JSON.parse(fs.readFileSync(path.join(workspaceRoot, '.dojo', 'config.json'), 'utf-8')) as WorkspaceConfig;
    expect(config.repos[0]?.main_branch).toBe('main');
  });
});

describe('repo git helpers', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-repo-helpers-'));
    workspaceRoot = path.join(tmpDir, 'workspace');
    localRepoRoot = path.join(tmpDir, 'local-repo');
    originalCwd = process.cwd();

    fs.mkdirSync(path.join(workspaceRoot, '.dojo'), { recursive: true });
    fs.mkdirSync(localRepoRoot, { recursive: true });

    writeConfig(workspaceRoot, {
      workspace: { name: 'repo-test', description: 'repo helper test' },
      agents: ['codex'],
      repos: [{
        name: 'local-repo',
        type: 'biz',
        git: `local:${localRepoRoot}`,
        path: localRepoRoot,
        description: 'Local repository',
        main_branch: 'main',
      }],
    } satisfies WorkspaceConfig);

    const workspaceGit = simpleGit(workspaceRoot);
    await workspaceGit.init(['--initial-branch=main']);
    await workspaceGit.add('.');
    await workspaceGit.commit('init workspace');

    const localGit = simpleGit(localRepoRoot);
    await localGit.init(['--initial-branch=main']);
    fs.writeFileSync(path.join(localRepoRoot, 'README.md'), '# local repo\n');
    await localGit.add('.');
    await localGit.commit('init local repo');
    await localGit.checkoutLocalBranch('develop');
    await localGit.checkout('main');

    inputMock.mockReset();
    selectMock.mockReset();
    confirmMock.mockReset();
    checkboxMock.mockReset();
    checkboxMock.mockResolvedValue(['local-repo']);
    process.chdir(workspaceRoot);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    process.exitCode = undefined;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('shows git status for the remembered repo selection and stores the latest selection', async () => {
    const toolRepoRoot = path.join(tmpDir, 'tool-repo');
    fs.mkdirSync(toolRepoRoot, { recursive: true });
    const toolGit = simpleGit(toolRepoRoot);
    await toolGit.init(['--initial-branch=main']);
    fs.writeFileSync(path.join(toolRepoRoot, 'README.md'), '# tool repo\n');
    await toolGit.add('.');
    await toolGit.commit('init tool repo');

    writeConfig(workspaceRoot, {
      workspace: { name: 'repo-test', description: 'repo helper test' },
      agents: ['codex'],
      repos: [
        {
          name: 'local-repo',
          type: 'biz',
          git: `local:${localRepoRoot}`,
          path: localRepoRoot,
          description: 'Local repository',
        },
        {
          name: 'tool-repo',
          type: 'dev',
          git: `local:${toolRepoRoot}`,
          path: toolRepoRoot,
          description: 'Tool repository',
        },
      ],
    } satisfies WorkspaceConfig);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    checkboxMock.mockImplementationOnce(async ({ choices }: { choices: Array<{ value: string; checked?: boolean }> }) => {
      expect(choices.find((choice) => choice.value === 'local-repo')?.checked).toBe(true);
      expect(choices.find((choice) => choice.value === 'tool-repo')?.checked).toBe(false);
      return ['tool-repo'];
    });

    const program = new Command();
    registerRepoCommand(program);
    await program.parseAsync(['node', 'dojo', 'repo', 'status']);

    const state = JSON.parse(fs.readFileSync(path.join(workspaceRoot, '.dojo', 'state.json'), 'utf-8')) as { last_repo_selection?: string[] };
    expect(state.last_repo_selection).toEqual(['tool-repo']);
    expect(logSpy.mock.calls.flat().join('\n')).toContain('tool-repo');

    checkboxMock.mockImplementationOnce(async ({ choices }: { choices: Array<{ value: string; checked?: boolean }> }) => {
      expect(choices.find((choice) => choice.value === 'local-repo')?.checked).toBe(false);
      expect(choices.find((choice) => choice.value === 'tool-repo')?.checked).toBe(true);
      return ['tool-repo'];
    });

    const programAgain = new Command();
    registerRepoCommand(programAgain);
    await programAgain.parseAsync(['node', 'dojo', 'repo', 'status']);
  });

  it('checks out an explicit branch without touching session state', async () => {
    const program = new Command();
    registerRepoCommand(program);

    await program.parseAsync(['node', 'dojo', 'repo', 'checkout', 'develop', '--repo', 'local-repo']);

    expect(await simpleGit(localRepoRoot).revparse(['--abbrev-ref', 'HEAD'])).toBe('develop');
  });

  it('reports a clear error for checkout --main when main_branch is not configured', async () => {
    writeConfig(workspaceRoot, {
      workspace: { name: 'repo-test', description: 'repo helper test' },
      agents: ['codex'],
      repos: [{
        name: 'local-repo',
        type: 'biz',
        git: `local:${localRepoRoot}`,
        path: localRepoRoot,
        description: 'Local repository',
      }],
    } satisfies WorkspaceConfig);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const program = new Command();
    registerRepoCommand(program);

    await program.parseAsync(['node', 'dojo', 'repo', 'checkout', '--main', '--repo', 'local-repo']);

    expect(process.exitCode).toBe(1);
    expect(logSpy.mock.calls.flat().join('\n')).toContain('no main_branch');
  });

  it('sync --init clones a missing configured repository before pulling the current branch', async () => {
    const missingPath = path.join(workspaceRoot, 'repos', 'biz', 'missing-repo');
    writeConfig(workspaceRoot, {
      workspace: { name: 'repo-test', description: 'repo helper test' },
      agents: ['codex'],
      repos: [{
        name: 'missing-repo',
        type: 'biz',
        git: localRepoRoot,
        path: 'repos/biz/missing-repo',
        description: 'Missing repository',
      }],
    } satisfies WorkspaceConfig);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const program = new Command();
    registerRepoCommand(program);

    await program.parseAsync(['node', 'dojo', 'repo', 'sync', '--init', '--repo', 'missing-repo']);

    expect(fs.existsSync(path.join(missingPath, '.git'))).toBe(true);
    expect(logSpy.mock.calls.flat().join('\n')).toContain('cloned + synced');
  });

  it('sync --init aligns a newly cloned repository to its configured main branch before pulling', async () => {
    const localGit = simpleGit(localRepoRoot);
    await localGit.checkout('develop');
    fs.writeFileSync(path.join(localRepoRoot, 'develop.txt'), 'develop branch\n');
    await localGit.add('.');
    await localGit.commit('develop commit');
    await localGit.checkout('main');

    const missingPath = path.join(workspaceRoot, 'repos', 'biz', 'missing-main-repo');
    writeConfig(workspaceRoot, {
      workspace: { name: 'repo-test', description: 'repo helper test' },
      agents: ['codex'],
      repos: [{
        name: 'missing-main-repo',
        type: 'biz',
        git: localRepoRoot,
        path: 'repos/biz/missing-main-repo',
        description: 'Missing repository',
        main_branch: 'develop',
      }],
    } satisfies WorkspaceConfig);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const program = new Command();
    registerRepoCommand(program);

    await program.parseAsync(['node', 'dojo', 'repo', 'sync', '--init', '--repo', 'missing-main-repo']);

    expect(fs.existsSync(path.join(missingPath, '.git'))).toBe(true);
    expect(await simpleGit(missingPath).revparse(['--abbrev-ref', 'HEAD'])).toBe('develop');
    expect(logSpy.mock.calls.flat().join('\n')).toContain('aligned to develop');
  });
});
