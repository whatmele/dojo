import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { simpleGit } from 'simple-git';
import { writeConfig } from '../../src/core/config.js';
import { writeSessionState, writeWorkspaceState } from '../../src/core/state.js';
import { distributeCommands } from '../../src/core/command-distributor.js';
import { generateContext } from '../../src/core/context-generator.js';
import { ensureDir, readText, writeText } from '../../src/utils/fs.js';
import type { SessionState, WorkspaceConfig } from '../../src/types.js';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(() => ({ on: vi.fn() })),
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

const { registerStartCommand } = await import('../../src/commands/start.js');

let tmpDir: string;
let originalCwd: string;

function writeArtifact(root: string, fileName: string, source: string): void {
  ensureDir(path.join(root, '.dojo', 'artifacts'));
  writeText(path.join(root, '.dojo', 'artifacts', fileName), source);
}

async function setupWorkspace(root: string, config: WorkspaceConfig): Promise<void> {
  ensureDir(path.join(root, '.dojo', 'commands'));
  ensureDir(path.join(root, '.dojo', 'artifacts'));
  ensureDir(path.join(root, '.dojo', 'sessions'));
  ensureDir(path.join(root, '.agents', 'commands'));
  writeConfig(root, config);
  writeWorkspaceState(root, { active_session: null });
  const git = simpleGit(root);
  await git.init();
  fs.writeFileSync(path.join(root, '.gitignore'), '.dojo/context.md\n');
  await git.add('.');
  await git.commit('init workspace');
}

describe('protocol runtime end-to-end', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-protocol-e2e-'));
    originalCwd = process.cwd();
    spawnMock.mockClear();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('E2E-01 supports a custom artifact, custom template, and ordered context rendering through dojo context reload', async () => {
    const workspaceRoot = path.join(tmpDir, 'workspace');
    fs.mkdirSync(workspaceRoot);

    const config: WorkspaceConfig = {
      workspace: { name: 'proto-e2e', description: 'Protocol runtime e2e' },
      agents: ['codex'],
      repos: [],
      context: {
        artifacts: ['product-requirement', 'risk-summary', 'dev-plan'],
      },
    };
    await setupWorkspace(workspaceRoot, config);

    writeArtifact(
      workspaceRoot,
      'dev-plan.js',
      `export default {
        id: 'dev-plan',
        scope: 'session',
        dir: '.dojo/sessions/\${session_id}/dev',
        description: 'Development plan docs.',
        async renderContext({ dir, helpers }) {
          const files = helpers.listMarkdownFiles(dir);
          const lines = ['## Development Plan', ''];
          if (files.length === 0) {
            lines.push('- No files yet.');
          } else {
            for (const file of files) lines.push('- ' + helpers.relative(file));
          }
          return lines.join('\\n');
        },
      };`,
    );
    writeArtifact(
      workspaceRoot,
      'risk-summary.js',
      `export default {
        id: 'risk-summary',
        scope: 'workspace',
        dir: null,
        description: 'Derived risk summary.',
        async renderContext() {
          return '## Risk Summary\\n\\n- Custom risk section';
        },
      };`,
    );

    writeText(
      path.join(workspaceRoot, '.dojo', 'commands', 'dojo-dev-plan.md'),
      [
        '<dojo_read_block artifacts="product-requirement,dev-plan" />',
        '',
        '<dojo_write_block artifact="dev-plan" />',
        '',
        'Write under ${artifact_dir:dev-plan}',
        'Input: $ARGUMENTS',
      ].join('\n'),
    );

    const session: SessionState = {
      id: 'custom-runtime',
      description: 'Custom protocol runtime flow',
      created_at: '2026-04-07T00:00:00Z',
      status: 'active',
    };
    writeSessionState(workspaceRoot, session.id, session);
    writeWorkspaceState(workspaceRoot, { active_session: session.id });

    ensureDir(path.join(workspaceRoot, '.dojo', 'sessions', session.id, 'product-requirements'));
    ensureDir(path.join(workspaceRoot, '.dojo', 'sessions', session.id, 'dev'));
    writeText(path.join(workspaceRoot, '.dojo', 'sessions', session.id, 'product-requirements', 'prd.md'), '# PRD');
    writeText(path.join(workspaceRoot, '.dojo', 'sessions', session.id, 'dev', 'plan.md'), '# Dev plan');

    await distributeCommands(workspaceRoot, session.id, config.agents);
    await generateContext(workspaceRoot, session, config);

    const renderedCmd = readText(path.join(workspaceRoot, '.agents', 'commands', 'dojo-dev-plan.md'));
    expect(renderedCmd).toContain('.dojo/sessions/custom-runtime/dev');
    expect(renderedCmd).toContain('$ARGUMENTS');
    expect(renderedCmd).toContain('### Available Context');
    expect(renderedCmd).toContain('### Output Artifact');

    const contextMd = readText(path.join(workspaceRoot, '.dojo', 'context.md'));
    expect(contextMd).toContain('## Product Requirements');
    expect(contextMd).toContain('## Risk Summary');
    expect(contextMd).toContain('## Development Plan');
    expect(contextMd.indexOf('## Risk Summary')).toBeLessThan(contextMd.indexOf('## Development Plan'));
  });

  it('E2E-02 refreshes commands and context before dojo start launches the coding tool', async () => {
    const workspaceRoot = path.join(tmpDir, 'workspace-start');
    fs.mkdirSync(workspaceRoot);

    const config: WorkspaceConfig = {
      workspace: { name: 'start-test', description: 'Start runtime test' },
      agents: ['codex'],
      agent_commands: { codex: 'mock-codex' },
      repos: [],
    };
    await setupWorkspace(workspaceRoot, config);

    writeText(
      path.join(workspaceRoot, '.dojo', 'commands', 'dojo-prd.md'),
      'Output to ${artifact_dir:product-requirement}\nTopic: $ARGUMENTS',
    );

    const session: SessionState = {
      id: 'start-session',
      description: 'Start command verification',
      created_at: '2026-04-07T00:00:00Z',
      status: 'active',
    };
    writeSessionState(workspaceRoot, session.id, session);
    writeWorkspaceState(workspaceRoot, { active_session: session.id });

    ensureDir(path.join(workspaceRoot, '.dojo', 'sessions', session.id, 'product-requirements'));
    writeText(path.join(workspaceRoot, '.dojo', 'sessions', session.id, 'product-requirements', 'prd.md'), '# Start PRD');
    writeText(path.join(workspaceRoot, 'dirty-but-allowed.txt'), 'local changes are fine for start');

    spawnMock.mockImplementation((cmd: string) => {
      const contextMd = readText(path.join(workspaceRoot, '.dojo', 'context.md'));
      const renderedCmd = readText(path.join(workspaceRoot, '.agents', 'commands', 'dojo-prd.md'));

      expect(cmd).toBe('mock-codex');
      expect(contextMd).toContain('.dojo/sessions/start-session/product-requirements/prd.md');
      expect(renderedCmd).toContain('.dojo/sessions/start-session/product-requirements');

      return { on: vi.fn() } as never;
    });

    process.chdir(workspaceRoot);
    const program = new Command();
    registerStartCommand(program);

    await program.parseAsync(['node', 'dojo', 'start', 'codex']);

    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('E2E-03 restores the correct session context after session resume', async () => {
    const workspaceRoot = path.join(tmpDir, 'workspace-resume');
    fs.mkdirSync(workspaceRoot);

    const config: WorkspaceConfig = {
      workspace: { name: 'resume-test', description: 'Resume runtime test' },
      agents: ['codex'],
      repos: [],
    };
    await setupWorkspace(workspaceRoot, config);

    const sessionA: SessionState = {
      id: 'session-a',
      description: 'First session',
      created_at: '2026-04-07T00:00:00Z',
      status: 'active',
    };
    const sessionB: SessionState = {
      id: 'session-b',
      description: 'Second session',
      created_at: '2026-04-07T00:00:00Z',
      status: 'suspended',
    };

    writeSessionState(workspaceRoot, sessionA.id, sessionA);
    writeSessionState(workspaceRoot, sessionB.id, sessionB);

    ensureDir(path.join(workspaceRoot, '.dojo', 'sessions', sessionA.id, 'research'));
    ensureDir(path.join(workspaceRoot, '.dojo', 'sessions', sessionB.id, 'research'));
    writeText(path.join(workspaceRoot, '.dojo', 'sessions', sessionA.id, 'research', 'README.md'), '# Session A');
    writeText(path.join(workspaceRoot, '.dojo', 'sessions', sessionB.id, 'research', 'README.md'), '# Session B');

    writeWorkspaceState(workspaceRoot, { active_session: sessionB.id });
    await generateContext(workspaceRoot, sessionB, config);
    const contextB = readText(path.join(workspaceRoot, '.dojo', 'context.md'));
    expect(contextB).toContain('.dojo/sessions/session-b/research/README.md');
    expect(contextB).not.toContain('.dojo/sessions/session-a/research/README.md');

    sessionA.status = 'active';
    sessionB.status = 'suspended';
    writeSessionState(workspaceRoot, sessionA.id, sessionA);
    writeSessionState(workspaceRoot, sessionB.id, sessionB);
    writeWorkspaceState(workspaceRoot, { active_session: sessionA.id });

    await generateContext(workspaceRoot, sessionA, config);
    const contextA = readText(path.join(workspaceRoot, '.dojo', 'context.md'));
    expect(contextA).toContain('.dojo/sessions/session-a/research/README.md');
    expect(contextA).not.toContain('.dojo/sessions/session-b/research/README.md');
  });

  it('E2E-04 does not depend on live reinjection of .dojo/context.md during an already-running AI session', async () => {
    const workspaceRoot = path.join(tmpDir, 'workspace-live');
    fs.mkdirSync(workspaceRoot);

    const config: WorkspaceConfig = {
      workspace: { name: 'live-test', description: 'Live context test' },
      agents: ['codex'],
      repos: [],
    };
    await setupWorkspace(workspaceRoot, config);

    const session: SessionState = {
      id: 'live-runtime',
      description: 'Live runtime behavior',
      created_at: '2026-04-07T00:00:00Z',
      status: 'active',
    };
    writeSessionState(workspaceRoot, session.id, session);
    writeWorkspaceState(workspaceRoot, { active_session: session.id });

    ensureDir(path.join(workspaceRoot, '.dojo', 'sessions', session.id, 'research'));
    writeText(path.join(workspaceRoot, '.dojo', 'sessions', session.id, 'research', 'README.md'), '# First pass');

    await generateContext(workspaceRoot, session, config);
    const firstContext = readText(path.join(workspaceRoot, '.dojo', 'context.md'));
    expect(firstContext).toContain('README.md');

    writeText(path.join(workspaceRoot, '.dojo', 'sessions', session.id, 'research', 'second-pass.md'), '# Second pass');
    const staleContext = readText(path.join(workspaceRoot, '.dojo', 'context.md'));
    expect(staleContext).not.toContain('second-pass.md');

    await generateContext(workspaceRoot, session, config);
    const refreshedContext = readText(path.join(workspaceRoot, '.dojo', 'context.md'));
    expect(refreshedContext).toContain('second-pass.md');
  });
});
