import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildContextMarkdown } from '../../src/core/context-generator.js';
import type { SessionState, WorkspaceConfig } from '../../src/types.js';

let tmpDir: string;

const baseSession: SessionState = {
  id: 'ctx-session',
  description: 'Context artifact verification',
  created_at: '2026-04-07T00:00:00Z',
  status: 'active',
  workspace_branch: 'feature/ctx-session',
  repo_branches: {},
};

function makeConfig(context?: WorkspaceConfig['context']): WorkspaceConfig {
  return {
    workspace: { name: 'ctx-ws', description: 'Context workspace' },
    agents: ['codex'],
    repos: [],
    context,
  };
}

function sessionDir(...parts: string[]): string {
  return path.join(tmpDir, '.dojo', 'sessions', baseSession.id, ...parts);
}

function writeArtifactPlugin(fileName: string, source: string): void {
  const dir = path.join(tmpDir, '.dojo', 'artifacts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), source);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-test-pipeline-'));
  fs.mkdirSync(sessionDir('product-requirements'), { recursive: true });
  fs.mkdirSync(sessionDir('research'), { recursive: true });
  fs.mkdirSync(sessionDir('tech-design'), { recursive: true });
  fs.mkdirSync(sessionDir('tasks'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('context artifact order', () => {
  it('CTX-01 renders the fixed runtime header before any artifact block', async () => {
    fs.writeFileSync(sessionDir('research', 'README.md'), '# Research');
    const md = await buildContextMarkdown(tmpDir, baseSession, makeConfig({
      artifacts: ['research'],
    }));

    expect(md.indexOf('## Current session')).toBeGreaterThan(-1);
    expect(md.indexOf('## Current session')).toBeLessThan(md.indexOf('## Research'));
  });

  it('CTX-02 renders artifact blocks in the declared context.artifacts order', async () => {
    fs.writeFileSync(sessionDir('product-requirements', 'prd.md'), '# PRD');
    fs.writeFileSync(sessionDir('research', 'README.md'), '# Research');

    const md = await buildContextMarkdown(tmpDir, baseSession, makeConfig({
      artifacts: ['research', 'product-requirement'],
    }));

    expect(md.indexOf('## Research')).toBeLessThan(md.indexOf('## Product Requirements'));
  });

  it('CTX-03 falls back to the built-in artifact order when context.artifacts is omitted', async () => {
    fs.writeFileSync(sessionDir('product-requirements', 'prd.md'), '# PRD');
    fs.writeFileSync(sessionDir('research', 'README.md'), '# Research');
    fs.writeFileSync(sessionDir('tech-design', 'summary.md'), '# Design');

    const md = await buildContextMarkdown(tmpDir, baseSession, makeConfig());

    expect(md.indexOf('## Product Requirements')).toBeLessThan(md.indexOf('## Research'));
    expect(md.indexOf('## Research')).toBeLessThan(md.indexOf('## Technical Design'));
  });

  it('CTX-04 lets a custom artifact plugin participate in context generation when ordered explicitly', async () => {
    writeArtifactPlugin(
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
    fs.mkdirSync(sessionDir('dev'), { recursive: true });
    fs.writeFileSync(sessionDir('dev', 'plan.md'), '# Plan');

    const md = await buildContextMarkdown(tmpDir, baseSession, makeConfig({
      artifacts: ['dev-plan', 'research'],
    }));

    expect(md.indexOf('## Development Plan')).toBeLessThan(md.indexOf('## Research'));
    expect(md).toContain('.dojo/sessions/ctx-session/dev/plan.md');
  });

  it('CTX-05 the research artifact prefers README.md, index.md, or summary.md as the primary document', async () => {
    fs.writeFileSync(sessionDir('research', 'README.md'), '# Main');
    fs.writeFileSync(sessionDir('research', 'notes.md'), '# Notes');

    const md = await buildContextMarkdown(tmpDir, baseSession, makeConfig({
      artifacts: ['research'],
    }));

    expect(md).toContain('Primary document: .dojo/sessions/ctx-session/research/README.md');
    expect(md).toContain('.dojo/sessions/ctx-session/research/notes.md');
  });

  it('CTX-06 the tasks artifact renders manifest order and completion status', async () => {
    fs.mkdirSync(sessionDir('tasks', 'auth-refactor'), { recursive: true });
    fs.mkdirSync(sessionDir('tasks', 'oauth-gateway'), { recursive: true });
    fs.writeFileSync(sessionDir('tasks', 'manifest.json'), JSON.stringify({
      tasks: [
        { name: 'auth-refactor', description: 'Refactor auth flow', depends_on: [] },
        { name: 'oauth-gateway', description: 'Add oauth gateway', depends_on: ['auth-refactor'] },
      ],
    }));
    fs.writeFileSync(sessionDir('tasks', 'auth-refactor', 'state.json'), JSON.stringify({ is_completed: true }));
    fs.writeFileSync(sessionDir('tasks', 'oauth-gateway', 'state.json'), JSON.stringify({ is_completed: false }));

    const md = await buildContextMarkdown(tmpDir, baseSession, makeConfig({
      artifacts: ['tasks'],
    }));

    expect(md).toContain('| 1 | auth-refactor | Refactor auth flow | - | Done |');
    expect(md).toContain('| 2 | oauth-gateway | Add oauth gateway | auth-refactor | Todo |');
  });

  it('CTX-07 handles empty artifact directories with a consistent empty-state policy', async () => {
    const md = await buildContextMarkdown(tmpDir, baseSession, makeConfig({
      artifacts: ['research'],
    }));

    expect(md).toContain('## Research');
    expect(md).toContain('No files yet.');
  });
});
