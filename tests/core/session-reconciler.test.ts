import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { writeConfig } from '../../src/core/config.js';
import { reconcileWorkspaceState } from '../../src/core/session-reconciler.js';
import type { SessionState, WorkspaceConfig } from '../../src/types.js';

let tmpDir: string;

describe('session reconciliation', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-reconcile-'));
    fs.mkdirSync(path.join(tmpDir, '.dojo'), { recursive: true });
    const git = simpleGit(tmpDir);
    await git.init(['--initial-branch=main']);
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# test\n');
    await git.add('.');
    await git.commit('init');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('prioritizes branch mismatch over dirty so start can still detect misalignment', async () => {
    const config: WorkspaceConfig = {
      workspace: { name: 'reconcile-test', description: 'reconcile' },
      agents: ['codex'],
      repos: [],
    };
    writeConfig(tmpDir, config);

    const session: SessionState = {
      id: 'feature-work',
      description: 'feature work',
      created_at: new Date().toISOString(),
      status: 'active',
      workspace_root: {
        target_branch: 'feature/work',
        base_branch: 'main',
        branch_source: 'created',
      },
      repos: [],
    };

    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# dirty change\n');
    const reconciliation = await reconcileWorkspaceState(tmpDir, config, session);

    expect(reconciliation.root.dirty).toBe(true);
    expect(reconciliation.root.current_branch).toBe('main');
    expect(reconciliation.root.status).toBe('branch-mismatch');
    expect(reconciliation.blocking_issues).toContain('workspace-root: dirty');
    expect(reconciliation.overall).toBe('blocked');
  });
});
