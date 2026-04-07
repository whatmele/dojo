import path from 'node:path';
import { DOJO_DIR } from '../types.js';
import type {
  ArtifactPlugin,
  ArtifactPluginHelpers,
  SessionState,
  WorkspaceConfig,
} from '../types.js';
import {
  getContextArtifactOrder,
  getContextConfig,
  loadArtifactPlugins,
  resolveArtifactDir,
  validateContextArtifacts,
} from './protocol.js';
import { fileExists, listDirs, listFiles, readJSON, readText, writeText } from '../utils/fs.js';

function normalizeSlashes(value: string): string {
  return value.split(path.sep).join('/');
}

function buildHelpers(root: string, config: WorkspaceConfig, session: SessionState, plugins: Record<string, ArtifactPlugin>): ArtifactPluginHelpers {
  return {
    resolveArtifactDir: (id: string): string | null => {
      const artifact = plugins[id];
      if (!artifact) return null;
      const rel = resolveArtifactDir(artifact, {
        sessionId: session.id,
        workspaceName: config.workspace.name,
        workspaceDescription: config.workspace.description,
      });
      return rel ? path.join(root, rel) : null;
    },
    listMarkdownFiles: (dir: string | null): string[] => {
      if (!dir || !fileExists(dir)) return [];
      return listFiles(dir)
        .filter(file => /\.(md|mdx)$/i.test(file))
        .map(file => path.join(dir, file));
    },
    listDirs: (dir: string | null): string[] => {
      if (!dir || !fileExists(dir)) return [];
      return listDirs(dir).map(name => path.join(dir, name));
    },
    readText: (filePath: string, maxChars = 1200): string => {
      if (!filePath || !fileExists(filePath)) return '';
      return readText(filePath).slice(0, maxChars);
    },
    readJSON: <T>(filePath: string): T | null => {
      if (!filePath || !fileExists(filePath)) return null;
      try {
        return readJSON<T>(filePath);
      } catch {
        return null;
      }
    },
    relative: (filePath: string): string => normalizeSlashes(path.relative(root, filePath)),
    pickPreferred: (files: string[], preferredNames: string[]): string | null => {
      for (const preferredName of preferredNames) {
        const found = files.find(file => path.basename(file).toLowerCase() === preferredName.toLowerCase());
        if (found) return found;
      }
      return files[0] ?? null;
    },
  };
}

function renderHeader(session: SessionState, config: WorkspaceConfig): string {
  const lines: string[] = [];
  lines.push('# Workspace context');
  lines.push('');
  lines.push('Startup and handoff context for the active Dojo session.');
  lines.push('');
  lines.push(`This workspace is working on: **${session.description}**`);
  lines.push('');
  lines.push('## Current session');
  lines.push(`- Session ID: ${session.id}`);
  lines.push(`- Status: ${session.status}`);
  if (session.workspace_branch) {
    lines.push(`- Workspace branch: ${session.workspace_branch}`);
  }
  if (session.external_link) {
    lines.push(`- Link: ${session.external_link}`);
  }
  lines.push('');

  const branchEntries = Object.entries(session.repo_branches);
  if (branchEntries.length > 0) {
    lines.push('## Repositories');
    lines.push('| Repo | Type | Branch |');
    lines.push('|------|------|--------|');
    for (const [repoName, branch] of branchEntries) {
      const repo = config.repos.find(r => r.name === repoName);
      lines.push(`| ${repoName} | ${repo?.type ?? 'unknown'} | ${branch} |`);
    }
    lines.push('');
  }

  lines.push('## Context notes');
  lines.push('- This file is startup and handoff context, not a live mirror.');
  lines.push('- Read the referenced artifact directories for full detail.');
  lines.push('');
  return lines.join('\n');
}

export async function buildContextMarkdown(
  root: string,
  session: SessionState,
  config: WorkspaceConfig,
): Promise<string> {
  await validateContextArtifacts(root, config);
  const plugins = await loadArtifactPlugins(root);
  const helpers = buildHelpers(root, config, session, plugins);
  const blocks: string[] = [renderHeader(session, config)];

  for (const artifactId of getContextArtifactOrder(config, plugins)) {
    const artifact = plugins[artifactId];
    if (!artifact) continue;

    const relDir = resolveArtifactDir(artifact, {
      sessionId: session.id,
      workspaceName: config.workspace.name,
      workspaceDescription: config.workspace.description,
    });
    const absDir = relDir ? path.join(root, relDir) : null;
    const block = await artifact.renderContext({
      root,
      config,
      session,
      artifact,
      dir: absDir,
      helpers,
    });
    if (!block) continue;
    const trimmed = block.trim();
    if (!trimmed) continue;
    blocks.push(trimmed);
  }

  return blocks.join('\n\n') + '\n';
}

export async function generateContext(
  root: string,
  session: SessionState,
  config: WorkspaceConfig,
): Promise<void> {
  const content = await buildContextMarkdown(root, session, config);
  writeText(path.join(root, DOJO_DIR, 'context.md'), content);
}
