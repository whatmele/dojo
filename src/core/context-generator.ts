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
  loadArtifactPlugins,
  resolveArtifactDir,
  validateContextArtifacts,
} from './protocol.js';
import { fileExists, listDirs, listFiles, readJSON, readText, writeText } from '../utils/fs.js';
import { getWorkspaceRootBaselineBranch } from './baseline.js';
import { reconcileWorkspaceState } from './session-reconciler.js';
import { normalizeSessionState } from './target-state.js';

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

function renderHeader(
  session: SessionState | null,
  config: WorkspaceConfig,
  reconciliation: Awaited<ReturnType<typeof reconcileWorkspaceState>>,
): string {
  const lines: string[] = [];
  lines.push('# Workspace context');
  lines.push('');
  lines.push(session
    ? 'Startup and handoff context for the active Dojo session.'
    : 'Startup context for the workspace in no-session mode.');
  lines.push('');
  if (session) {
    lines.push(`This workspace is working on: **${session.description}**`);
    lines.push('');
    lines.push('## Current session');
    lines.push(`- Session ID: ${session.id}`);
    lines.push(`- Status: ${session.status}`);
    lines.push(`- Session health: ${reconciliation.overall}`);
    lines.push(`- Workspace root target branch: ${session.workspace_root?.target_branch ?? getWorkspaceRootBaselineBranch(config)}`);
    if (session.external_link) {
      lines.push(`- Link: ${session.external_link}`);
    }
  } else {
    lines.push('No active session.');
    lines.push('');
    lines.push('## Current mode');
    lines.push('- Mode: no-session');
    lines.push(`- Workspace root baseline branch: ${getWorkspaceRootBaselineBranch(config)}`);
    lines.push(`- Workspace health: ${reconciliation.overall}`);
  }
  lines.push('');

  lines.push('## Workspace root');
  lines.push('| Expected | Current | Dirty | Status |');
  lines.push('|----------|---------|-------|--------|');
  lines.push(`| ${reconciliation.root.expected_branch} | ${reconciliation.root.current_branch ?? '-'} | ${reconciliation.root.dirty ? 'Yes' : 'No'} | ${reconciliation.root.status} |`);
  lines.push('');

  if (reconciliation.repos.length > 0) {
    lines.push('## Repositories');
    lines.push('| Repo | Type | Expected | Current | Dirty | Status |');
    lines.push('|------|------|----------|---------|-------|--------|');
    for (const item of reconciliation.repos) {
      const repo = config.repos.find(r => r.name === item.name);
      lines.push(`| ${item.name} | ${repo?.type ?? 'unknown'} | ${item.expected_branch} | ${item.current_branch ?? '-'} | ${item.dirty ? 'Yes' : 'No'} | ${item.status} |`);
    }
    lines.push('');
  }

  if (reconciliation.blocking_issues.length > 0) {
    lines.push('## Blocking issues');
    for (const issue of reconciliation.blocking_issues) {
      lines.push(`- ${issue}`);
    }
    lines.push('');
  }

  lines.push('## Context notes');
  lines.push('- This file is startup and handoff context, not a live mirror.');
  lines.push(session
    ? '- Read the referenced artifact directories for full detail.'
    : '- No session artifacts are active in this mode; workspace docs may still be relevant.');
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
  const normalized = session ? normalizeSessionState(session, config) : null;
  const reconciliation = await reconcileWorkspaceState(root, config, normalized);
  const blocks: string[] = [renderHeader(normalized, config, reconciliation)];

  if (!normalized) {
    for (const artifactId of getContextArtifactOrder(config, plugins)) {
      const artifact = plugins[artifactId];
      if (!artifact || !['workspace', 'mixed'].includes(artifact.scope)) continue;
      const relDir = resolveArtifactDir(artifact, {
        sessionId: null,
        workspaceName: config.workspace.name,
        workspaceDescription: config.workspace.description,
      });
      const absDir = relDir ? path.join(root, relDir) : null;
      const helperSession = {
        id: 'baseline',
        description: 'Baseline workspace mode',
        created_at: '',
        status: 'suspended',
        workspace_root: {
          target_branch: getWorkspaceRootBaselineBranch(config),
          base_branch: getWorkspaceRootBaselineBranch(config),
          branch_source: 'existing',
        },
        repos: [],
      } satisfies SessionState;
      const helpers = buildHelpers(root, config, helperSession, plugins);
      const block = await artifact.renderContext({
        root,
        config,
        session: helperSession,
        artifact,
        dir: absDir,
        helpers,
      });
      if (!block?.trim()) continue;
      blocks.push(block.trim());
    }
    return blocks.join('\n\n') + '\n';
  }

  const helpers = buildHelpers(root, config, normalized, plugins);

  for (const artifactId of getContextArtifactOrder(config, plugins)) {
    const artifact = plugins[artifactId];
    if (!artifact) continue;
    if (artifact.scope === 'workspace' || artifact.scope === 'mixed' || artifact.scope === 'session') {
      // allowed in active session mode
    } else {
      continue;
    }

    const relDir = resolveArtifactDir(artifact, {
      sessionId: normalized.id,
      workspaceName: config.workspace.name,
      workspaceDescription: config.workspace.description,
    });
    const absDir = relDir ? path.join(root, relDir) : null;
    const block = await artifact.renderContext({
      root,
      config,
      session: normalized,
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
  session: SessionState | null,
  config: WorkspaceConfig,
): Promise<void> {
  const content = await buildContextMarkdown(root, session, config);
  writeText(path.join(root, DOJO_DIR, 'context.md'), content);
}
