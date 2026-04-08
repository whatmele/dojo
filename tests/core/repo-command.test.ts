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
} = vi.hoisted(() => ({
  inputMock: vi.fn(),
  selectMock: vi.fn(),
  confirmMock: vi.fn(),
}));

vi.mock('@inquirer/prompts', () => ({
  input: inputMock,
  select: selectMock,
  confirm: confirmMock,
}));

const { registerRepoCommand } = await import('../../src/commands/repo.js');

let tmpDir: string;
let workspaceRoot: string;
let localRepoRoot: string;
let originalCwd: string;

describe('repo add', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-repo-add-'));
    workspaceRoot = path.join(tmpDir, 'workspace');
    localRepoRoot = path.join(tmpDir, 'local-repo');
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
    selectMock.mockResolvedValue('biz');
    inputMock.mockResolvedValue('Local repository');
    confirmMock.mockResolvedValue(false);

    process.chdir(workspaceRoot);
  });

  afterEach(() => {
    process.chdir(originalCwd);
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
});
