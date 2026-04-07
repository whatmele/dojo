import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lintTemplates } from '../../src/commands/template.js';
import { writeConfig } from '../../src/core/config.js';
import type { WorkspaceConfig } from '../../src/types.js';

let tmpDir: string;

const baseConfig: WorkspaceConfig = {
  workspace: { name: 'lint-test', description: 'Template lint test workspace' },
  agents: ['codex'],
  repos: [],
  context: {
    artifacts: ['product-requirement', 'research', 'tech-design', 'tasks'],
  },
};

function writeArtifactPlugin(fileName: string, source: string): void {
  const dir = path.join(tmpDir, '.dojo', 'artifacts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), source);
}

function writeTemplate(fileName: string, content: string): string {
  const dir = path.join(tmpDir, '.dojo', 'commands');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, content);
  return filePath;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-template-lint-'));
  fs.mkdirSync(path.join(tmpDir, '.dojo'), { recursive: true });
  writeConfig(tmpDir, baseConfig);
  writeArtifactPlugin(
    'dev-plan.js',
    `export default {
      id: 'dev-plan',
      scope: 'session',
      dir: '.dojo/sessions/\${session_id}/dev',
      description: 'Development plan docs.',
      async renderContext() {
        return '## Development Plan';
      },
    };`,
  );
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('template lint', () => {
  it('validates all templates when syntax and artifact references are correct', async () => {
    writeTemplate('dojo-good.md', [
      '<dojo_read_block artifacts="research,dev-plan" />',
      '<dojo_write_block artifact="tech-design" />',
      'Output dir: ${artifact_dir:dev-plan}',
      'Description: ${artifact_description:research}',
      '<!-- DOJO_SESSION_ONLY -->',
      'Session: ${session_id}',
      '<!-- /DOJO_SESSION_ONLY -->',
    ].join('\n'));

    const result = await lintTemplates(tmpDir);

    expect(result.filesChecked).toEqual(['.dojo/commands/dojo-good.md']);
    expect(result.issues).toEqual([]);
  });

  it('reports unknown artifact ids', async () => {
    writeTemplate('dojo-bad-artifact.md', 'Output: ${artifact_dir:not-real}');

    const result = await lintTemplates(tmpDir);

    expect(result.issues).toEqual([
      {
        file: '.dojo/commands/dojo-bad-artifact.md',
        message: 'Unknown artifact id referenced in template: not-real',
      },
    ]);
  });

  it('reports malformed directives and session markers', async () => {
    writeTemplate('dojo-bad-syntax.md', [
      '<dojo_read_block artifacts="research"',
      '<dojo_write_block artifact="tech-design,research" />',
      '<!-- /DOJO_SESSION_ONLY -->',
      '${artifact_description:research',
    ].join('\n'));

    const result = await lintTemplates(tmpDir);

    expect(result.issues).toEqual(expect.arrayContaining([
      {
        file: '.dojo/commands/dojo-bad-syntax.md',
        message: 'Malformed <dojo_read_block ... /> directive.',
      },
      {
        file: '.dojo/commands/dojo-bad-syntax.md',
        message: '<dojo_write_block ... /> must reference exactly one artifact id.',
      },
      {
        file: '.dojo/commands/dojo-bad-syntax.md',
        message: 'Malformed ${artifact_description:<id>} placeholder.',
      },
      {
        file: '.dojo/commands/dojo-bad-syntax.md',
        message: 'Unexpected DOJO_SESSION_ONLY closing marker.',
      },
    ]));
  });

  it('reports invalid frontmatter values for scope', async () => {
    writeTemplate('dojo-bad-frontmatter.md', [
      '---',
      'scope: project',
      '---',
      '',
      'Body',
    ].join('\n'));

    const result = await lintTemplates(tmpDir, 'dojo-bad-frontmatter');

    expect(result.issues).toEqual(expect.arrayContaining([
      {
        file: '.dojo/commands/dojo-bad-frontmatter.md',
        message: 'Invalid frontmatter value for scope. Use workspace, session, or mixed.',
      },
    ]));
  });

  it('rejects workspace-scoped templates that use session-only features', async () => {
    writeTemplate('dojo-workspace-bad.md', [
      '---',
      'scope: workspace',
      '---',
      '',
      '<dojo_read_block artifacts="research" />',
      '<!-- DOJO_SESSION_ONLY -->',
      'Session: ${session_id}',
      '<!-- /DOJO_SESSION_ONLY -->',
    ].join('\n'));

    const result = await lintTemplates(tmpDir, 'dojo-workspace-bad');

    expect(result.issues).toEqual(expect.arrayContaining([
      {
        file: '.dojo/commands/dojo-workspace-bad.md',
        message: 'Workspace-scoped templates may not reference non-workspace artifact id: research',
      },
      {
        file: '.dojo/commands/dojo-workspace-bad.md',
        message: 'Workspace-scoped templates may not use DOJO_SESSION_ONLY blocks.',
      },
      {
        file: '.dojo/commands/dojo-workspace-bad.md',
        message: 'Workspace-scoped templates may not use session placeholders.',
      },
    ]));
  });

  it('reports unclosed session blocks', async () => {
    writeTemplate('dojo-unclosed.md', [
      '<!-- DOJO_NO_SESSION_ONLY -->',
      'No session help',
    ].join('\n'));

    const result = await lintTemplates(tmpDir, 'dojo-unclosed');

    expect(result.issues).toEqual([
      {
        file: '.dojo/commands/dojo-unclosed.md',
        message: 'Unclosed DOJO_NO_SESSION_ONLY block.',
      },
    ]);
  });

  it('supports linting a single template by basename or direct path', async () => {
    const filePath = writeTemplate('dojo-one.md', '<dojo_write_block artifact="tech-design" />');
    writeTemplate('dojo-two.md', 'Output: ${artifact_dir:not-real}');

    const byName = await lintTemplates(tmpDir, 'dojo-one');
    expect(byName.filesChecked).toEqual(['.dojo/commands/dojo-one.md']);
    expect(byName.issues).toEqual([]);

    const byPath = await lintTemplates(tmpDir, filePath);
    expect(byPath.filesChecked).toEqual(['.dojo/commands/dojo-one.md']);
    expect(byPath.issues).toEqual([]);
  });
});
