import { spawn } from 'node:child_process';
import { simpleGit } from 'simple-git';

export async function initRepo(repoPath: string): Promise<void> {
  const git = simpleGit(repoPath);
  await git.init();
}

export async function cloneRepo(gitUrl: string, targetPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', ['clone', '--progress', gitUrl, targetPath], {
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`git clone failed (exit ${code ?? signal})`));
    });
  });
}

export async function createBranch(repoPath: string, branchName: string): Promise<void> {
  const git = simpleGit(repoPath);
  await git.checkoutLocalBranch(branchName);
}

export async function pushBranch(repoPath: string, branchName: string): Promise<void> {
  const git = simpleGit(repoPath);
  await git.push('origin', branchName, ['--set-upstream']);
}

export async function checkoutBranch(repoPath: string, branchName: string): Promise<void> {
  const git = simpleGit(repoPath);
  await git.checkout(branchName);
}

export async function pullCurrent(repoPath: string): Promise<{ success: boolean; summary: string }> {
  const git = simpleGit(repoPath);
  try {
    const result = await git.pull();
    const files = result.files.length;
    return { success: true, summary: files > 0 ? `${files} files updated` : 'Already up to date' };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, summary: msg };
  }
}

export async function isDirty(repoPath: string): Promise<boolean> {
  const git = simpleGit(repoPath);
  const status = await git.status();
  return !status.isClean();
}

export async function getCurrentBranch(repoPath: string): Promise<string> {
  const git = simpleGit(repoPath);
  const branch = await git.revparse(['--abbrev-ref', 'HEAD']);
  return branch.trim();
}

export async function listBranches(repoPath: string): Promise<{ current: string; all: string[] }> {
  const git = simpleGit(repoPath);
  const summary = await git.branchLocal();
  return { current: summary.current, all: summary.all };
}

export async function createBranchFrom(repoPath: string, branchName: string, baseBranch: string): Promise<void> {
  const git = simpleGit(repoPath);
  await git.checkout(baseBranch);
  await git.checkoutLocalBranch(branchName);
}

export async function addAndCommit(repoPath: string, message: string): Promise<void> {
  const git = simpleGit(repoPath);
  await git.add('.');
  await git.commit(message);
}
