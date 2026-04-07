import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  inputMock,
  searchMock,
  selectMock,
} = vi.hoisted(() => ({
  inputMock: vi.fn(),
  searchMock: vi.fn(),
  selectMock: vi.fn(),
}));

const {
  branchExistsMock,
  listBranchCandidatesMock,
} = vi.hoisted(() => ({
  branchExistsMock: vi.fn(),
  listBranchCandidatesMock: vi.fn(),
}));

vi.mock('@inquirer/prompts', () => ({
  input: inputMock,
  search: searchMock,
  select: selectMock,
}));

vi.mock('../../src/core/git.js', () => ({
  branchExists: branchExistsMock,
  listBranchCandidates: listBranchCandidatesMock,
}));

const { promptBranchName } = await import('../../src/commands/branch-prompts.js');

describe('branch prompts', () => {
  beforeEach(() => {
    inputMock.mockReset();
    searchMock.mockReset();
    selectMock.mockReset();
    branchExistsMock.mockReset();
    listBranchCandidatesMock.mockReset();

    branchExistsMock.mockResolvedValue(false);
    listBranchCandidatesMock.mockResolvedValue({
      current: 'main',
      local: ['main', 'develop'],
      remote: ['main', 'develop'],
      suggestions: ['main', 'develop'],
    });
  });

  it('uses direct manual search for create-target prompts', async () => {
    inputMock.mockResolvedValue('feature/new-work');

    const result = await promptBranchName('Workspace root: target branch', {
      defaultValue: 'feature/new-work',
      repoPath: '/tmp/repo',
      forbidExisting: true,
      preferManualInput: true,
    });

    expect(result).toBe('feature/new-work');
    expect(inputMock).toHaveBeenCalledTimes(1);
    expect(selectMock).not.toHaveBeenCalled();
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('keeps existing-branch selection flow for existing branch prompts', async () => {
    selectMock.mockResolvedValue('develop');
    branchExistsMock.mockResolvedValue(true);

    const result = await promptBranchName('Repo service: target branch', {
      defaultValue: 'main',
      repoPath: '/tmp/repo',
      requireExisting: true,
    });

    expect(result).toBe('develop');
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(searchMock).not.toHaveBeenCalled();
  });
});
