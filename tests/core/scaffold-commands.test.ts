import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeConfig } from '../../src/core/config.js';
import { createTemplateScaffold, lintTemplates } from '../../src/commands/template.js';
import { createArtifactScaffold } from '../../src/commands/artifact.js';
import type { WorkspaceConfig } from '../../src/types.js';

let tmpDir: string;

const baseConfig: WorkspaceConfig = {
  workspace: { name: 'scaffold-test', description: 'Scaffold test workspace' },
  agents: ['codex'],
  repos: [],
  context: {
    artifacts: ['product-requirement', 'research', 'tech-design', 'tasks'],
  },
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-scaffold-'));
  fs.mkdirSync(path.join(tmpDir, '.dojo', 'commands'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.dojo', 'artifacts'), { recursive: true });
  writeConfig(tmpDir, baseConfig);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('scaffold commands', () => {
  it('creates a template scaffold with current Dojo syntax', async () => {
    const filePath = await createTemplateScaffold(tmpDir, 'dev-plan', {
      reads: ['research', 'tasks'],
      output: 'tech-design',
      scope: 'mixed',
      description: 'Create a development plan.',
      argumentHint: '[scope / constraints]',
    });

    const content = fs.readFileSync(filePath, 'utf-8');
    expect(path.basename(filePath)).toBe('dojo-dev-plan.md');
    expect(content).toContain('---');
    expect(content).toContain('description: "Create a development plan."');
    expect(content).toContain('argument-hint: "[scope / constraints]"');
    expect(content).toContain('scope: mixed');
    expect(content).toContain('<dojo_read_block artifacts="research,tasks" />');
    expect(content).toContain('<dojo_write_block artifact="tech-design" />');
    expect(content).toContain('Write outputs under `${artifact_dir:tech-design}`.');

    const lint = await lintTemplates(tmpDir, 'dojo-dev-plan');
    expect(lint.issues).toEqual([]);
  });

  it('creates an artifact scaffold with a session-scoped directory by default', async () => {
    const filePath = await createArtifactScaffold(tmpDir, 'dev-plan');

    const content = fs.readFileSync(filePath, 'utf-8');
    expect(path.basename(filePath)).toBe('dev-plan.ts');
    expect(content).toContain("import type { ArtifactPlugin } from '../types/dojo-artifact-plugin';");
    expect(content).toContain("id: 'dev-plan'");
    expect(content).toContain("scope: 'session'");
    expect(content).toContain("dir: '.dojo/sessions/${session_id}/dev-plan'");
    expect(content).toContain("const files = helpers.listMarkdownFiles(dir);");
  });

  it('creates a derived artifact scaffold when requested', async () => {
    const filePath = await createArtifactScaffold(tmpDir, 'risk-summary', {
      derived: true,
      description: 'Derived risk summary.',
    });

    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain("dir: null");
    expect(content).toContain("description: 'Derived risk summary.'");
    expect(content).toContain('## Risk Summary');
  });

  it('creates a JavaScript artifact scaffold when explicitly requested', async () => {
    const filePath = await createArtifactScaffold(tmpDir, 'legacy-artifact', {
      language: 'js',
    });

    const content = fs.readFileSync(filePath, 'utf-8');
    expect(path.basename(filePath)).toBe('legacy-artifact.js');
    expect(content).not.toContain("import type { ArtifactPlugin }");
    expect(content).toContain("id: 'legacy-artifact'");
  });

  it('does not overwrite an existing template or artifact scaffold without force', async () => {
    await createTemplateScaffold(tmpDir, 'review');
    await createArtifactScaffold(tmpDir, 'review-notes');

    await expect(createTemplateScaffold(tmpDir, 'review')).rejects.toThrow(/Template already exists/);
    await expect(createArtifactScaffold(tmpDir, 'review-notes')).rejects.toThrow(/Artifact plugin already exists/);
  });
});
