import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { distributeCommands } from '../../src/core/command-distributor.js';
import {
  getTemplateScope,
  loadArtifactPlugins,
  validateTemplateArtifactRefs,
} from '../../src/core/protocol.js';
import { writeConfig } from '../../src/core/config.js';
import type { WorkspaceConfig } from '../../src/types.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const builtInCommandsDir = path.join(repoRoot, 'src', 'starter', 'commands');

let tmpDir: string;

const baseConfig: WorkspaceConfig = {
  workspace: { name: 'builtins', description: 'Built-in template verification' },
  agents: ['claude-code'],
  repos: [],
  context: {
    artifacts: ['product-requirement', 'research', 'tech-design', 'tasks', 'workspace-doc'],
  },
};

function copyBuiltInTemplates(targetDir: string): string[] {
  const files = fs.readdirSync(builtInCommandsDir).filter(file => file.endsWith('.md'));
  for (const file of files) {
    fs.copyFileSync(path.join(builtInCommandsDir, file), path.join(targetDir, file));
  }
  return files;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-builtins-'));
  fs.mkdirSync(path.join(tmpDir, '.dojo', 'commands'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.agents', 'commands'), { recursive: true });
  writeConfig(tmpDir, baseConfig);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('built-in templates and artifacts', () => {
  it('loads the built-in artifact plugins for original Dojo outputs', async () => {
    const plugins = await loadArtifactPlugins(tmpDir);

    expect(Object.keys(plugins)).toEqual(expect.arrayContaining([
      'product-requirement',
      'research',
      'tech-design',
      'tasks',
      'workspace-doc',
    ]));
  });

  it('validates every built-in command template against the artifact-plugin runtime', async () => {
    const files = fs.readdirSync(builtInCommandsDir).filter(file => file.endsWith('.md'));

    for (const file of files) {
      const content = fs.readFileSync(path.join(builtInCommandsDir, file), 'utf-8');
      expect(content.startsWith('---\n')).toBe(true);
      expect(content).toContain('description:');
      expect(content).toContain('argument-hint:');
      expect(content).toContain('scope:');
      await expect(validateTemplateArtifactRefs(tmpDir, content)).resolves.toBeUndefined();
    }
  });

  it('materializes all built-in templates with an active session and expands Dojo syntax', async () => {
    const files = copyBuiltInTemplates(path.join(tmpDir, '.dojo', 'commands'));

    await distributeCommands(tmpDir, 'built-in-session', ['claude-code']);

    for (const file of files) {
      const rendered = fs.readFileSync(path.join(tmpDir, '.agents', 'commands', file), 'utf-8');
      expect(rendered).not.toContain('<dojo_read_block');
      expect(rendered).not.toContain('<dojo_write_block');
      expect(rendered).not.toContain('${artifact_dir:');
      expect(rendered).not.toContain('${artifact_description:');
      expect(rendered).not.toContain('${session_id}');
      expect(rendered).not.toContain('${dojo_current_session_id}');
    }

    const prd = fs.readFileSync(path.join(tmpDir, '.agents', 'commands', 'dojo-prd.md'), 'utf-8');
    expect(prd).toContain('.dojo/sessions/built-in-session/product-requirements');
    expect(prd).toContain('### Output Artifact');

    const design = fs.readFileSync(path.join(tmpDir, '.agents', 'commands', 'dojo-tech-design.md'), 'utf-8');
    expect(design).toContain('### Available Context');
    expect(design).toContain('.dojo/sessions/built-in-session/research');

    const genDoc = fs.readFileSync(path.join(tmpDir, '.agents', 'commands', 'dojo-gen-doc.md'), 'utf-8');
    expect(genDoc).toContain('### Output Artifact');
    expect(genDoc).toContain('Directory: `docs`');
  });

  it('materializes built-in templates in no-session mode without leaving unresolved syntax', async () => {
    copyBuiltInTemplates(path.join(tmpDir, '.dojo', 'commands'));

    await distributeCommands(tmpDir, null, ['claude-code']);

    const sessionBound = fs.readFileSync(path.join(tmpDir, '.agents', 'commands', 'dojo-prd.md'), 'utf-8');
    expect(getTemplateScope(sessionBound)).toBe('session');
    expect(sessionBound.startsWith('---\n')).toBe(true);
    expect(sessionBound).toContain('argument-hint: [feature / user problem / goal]');
    expect(sessionBound).toContain('No active session');
    expect(sessionBound).toContain('.dojo/sessions/no-active-session/product-requirements');
    expect(sessionBound).not.toContain('<dojo_write_block');

    const optional = fs.readFileSync(path.join(tmpDir, '.agents', 'commands', 'dojo-gen-doc.md'), 'utf-8');
    expect(getTemplateScope(optional)).toBe('mixed');
    expect(optional.startsWith('---\n')).toBe(true);
    expect(optional).toContain('description: Generate or update documentation from the workspace or active session.');
    expect(optional).not.toContain('Run `dojo session new` first.');
    expect(optional).not.toContain('<dojo_read_block');
    expect(optional).not.toContain('<dojo_write_block');
    expect(optional).toContain('docs');
  });
});
