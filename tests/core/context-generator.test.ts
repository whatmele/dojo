import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildContextMarkdown } from '../../src/core/context-generator.js';
import type { SessionState, WorkspaceConfig } from '../../src/types.js';

let tmpDir: string;

const testConfig: WorkspaceConfig = {
  workspace: { name: 'test', description: 'test' },
  agents: ['claude-code'],
  repos: [
    { name: 'svc-a', type: 'biz', git: 'x', path: 'repos/biz/svc-a', description: 'A' },
  ],
};

const testSession: SessionState = {
  id: 'my-session',
  description: '用户认证重构',
  external_link: 'https://example.com/issue/1',
  created_at: '2026-04-04T10:00:00Z',
  status: 'active',
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-test-ctx-'));
  const sessionDir = path.join(tmpDir, '.dojo', 'sessions', 'my-session');
  fs.mkdirSync(path.join(sessionDir, 'product-requirements'), { recursive: true });
  fs.mkdirSync(path.join(sessionDir, 'research'), { recursive: true });
  fs.mkdirSync(path.join(sessionDir, 'tech-design'), { recursive: true });
  fs.mkdirSync(path.join(sessionDir, 'tasks'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('buildContextMarkdown', () => {
  it('generates context for empty session', async () => {
    const md = await buildContextMarkdown(tmpDir, testSession, testConfig);
    expect(md).toContain('用户认证重构');
    expect(md).toContain('my-session');
    expect(md).toContain('active');
    expect(md).toContain('svc-a');
    expect(md).toContain('Startup and handoff context');
    expect(md).toContain('Artifact root: .dojo/sessions/my-session/');
  });

  it('includes PRD files in index', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.dojo', 'sessions', 'my-session', 'product-requirements', 'prd.md'),
      '# PRD',
    );
    const md = await buildContextMarkdown(tmpDir, testSession, testConfig);
    expect(md).toContain('product-requirements/prd.md');
  });

  it('includes research files in index', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.dojo', 'sessions', 'my-session', 'research', 'README.md'),
      '# OAuth Flow',
    );
    const md = await buildContextMarkdown(tmpDir, testSession, testConfig);
    expect(md).toContain('Primary document: .dojo/sessions/my-session/research/README.md');
  });

  it('includes task list with completion status', async () => {
    const taskDir = path.join(tmpDir, '.dojo', 'sessions', 'my-session', 'tasks', 'auth-refactor');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'state.json'), '{"is_completed": true}');

    const taskDir2 = path.join(tmpDir, '.dojo', 'sessions', 'my-session', 'tasks', 'oauth-gateway');
    fs.mkdirSync(taskDir2, { recursive: true });
    fs.writeFileSync(path.join(taskDir2, 'state.json'), '{"is_completed": false}');

    const md = await buildContextMarkdown(tmpDir, testSession, testConfig);
    expect(md).toContain('auth-refactor');
    expect(md).toContain('Done');
    expect(md).toContain('oauth-gateway');
    expect(md).toContain('Todo');
  });
});
