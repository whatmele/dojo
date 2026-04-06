import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { simpleGit } from 'simple-git';

import { writeConfig, readConfig } from '../../src/core/config.js';
import { writeWorkspaceState, readWorkspaceState, writeSessionState, readSessionState, getActiveSession } from '../../src/core/state.js';
import { initRepo, addAndCommit } from '../../src/core/git.js';
import { generateContext } from '../../src/core/context-generator.js';
import { distributeCommands } from '../../src/core/command-distributor.js';
import { isDojoWorkspace, getSessionDir } from '../../src/core/workspace.js';
import { ensureDir, readText, writeText, fileExists } from '../../src/utils/fs.js';
import type { WorkspaceConfig, SessionState } from '../../src/types.js';

let tmpDir: string;

async function createBareRepo(name: string): Promise<string> {
  const barePath = path.join(tmpDir, `_bare_${name}`);
  fs.mkdirSync(barePath, { recursive: true });
  const git = simpleGit(barePath);
  await git.init(true);
  return barePath;
}

async function initDojoWorkspace(root: string, config: WorkspaceConfig): Promise<void> {
  ensureDir(path.join(root, '.dojo', 'sessions'));
  ensureDir(path.join(root, '.dojo', 'commands'));
  ensureDir(path.join(root, '.agents', 'commands'));
  ensureDir(path.join(root, 'docs'));
  ensureDir(path.join(root, 'repos', 'biz'));
  ensureDir(path.join(root, 'repos', 'dev'));
  ensureDir(path.join(root, 'repos', 'wiki'));

  writeConfig(root, config);
  writeWorkspaceState(root, { active_session: null });

  writeText(path.join(root, 'AGENTS.md'), [
    '# Test Workspace',
    '',
    '## 当前状态',
    '',
    '请阅读 @.dojo/context.md 获取当前工作区的完整上下文信息。',
  ].join('\n'));

  writeText(path.join(root, '.gitignore'), 'repos/\n');

  writeText(
    path.join(root, '.dojo', 'commands', 'dojo-prd.md'),
    'Output to .dojo/sessions/${dojo_current_session_id}/product-requirements/\nTopic: $ARGUMENTS',
  );
  writeText(
    path.join(root, '.dojo', 'commands', 'dojo-research.md'),
    'Output to .dojo/sessions/${dojo_current_session_id}/research/\nTopic: $ARGUMENTS',
  );

  await initRepo(root);
  await addAndCommit(root, 'chore: init workspace');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-e2e-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('E2E lifecycle', () => {
  it('full lifecycle: init → repo add → session new → artifacts → context reload → session switch', async () => {
    const workspaceRoot = path.join(tmpDir, 'workspace');
    fs.mkdirSync(workspaceRoot);

    // -- Step 1: simulate repo add (use bare repos) --
    const bareA = await createBareRepo('svc-a');

    // seed the bare repo with a commit so clone works
    const seedDir = path.join(tmpDir, '_seed_a');
    fs.mkdirSync(seedDir);
    const seedGit = simpleGit(seedDir);
    await seedGit.init();
    fs.writeFileSync(path.join(seedDir, 'README.md'), '# svc-a');
    await seedGit.add('.');
    await seedGit.commit('init');
    await seedGit.addRemote('origin', bareA);
    await seedGit.push('origin', 'master');

    const config: WorkspaceConfig = {
      workspace: { name: 'e2e-test', description: 'E2E test workspace' },
      agents: ['claude-code'],
      repos: [{
        name: 'svc-a',
        type: 'biz',
        git: bareA,
        path: 'repos/biz/svc-a',
        default_branch: 'master',
        description: 'Service A',
      }],
    };

    // -- Step 2: init workspace --
    await initDojoWorkspace(workspaceRoot, config);
    expect(isDojoWorkspace(workspaceRoot)).toBe(true);
    expect(readConfig(workspaceRoot).workspace.name).toBe('e2e-test');

    // -- Step 3: clone the repo --
    const repoPath = path.join(workspaceRoot, 'repos', 'biz', 'svc-a');
    const cloneGit = simpleGit();
    await cloneGit.clone(bareA, repoPath);

    // -- Step 4: session new --
    const sessionId = 'user-auth';
    const sessionDir = getSessionDir(workspaceRoot, sessionId);
    ensureDir(path.join(sessionDir, 'product-requirements'));
    ensureDir(path.join(sessionDir, 'research'));
    ensureDir(path.join(sessionDir, 'tech-design'));
    ensureDir(path.join(sessionDir, 'tasks'));

    const sessionState: SessionState = {
      id: sessionId,
      description: '用户认证重构',
      created_at: new Date().toISOString(),
      status: 'active',
      repo_branches: { 'svc-a': 'feature/user-auth' },
    };
    writeSessionState(workspaceRoot, sessionId, sessionState);
    writeWorkspaceState(workspaceRoot, { active_session: sessionId });

    // create branch in repo
    const repoGitObj = simpleGit(repoPath);
    await repoGitObj.checkoutLocalBranch('feature/user-auth');

    // distribute commands
    distributeCommands(workspaceRoot, sessionId, config.agents);

    // verify commands distributed
    const prdCmd = readText(path.join(workspaceRoot, '.agents', 'commands', 'dojo-prd.md'));
    expect(prdCmd).toContain('user-auth');
    expect(prdCmd).not.toContain('${dojo_current_session_id}');
    expect(prdCmd).toContain('$ARGUMENTS');

    // verify per-file symlinks under .claude/commands (not whole-dir link)
    const claudeCmdDir = path.join(workspaceRoot, '.claude', 'commands');
    expect(fs.existsSync(claudeCmdDir)).toBe(true);
    expect(fs.lstatSync(claudeCmdDir).isSymbolicLink()).toBe(false);
    const prdLink = path.join(claudeCmdDir, 'dojo-prd.md');
    expect(fs.lstatSync(prdLink).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(prdLink, 'utf-8')).toContain('user-auth');

    // -- Step 5: simulate AI work (write artifacts) --
    writeText(
      path.join(sessionDir, 'product-requirements', 'prd.md'),
      '# 用户认证 PRD\n\n功能描述...',
    );
    writeText(
      path.join(sessionDir, 'research', 'oauth-analysis.md'),
      '# OAuth2.0 调研\n\n分析结论...',
    );

    // create a task
    const taskDir = path.join(sessionDir, 'tasks', 'auth-refactor');
    ensureDir(taskDir);
    writeText(path.join(taskDir, 'task-implementation.md'), '# 实现方案');
    writeText(path.join(taskDir, 'task-acceptance.md'), '# 验收标准');
    writeText(path.join(taskDir, 'state.json'), '{"is_completed": false}');

    // -- Step 6: context reload --
    await generateContext(workspaceRoot, sessionState, config);

    const contextMd = readText(path.join(workspaceRoot, '.dojo', 'context.md'));
    expect(contextMd).toContain('用户认证重构');
    expect(contextMd).toContain('prd.md');
    expect(contextMd).toContain('oauth-analysis.md');
    expect(contextMd).toContain('auth-refactor');
    expect(contextMd).toContain('⬜ 未完成');

    // AGENTS.md references context.md
    const agentsMd = readText(path.join(workspaceRoot, 'AGENTS.md'));
    expect(agentsMd).toContain('.dojo/context.md');

    // -- Step 7: create second session (simulate suspend) --
    const session2Id = 'perf-optimize';
    sessionState.status = 'suspended';
    writeSessionState(workspaceRoot, sessionId, sessionState);

    const session2State: SessionState = {
      id: session2Id,
      description: '性能优化',
      created_at: new Date().toISOString(),
      status: 'active',
      repo_branches: {},
    };
    const session2Dir = getSessionDir(workspaceRoot, session2Id);
    ensureDir(path.join(session2Dir, 'product-requirements'));
    ensureDir(path.join(session2Dir, 'research'));
    ensureDir(path.join(session2Dir, 'tech-design'));
    ensureDir(path.join(session2Dir, 'tasks'));
    writeSessionState(workspaceRoot, session2Id, session2State);
    writeWorkspaceState(workspaceRoot, { active_session: session2Id });

    // verify state
    const wsState = readWorkspaceState(workspaceRoot);
    expect(wsState.active_session).toBe(session2Id);
    const oldSession = readSessionState(workspaceRoot, sessionId);
    expect(oldSession.status).toBe('suspended');

    // -- Step 8: resume first session --
    session2State.status = 'suspended';
    writeSessionState(workspaceRoot, session2Id, session2State);

    const resumedState = readSessionState(workspaceRoot, sessionId);
    resumedState.status = 'active';
    writeSessionState(workspaceRoot, sessionId, resumedState);
    writeWorkspaceState(workspaceRoot, { active_session: sessionId });

    distributeCommands(workspaceRoot, sessionId, config.agents);
    await generateContext(workspaceRoot, resumedState, config);

    // verify resumed correctly
    const active = getActiveSession(workspaceRoot);
    expect(active).not.toBeNull();
    expect(active!.id).toBe(sessionId);
    expect(active!.status).toBe('active');

    const contextAfterResume = readText(path.join(workspaceRoot, '.dojo', 'context.md'));
    expect(contextAfterResume).toContain('用户认证重构');
  });
});
