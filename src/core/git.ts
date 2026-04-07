import { spawn } from 'node:child_process';
import { simpleGit } from 'simple-git';

async function listRefs(repoPath: string, refPattern: string): Promise<string[]> {
  const git = simpleGit(repoPath);
  const output = await git.raw(['for-each-ref', '--format=%(refname:short)', refPattern]);
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.includes('HEAD ->'));
}

function sortBranches(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function normalizeRemoteBranchName(ref: string): string | null {
  if (!ref.includes('/')) {
    return null;
  }
  const [, ...rest] = ref.split('/');
  const normalized = rest.join('/').trim();
  if (!normalized || normalized === 'HEAD') {
    return null;
  }
  return normalized;
}

export async function initRepo(repoPath: string, initialBranch = 'main'): Promise<void> {
  const git = simpleGit();
  try {
    await git.raw(['init', '--initial-branch', initialBranch, repoPath]);
  } catch {
    const repoGit = simpleGit(repoPath);
    await repoGit.init();
    try {
      await repoGit.checkoutLocalBranch(initialBranch);
    } catch {
      // best effort fallback for older git versions
    }
  }
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

export async function fetchRemote(repoPath: string): Promise<void> {
  const git = simpleGit(repoPath);
  await git.fetch();
}

export async function checkoutBranch(repoPath: string, branchName: string): Promise<void> {
  const git = simpleGit(repoPath);
  await git.checkout(branchName);
}

export async function checkoutTrackingBranch(repoPath: string, branchName: string): Promise<void> {
  const remoteBranches = await listRemoteBranches(repoPath);
  const remoteRef = remoteBranches.find((ref) => ref === `origin/${branchName}` || ref.endsWith(`/${branchName}`));
  if (!remoteRef) {
    throw new Error(`Remote branch not found: ${branchName}`);
  }

  const git = simpleGit(repoPath);
  await git.checkout(['-b', branchName, '--track', remoteRef]);
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

export async function listLocalBranches(repoPath: string): Promise<string[]> {
  return sortBranches(await listRefs(repoPath, 'refs/heads'));
}

export async function listRemoteBranches(repoPath: string): Promise<string[]> {
  return sortBranches(await listRefs(repoPath, 'refs/remotes'));
}

export async function listBranchCandidates(repoPath: string): Promise<{
  current: string;
  local: string[];
  remote: string[];
  suggestions: string[];
}> {
  const current = await getCurrentBranch(repoPath);
  const local = await listLocalBranches(repoPath);
  const remote = (await listRemoteBranches(repoPath))
    .map(normalizeRemoteBranchName)
    .filter((branch): branch is string => Boolean(branch));
  const suggestions = [
    current,
    ...local,
    ...remote,
  ].filter(Boolean);

  return {
    current,
    local,
    remote,
    suggestions: [...new Set(suggestions)],
  };
}

export async function branchExists(repoPath: string, branchName: string): Promise<boolean> {
  if (!branchName.trim()) {
    return false;
  }
  if (await localBranchExists(repoPath, branchName)) {
    return true;
  }
  return remoteBranchExists(repoPath, branchName);
}

export async function localBranchExists(repoPath: string, branchName: string): Promise<boolean> {
  const local = await listLocalBranches(repoPath);
  return local.includes(branchName);
}

export async function remoteBranchExists(repoPath: string, branchName: string): Promise<boolean> {
  const remote = await listRemoteBranches(repoPath);
  return remote.some((name) => name === `origin/${branchName}` || name.endsWith(`/${branchName}`));
}

export async function hasUpstreamBranch(repoPath: string): Promise<boolean> {
  const git = simpleGit(repoPath);
  try {
    const branch = await git.raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    return branch.trim().length > 0;
  } catch {
    return false;
  }
}

export async function isDetachedHead(repoPath: string): Promise<boolean> {
  return (await getCurrentBranch(repoPath)) === 'HEAD';
}

async function ensureLocalBranch(repoPath: string, branchName: string): Promise<void> {
  if (await localBranchExists(repoPath, branchName)) {
    return;
  }
  if (await remoteBranchExists(repoPath, branchName)) {
    await checkoutTrackingBranch(repoPath, branchName);
    return;
  }
  throw new Error(`Branch not found locally or remotely: ${branchName}`);
}

export async function createBranchFrom(repoPath: string, branchName: string, baseBranch: string): Promise<void> {
  const git = simpleGit(repoPath);
  await ensureLocalBranch(repoPath, baseBranch);
  await git.checkout(baseBranch);
  await git.checkoutLocalBranch(branchName);
}

export async function alignRepoToExistingBranch(repoPath: string, branchName: string): Promise<void> {
  const currentBranch = await getCurrentBranch(repoPath);
  if (currentBranch === branchName) {
    return;
  }

  if (await isDirty(repoPath)) {
    throw new Error(`Repository has uncommitted changes; cannot switch from "${currentBranch}" to "${branchName}"`);
  }

  await ensureLocalBranch(repoPath, branchName);
  await checkoutBranch(repoPath, branchName);
}

export async function addAndCommit(repoPath: string, message: string): Promise<void> {
  const git = simpleGit(repoPath);
  await git.add('.');
  await git.commit(message);
}

export async function stagePathsAndCommit(
  repoPath: string,
  paths: string[],
  message: string,
): Promise<boolean> {
  const git = simpleGit(repoPath);
  const uniquePaths = [...new Set(paths.map((item) => item.trim()).filter(Boolean))];
  if (uniquePaths.length === 0) {
    return false;
  }

  await git.add(uniquePaths);
  const staged = await git.raw(['diff', '--cached', '--name-only', '--', ...uniquePaths]);
  if (!staged.trim()) {
    return false;
  }

  await git.commit(message);
  return true;
}
