import path from 'node:path';
import type {
  ArtifactPlugin,
  ArtifactPluginHelpers,
  SessionState,
  WorkspaceConfig,
} from '../types.js';
import {
  getContextArtifactOrder,
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
        .filter((file) => /\.(md|mdx)$/i.test(file))
        .map((file) => path.join(dir, file));
    },
    listDirs: (dir: string | null): string[] => {
      if (!dir || !fileExists(dir)) return [];
      return listDirs(dir).map((name) => path.join(dir, name));
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
        const found = files.find((file) => path.basename(file).toLowerCase() === preferredName.toLowerCase());
        if (found) return found;
      }
      return files[0] ?? null;
    },
  };
}

function renderHeader(session: SessionState | null, config: WorkspaceConfig): string {
  const lines: string[] = [];
  lines.push('# Workspace context');
  lines.push('');
  lines.push(session
    ? 'Startup and handoff context for the active Dojo session.'
    : 'Startup context for the workspace in baseline mode.');
  lines.push('');

  if (session) {
    lines.push('## Current session');
    lines.push(`- Session ID: ${session.id}`);
    lines.push(`- Status: ${session.status}`);
    lines.push(`- Description: ${session.description}`);
    if (session.external_link) {
      lines.push(`- Link: ${session.external_link}`);
    }
    lines.push(`- Artifact root: .dojo/sessions/${session.id}/`);
  } else {
    lines.push('## Current mode');
    lines.push('- Mode: baseline');
    lines.push('- No active session');
    lines.push('- Session-scoped commands are hidden in this mode');
  }
  lines.push('');

  if (config.repos.length > 0) {
    lines.push('## Registered repositories');
    lines.push('| Repo | Type | Path | Git | Description |');
    lines.push('|------|------|------|-----|-------------|');
    for (const repo of config.repos) {
      lines.push(`| ${repo.name} | ${repo.type} | ${repo.path} | ${repo.git} | ${repo.description?.trim() ? repo.description : '-'} |`);
    }
    lines.push('');
  }

  lines.push('## Context notes');
  lines.push('- This file is startup and handoff context, not a live mirror.');
  lines.push(session
    ? '- Session-scoped artifact paths point at the active session directory.'
    : '- Workspace-scoped and mixed artifacts may still be relevant in baseline mode.');
  lines.push('');
  return lines.join('\n');
}

export async function buildContextMarkdown(
  root: string,
  session: SessionState | null,
  config: WorkspaceConfig,
): Promise<string> {
  await validateContextArtifacts(root, config);
  const plugins = await loadArtifactPlugins(root);
  const blocks: string[] = [renderHeader(session, config)];

  if (!session) {
    const baselineSession: SessionState = {
      id: 'baseline',
      description: 'Baseline workspace mode',
      created_at: '',
      updated_at: '',
      status: 'suspended',
    };
    const helpers = buildHelpers(root, config, baselineSession, plugins);

    for (const artifactId of getContextArtifactOrder(config, plugins)) {
      const artifact = plugins[artifactId];
      if (!artifact || !['workspace', 'mixed'].includes(artifact.scope)) continue;
      const relDir = resolveArtifactDir(artifact, {
        sessionId: null,
        noSessionPlaceholder: 'baseline',
        workspaceName: config.workspace.name,
        workspaceDescription: config.workspace.description,
      });
      const absDir = relDir ? path.join(root, relDir) : null;
      const block = await artifact.renderContext({
        root,
        config,
        session: baselineSession,
        artifact,
        dir: absDir,
        helpers,
      });
      if (block?.trim()) {
        blocks.push(block.trim());
      }
    }

    return blocks.join('\n\n') + '\n';
  }

  const helpers = buildHelpers(root, config, session, plugins);
  for (const artifactId of getContextArtifactOrder(config, plugins)) {
    const artifact = plugins[artifactId];
    if (!artifact) continue;
    if (!['workspace', 'mixed', 'session'].includes(artifact.scope)) continue;
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
    if (block?.trim()) {
      blocks.push(block.trim());
    }
  }

  return blocks.join('\n\n') + '\n';
}

export async function generateContext(
  root: string,
  session: SessionState | null,
  config: WorkspaceConfig,
): Promise<void> {
  const content = await buildContextMarkdown(root, session, config);
  writeText(path.join(root, '.dojo', 'context.md'), content);
}
