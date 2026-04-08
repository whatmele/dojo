import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';

const {
  inputMock,
  checkboxMock,
  confirmMock,
  selectMock,
} = vi.hoisted(() => ({
  inputMock: vi.fn(),
  checkboxMock: vi.fn(),
  confirmMock: vi.fn(),
  selectMock: vi.fn(),
}));

const {
  initRepoMock,
  addAndCommitMock,
  cloneRepoMock,
} = vi.hoisted(() => ({
  initRepoMock: vi.fn(),
  addAndCommitMock: vi.fn(),
  cloneRepoMock: vi.fn(),
}));

vi.mock('@inquirer/prompts', () => ({
  input: inputMock,
  checkbox: checkboxMock,
  confirm: confirmMock,
  select: selectMock,
}));

vi.mock('../../src/core/git.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/core/git.js')>('../../src/core/git.js');
  return {
    ...actual,
    initRepo: initRepoMock,
    addAndCommit: addAndCommitMock,
    cloneRepo: cloneRepoMock,
  };
});

const { registerInitCommand } = await import('../../src/commands/init.js');

let tmpDir: string;
let originalCwd: string;

describe('dojo init starter provisioning', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-init-skill-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    inputMock.mockReset();
    checkboxMock.mockReset();
    confirmMock.mockReset();
    selectMock.mockReset();
    initRepoMock.mockReset();
    addAndCommitMock.mockReset();
    cloneRepoMock.mockReset();

    inputMock.mockImplementation(async ({ message, default: defaultValue }: { message: string; default?: string }) => {
      if (message.includes('Workspace name')) return 'init-skill-ws';
      if (message.includes('Workspace description')) return 'Workspace initialized in test';
      return defaultValue ?? '';
    });
    checkboxMock.mockResolvedValue(['claude-code']);
    confirmMock.mockImplementation(async ({ message, default: defaultValue }: { message: string; default?: boolean }) => {
      if (message.includes('Configure custom CLI')) return false;
      if (message.includes('Add a Git repository now')) return false;
      if (message.includes('Add another repository')) return false;
      return defaultValue ?? false;
    });
    selectMock.mockResolvedValue('biz');

    initRepoMock.mockResolvedValue(undefined);
    addAndCommitMock.mockResolvedValue(undefined);
    cloneRepoMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('copies built-in templates, artifact plugins, types, and the real authoring skill into the workspace and syncs skill links for Claude Code', async () => {
    const program = new Command();
    registerInitCommand(program);

    await program.parseAsync(['node', 'dojo', 'init']);

    expect(fs.existsSync(path.join(tmpDir, '.dojo', 'commands', 'dojo-prd.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.dojo', 'artifacts', 'product-requirement.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.dojo', 'skills', 'dojo-template-authoring', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.dojo', 'types', 'dojo-artifact-plugin.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.agents', 'commands', 'dojo-prd.md'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, '.agents', 'commands', 'dojo-gen-doc.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.agents', 'skills', 'dojo-template-authoring', 'SKILL.md'))).toBe(true);
    const claudeSkillPath = path.join(tmpDir, '.claude', 'skills', 'dojo-template-authoring', 'SKILL.md');
    expect(fs.existsSync(claudeSkillPath)).toBe(true);
    expect(fs.lstatSync(claudeSkillPath).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(claudeSkillPath, 'utf-8')).toContain('Dojo Template Authoring');

    expect(initRepoMock).toHaveBeenCalledTimes(1);
    expect(addAndCommitMock).toHaveBeenCalledTimes(1);
  });
});
