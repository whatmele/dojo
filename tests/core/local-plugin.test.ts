import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildContextMarkdown } from '../../src/core/context-generator.js';
import type { SessionState, WorkspaceConfig } from '../../src/types.js';

let tmpDir: string;

const session: SessionState = {
  id: 'plugin-session',
  description: 'Artifact plugin validation',
  created_at: '2026-04-07T00:00:00Z',
  status: 'active',
  workspace_branch: 'feature/plugin-session',
  repo_branches: {},
};

function writeArtifact(name: string, source: string): void {
  const pluginDir = path.join(tmpDir, '.dojo', 'artifacts');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, name), source);
}

function makeConfig(context?: WorkspaceConfig['context']): WorkspaceConfig {
  return {
    workspace: { name: 'plugin-ws', description: 'Plugin workspace' },
    agents: ['codex'],
    repos: [],
    ...(context ? { context } : {}),
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-test-plugin-'));
  fs.mkdirSync(path.join(tmpDir, '.dojo', 'sessions', session.id, 'research'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, '.dojo', 'sessions', session.id, 'research', 'README.md'), '# Research');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('artifact plugins', () => {
  it('PLG-01 loads a workspace-local artifact plugin and emits its context block', async () => {
    writeArtifact('risk-summary.js', `export default {
      id: 'risk-summary',
      scope: 'workspace',
      dir: null,
      description: 'Derived risk summary.',
      async renderContext() {
        return '## Risk Summary\\n\\n- Risk A';
      },
    };`);

    const md = await buildContextMarkdown(tmpDir, session, makeConfig({
      artifacts: ['risk-summary'],
    }));

    expect(md).toContain('## Risk Summary');
    expect(md).toContain('- Risk A');
  });

  it('PLG-02 lets a workspace-local artifact plugin override a built-in artifact by id', async () => {
    writeArtifact('research.js', `export default {
      id: 'research',
      scope: 'session',
      dir: '.dojo/sessions/\${session_id}/research',
      description: 'Overridden research renderer.',
      async renderContext() {
        return '## Research\\n\\n- Overridden by workspace plugin';
      },
    };`);

    const md = await buildContextMarkdown(tmpDir, session, makeConfig({
      artifacts: ['research'],
    }));

    expect(md).toContain('## Research');
    expect(md).toContain('Overridden by workspace plugin');
    expect(md).not.toContain('Primary document:');
  });

  it('PLG-03 skips a plugin cleanly when renderContext returns null', async () => {
    writeArtifact('skip.js', `export default {
      id: 'skip',
      scope: 'workspace',
      dir: null,
      async renderContext() {
        return null;
      },
    };`);

    const md = await buildContextMarkdown(tmpDir, session, makeConfig({
      artifacts: ['skip', 'research'],
    }));

    expect(md).not.toContain('## skip');
    expect(md).toContain('## Research');
  });

  it('PLG-04 supports derived artifacts with no fixed directory', async () => {
    writeArtifact('repo-summary.js', `export default {
      id: 'repo-summary',
      scope: 'workspace',
      dir: null,
      description: 'Workspace-derived repo summary.',
      async renderContext({ session }) {
        return '## Repo Summary\\n\\n- Session: ' + session.id;
      },
    };`);

    const md = await buildContextMarkdown(tmpDir, session, makeConfig({
      artifacts: ['repo-summary'],
    }));

    expect(md).toContain('## Repo Summary');
    expect(md).toContain('Session: plugin-session');
  });

  it('PLG-05 fails clearly when an artifact plugin throws', async () => {
    writeArtifact('explode.js', `export default {
      id: 'explode',
      scope: 'workspace',
      dir: null,
      async renderContext() {
        throw new Error('boom');
      },
    };`);

    await expect(buildContextMarkdown(tmpDir, session, makeConfig({
      artifacts: ['explode'],
    }))).rejects.toThrow(/boom/);
  });

  it('PLG-06 preserves plugin call order exactly as declared in context.artifacts', async () => {
    writeArtifact('first.js', `export default {
      id: 'first',
      scope: 'workspace',
      dir: null,
      async renderContext() {
        return '## First Plugin\\n\\n- A';
      },
    };`);
    writeArtifact('second.js', `export default {
      id: 'second',
      scope: 'workspace',
      dir: null,
      async renderContext() {
        return '## Second Plugin\\n\\n- B';
      },
    };`);

    const md = await buildContextMarkdown(tmpDir, session, makeConfig({
      artifacts: ['first', 'second'],
    }));

    expect(md.indexOf('## First Plugin')).toBeLessThan(md.indexOf('## Second Plugin'));
  });
});
