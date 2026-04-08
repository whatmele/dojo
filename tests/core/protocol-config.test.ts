import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readConfig, writeConfig } from '../../src/core/config.js';
import {
  extractTemplateArtifactRefs,
  getArtifactDescription,
  getContextArtifactOrder,
  resolveArtifactDirById,
  validateContextArtifacts,
  validateTemplateArtifactRefs,
  loadArtifactPlugins,
} from '../../src/core/protocol.js';
import type { WorkspaceConfig } from '../../src/types.js';

let tmpDir: string;

const baseConfig: WorkspaceConfig = {
  workspace: { name: 'proto-test', description: 'Protocol test workspace' },
  agents: ['codex'],
  repos: [],
  context: {
    artifacts: ['research', 'dev-plan'],
  },
};

function writeArtifactPlugin(fileName: string, source: string): void {
  const dir = path.join(tmpDir, '.dojo', 'artifacts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), source);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-test-proto-'));
  fs.mkdirSync(path.join(tmpDir, '.dojo'), { recursive: true });
  writeArtifactPlugin(
    'dev-plan.js',
    `export default {
      id: 'dev-plan',
      scope: 'session',
      dir: '.dojo/sessions/\${session_id}/dev',
      description: 'Development plan docs.',
      async renderContext() {
        return '## Development Plan\\n\\n- No files yet.';
      },
    };`,
  );
  writeConfig(tmpDir, baseConfig);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('protocol config and template contracts', () => {
  it('CFG-01 reads and writes context.artifacts without data loss', () => {
    const config = readConfig(tmpDir);
    expect(config.context?.artifacts).toEqual(['research', 'dev-plan']);
  });

  it('CFG-02 validates context.artifacts when every artifact id is known', async () => {
    await expect(validateContextArtifacts(tmpDir, baseConfig)).resolves.toBeUndefined();
  });

  it('CFG-03 rejects context.artifacts entries that do not resolve to an artifact plugin', async () => {
    const badConfig: WorkspaceConfig = {
      ...baseConfig,
      context: {
        artifacts: ['research', 'not-real'],
      },
    };

    await expect(validateContextArtifacts(tmpDir, badConfig)).rejects.toThrow(/Unknown artifact id in context\.artifacts: not-real/);
  });

  it('CFG-04 extracts artifact references from template directives and placeholders', () => {
    const refs = extractTemplateArtifactRefs([
      '<dojo_read_block artifacts="research,tasks" />',
      '<dojo_write_block artifact="tech-design" />',
      'Dir: ${artifact_dir:dev-plan}',
      'Desc: ${artifact_description:research}',
    ].join('\n'));

    expect(refs.reads).toEqual(['research', 'tasks']);
    expect(refs.writes).toEqual(['tech-design']);
    expect(refs.placeholders).toEqual(['dev-plan', 'research']);
    expect(new Set(refs.all)).toEqual(new Set(['research', 'tasks', 'tech-design', 'dev-plan']));
  });

  it('CFG-05 validates templates that reference known artifact ids', async () => {
    const template = [
      '<dojo_read_block artifacts="research,dev-plan" />',
      '<dojo_write_block artifact="tech-design" />',
      'Output: ${artifact_dir:dev-plan}',
    ].join('\n');

    await expect(validateTemplateArtifactRefs(tmpDir, template)).resolves.toBeUndefined();
  });

  it('CFG-06 rejects templates that reference unknown artifact ids', async () => {
    const template = 'Output: ${artifact_dir:not-registered}';
    await expect(validateTemplateArtifactRefs(tmpDir, template)).rejects.toThrow(/Unknown artifact id referenced in template: not-registered/);
  });

  it('CFG-07 resolves artifact directories and descriptions from artifact plugins', async () => {
    await expect(resolveArtifactDirById(tmpDir, baseConfig, 'dev-plan', { sessionId: 'sess-10' }))
      .resolves.toBe('.dojo/sessions/sess-10/dev');
    await expect(getArtifactDescription(tmpDir, 'dev-plan')).resolves.toBe('Development plan docs.');
  });

  it('CFG-08 orders explicit artifacts first, then built-ins, then extra plugins', async () => {
    writeArtifactPlugin(
      'zzz-extra.js',
      `export default {
        id: 'zzz-extra',
        scope: 'workspace',
        dir: null,
        description: 'Derived extra artifact.',
        async renderContext() {
          return '## Extra';
        },
      };`,
    );

    const plugins = await loadArtifactPlugins(tmpDir);
    const order = getContextArtifactOrder(baseConfig, plugins);

    expect(order.slice(0, 2)).toEqual(['research', 'dev-plan']);
    expect(order).toContain('product-requirement');
    expect(order).toContain('tech-design');
    expect(order).toContain('tasks');
    expect(order[order.length - 1]).toBe('zzz-extra');
  });

  it('CFG-09 loads workspace-local TypeScript artifact plugins', async () => {
    writeArtifactPlugin(
      'ts-plan.ts',
      [
        "import type { ArtifactPlugin } from '../types/dojo-artifact-plugin';",
        '',
        'const plugin: ArtifactPlugin = {',
        "  id: 'ts-plan',",
        "  scope: 'session',",
        "  dir: '.dojo/sessions/${session_id}/ts-plan',",
        "  description: 'TypeScript artifact plugin.',",
        '  async renderContext() {',
        "    return '## TS Plan\\n\\n- Ready';",
        '  },',
        '};',
        '',
        'export default plugin;',
      ].join('\n'),
    );

    const plugins = await loadArtifactPlugins(tmpDir);

    expect(plugins['ts-plan']).toBeDefined();
    await expect(resolveArtifactDirById(tmpDir, baseConfig, 'ts-plan', { sessionId: 'sess-ts' }))
      .resolves.toBe('.dojo/sessions/sess-ts/ts-plan');
  });

  it('CFG-10 normalizes workspace-local JavaScript plugins into cached .mjs modules before import', async () => {
    writeArtifactPlugin(
      'cache-check.js',
      `export default {
        id: 'cache-check',
        scope: 'workspace',
        dir: null,
        description: 'Cache normalization check.',
        async renderContext() {
          return '## Cache Check';
        },
      };`,
    );

    const plugins = await loadArtifactPlugins(tmpDir);
    const cacheDir = path.join(os.tmpdir(), 'dojo-artifact-plugin-cache');
    const cachedFiles = fs.existsSync(cacheDir)
      ? fs.readdirSync(cacheDir).filter((file) => file.startsWith('cache-check-') && file.endsWith('.mjs'))
      : [];

    expect(plugins['cache-check']).toBeDefined();
    expect(cachedFiles.length).toBeGreaterThan(0);
  });
});
