import { Command } from 'commander';
import path from 'node:path';
import { findWorkspaceRoot } from '../core/workspace.js';
import { loadArtifactPlugins } from '../core/protocol.js';
import { DOJO_DIR } from '../types.js';
import { ensureDir, fileExists, writeText } from '../utils/fs.js';
import { log } from '../utils/logger.js';

export interface ArtifactCreateOptions {
  dir?: string;
  derived?: boolean;
  description?: string;
  force?: boolean;
  language?: 'ts' | 'js';
  scope?: 'workspace' | 'session' | 'mixed';
}

function normalizeSlashes(value: string): string {
  return value.split(path.sep).join('/');
}

function humanizeId(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeArtifactId(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function defaultArtifactDir(id: string): string {
  return `.dojo/sessions/\${session_id}/${id}`;
}

function buildArtifactObjectBody(id: string, options: ArtifactCreateOptions): string {
  const heading = humanizeId(id);
  const scope = options.scope ?? 'session';
  const dirValue = options.derived
    ? 'null'
    : `'${(options.dir?.trim() || defaultArtifactDir(id)).replace(/'/g, "\\'")}'`;
  const description = (options.description ?? `${heading} artifact.`).replace(/'/g, "\\'");

  return [
    `  id: '${id}',`,
    `  scope: '${scope}',`,
    `  dir: ${dirValue},`,
    `  description: '${description}',`,
    '',
    '  async renderContext({ dir, helpers }) {',
    options.derived
      ? `    return '## ${heading}\\n\\n- Add context rendering for this derived artifact.';`
      : [
          '    const files = helpers.listMarkdownFiles(dir);',
          "    if (files.length === 0) return null;",
          '',
          `    const lines = ['## ${heading}', ''];`,
          '    for (const file of files) {',
          "      lines.push(`- ${helpers.relative(file)}`);",
          '    }',
          '',
          "    return lines.join('\\n');",
        ].join('\n'),
    '  },',
  ].join('\n');
}

function buildArtifactScaffold(
  id: string,
  options: ArtifactCreateOptions,
): string {
  const body = buildArtifactObjectBody(id, options);

  if ((options.language ?? 'ts') === 'ts') {
    return [
      "import type { ArtifactPlugin } from '../types/dojo-artifact-plugin';",
      '',
      'const plugin: ArtifactPlugin = {',
      body,
      '};',
      '',
      'export default plugin;',
      '',
    ].join('\n');
  }

  return [
    'export default {',
    body,
    '};',
    '',
  ].join('\n');
}

export async function createArtifactScaffold(
  root: string,
  id: string,
  options: ArtifactCreateOptions = {},
): Promise<string> {
  const normalizedId = normalizeArtifactId(id);
  if (!normalizedId) {
    throw new Error('Artifact id cannot be empty.');
  }

  const plugins = await loadArtifactPlugins(root);
  const language = options.language ?? 'ts';
  const extension = language === 'ts' ? 'ts' : 'js';
  const targetPath = path.join(root, DOJO_DIR, 'artifacts', `${normalizedId}.${extension}`);

  if ((plugins[normalizedId] || fileExists(targetPath)) && !options.force) {
    throw new Error(`Artifact plugin already exists: ${normalizedId}`);
  }

  ensureDir(path.dirname(targetPath));
  writeText(targetPath, buildArtifactScaffold(normalizedId, options));
  return targetPath;
}

export function registerArtifactCommand(program: Command): void {
  const artifact = program
    .command('artifact')
    .description('Artifact plugin management');

  artifact
    .command('create <id>')
    .description('Create an artifact plugin scaffold')
    .option('--dir <dir-template>', 'Artifact directory template, for example .dojo/sessions/${session_id}/dev')
    .option('--derived', 'Create a derived artifact plugin with no fixed directory')
    .option('--scope <scope>', 'Artifact scope: workspace, session, or mixed')
    .option('--description <text>', 'Artifact description used in template expansion')
    .option('--js', 'Create a JavaScript plugin instead of the default TypeScript plugin')
    .option('--force', 'Overwrite an existing artifact plugin')
    .action(async (
      id: string,
      opts: { dir?: string; derived?: boolean; scope?: 'workspace' | 'session' | 'mixed'; description?: string; js?: boolean; force?: boolean },
    ) => {
      const root = findWorkspaceRoot();
      const filePath = await createArtifactScaffold(root, id, {
        dir: opts.dir,
        derived: opts.derived,
        scope: opts.scope,
        description: opts.description,
        language: opts.js ? 'js' : 'ts',
        force: opts.force,
      });
      log.success(`Artifact scaffold created: ${normalizeSlashes(path.relative(root, filePath))}`);
      log.info('Update the renderContext() block to match the artifact you want to expose.');
      if (!opts.js) {
        log.info('Type helpers are available in `.dojo/types/dojo-artifact-plugin.d.ts`.');
      }
    });
}
