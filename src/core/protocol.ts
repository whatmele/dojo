import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { DOJO_DIR } from '../types.js';
import type {
  ArtifactPlugin,
  ContextConfig,
  TemplateFrontmatter,
  TemplateScope,
  WorkspaceConfig,
} from '../types.js';
import { fileExists, listFiles } from '../utils/fs.js';
import { resolveBuiltInArtifactsDir } from './builtins.js';

export const DEFAULT_CONTEXT_ARTIFACTS = [
  'product-requirement',
  'research',
  'tech-design',
  'tasks',
  'workspace-doc',
];

const ARTIFACT_DIR_PLACEHOLDER = /\$\{artifact_dir:([^}]+)\}/g;
const ARTIFACT_DESCRIPTION_PLACEHOLDER = /\$\{artifact_description:([^}]+)\}/g;
const SESSION_ID_PLACEHOLDER = /\$\{session_id\}/g;
const LEGACY_SESSION_ID_PLACEHOLDER = /\$\{dojo_current_session_id\}/g;
const CONTEXT_PATH_PLACEHOLDER = /\$\{context_path\}/g;
const DOJO_READ_BLOCK_PATTERN = /<dojo_read_block\s+artifacts=(?:"([^"]+)"|\[([^\]]+)\])\s*\/>/g;
const DOJO_WRITE_BLOCK_PATTERN = /<dojo_write_block\s+artifact=(?:"([^"]+)"|([^\s/>]+))\s*\/>/g;
const SESSION_ONLY_START = '<!-- DOJO_SESSION_ONLY -->';
const SESSION_ONLY_END = '<!-- /DOJO_SESSION_ONLY -->';
const NO_SESSION_ONLY_START = '<!-- DOJO_NO_SESSION_ONLY -->';
const NO_SESSION_ONLY_END = '<!-- /DOJO_NO_SESSION_ONLY -->';
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function normalizeSlashes(value: string): string {
  return value.split(path.sep).join('/');
}

function replaceTemplateVars(
  template: string,
  values: Record<string, string>,
): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    const pattern = new RegExp(`\\$\\{${key}\\}`, 'g');
    out = out.replace(pattern, value);
  }
  return out;
}

function sanitizeArtifactPlugin(mod: unknown, sourceLabel: string): ArtifactPlugin {
  if (!mod || typeof mod !== 'object') {
    throw new Error(`Invalid artifact plugin from ${sourceLabel}`);
  }
  const plugin = mod as Partial<ArtifactPlugin>;
  if (!plugin.id || typeof plugin.id !== 'string') {
    throw new Error(`Artifact plugin missing string id: ${sourceLabel}`);
  }
  if (!plugin.scope || !['workspace', 'session', 'mixed'].includes(plugin.scope)) {
    throw new Error(`Artifact plugin "${plugin.id}" must provide scope as workspace, session, or mixed`);
  }
  if (!(typeof plugin.dir === 'string' || plugin.dir === null)) {
    throw new Error(`Artifact plugin "${plugin.id}" must provide dir as string or null`);
  }
  if (typeof plugin.renderContext !== 'function') {
    throw new Error(`Artifact plugin "${plugin.id}" must export renderContext()`);
  }
  return plugin as ArtifactPlugin;
}

async function importArtifactPlugin(filePath: string): Promise<ArtifactPlugin> {
  const stat = fs.statSync(filePath);
  const loadFromPath = async (candidatePath: string): Promise<ArtifactPlugin> => {
    const candidateStat = fs.statSync(candidatePath);
    const moduleUrl = `${pathToFileURL(candidatePath).href}?mtime=${stat.mtimeMs}-${candidateStat.mtimeMs}`;
    const mod = await import(moduleUrl);
    return sanitizeArtifactPlugin(mod.default, filePath);
  };

  const effectivePath = /\.(ts|mts)$/i.test(filePath)
    ? await transpileTypeScriptPlugin(filePath)
    : filePath;

  try {
    return await loadFromPath(effectivePath);
  } catch (error) {
    const shouldRetryAsMjs = /\.js$/i.test(filePath) && error instanceof SyntaxError;
    if (!shouldRetryAsMjs) {
      throw error;
    }

    // Workspace-local `.js` plugins are often authored with ESM `export default`.
    // Outside this package (where `type: module` is unknown), Node may parse
    // those files as CommonJS and throw a syntax error. Retry by loading an
    // `.mjs` copy so ESM syntax is interpreted consistently.
    const source = fs.readFileSync(filePath, 'utf8');
    const hash = crypto.createHash('sha1').update(filePath).digest('hex').slice(0, 8);
    const tempPath = path.join(
      os.tmpdir(),
      `dojo-plugin-js-${hash}-${process.pid}-${Date.now()}.mjs`,
    );
    fs.writeFileSync(tempPath, source);
    try {
      return await loadFromPath(tempPath);
    } finally {
      fs.rmSync(tempPath, { force: true });
    }
  }
}

async function loadArtifactPluginsFromDir(dirPath: string): Promise<Record<string, ArtifactPlugin>> {
  if (!fs.existsSync(dirPath)) return {};
  const entries = fs.readdirSync(dirPath)
    .filter(file => /\.(js|mjs|ts|mts)$/.test(file))
    .sort();
  const plugins: Record<string, ArtifactPlugin> = {};
  for (const file of entries) {
    const plugin = await importArtifactPlugin(path.join(dirPath, file));
    plugins[plugin.id] = plugin;
  }
  return plugins;
}

export async function loadArtifactPlugins(root: string): Promise<Record<string, ArtifactPlugin>> {
  const builtInDir = resolveBuiltInArtifactsDir();
  const workspaceDir = path.join(root, DOJO_DIR, 'artifacts');
  const builtIns = await loadArtifactPluginsFromDir(builtInDir);
  const workspace = await loadArtifactPluginsFromDir(workspaceDir);
  return {
    ...builtIns,
    ...workspace,
  };
}

export function getContextConfig(config: WorkspaceConfig): ContextConfig {
  return config.context ?? {};
}

export function splitTemplateFrontmatter(content: string): {
  frontmatter: string | null;
  body: string;
} {
  const match = content.match(FRONTMATTER_PATTERN);
  if (!match) {
    return { frontmatter: null, body: content };
  }

  return {
    frontmatter: match[0],
    body: content.slice(match[0].length),
  };
}

function parseFrontmatterValue(raw: string): string | boolean {
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return trimmed.replace(/^['"]|['"]$/g, '');
}

export function parseTemplateFrontmatter(content: string): TemplateFrontmatter {
  const match = content.match(FRONTMATTER_PATTERN);
  if (!match) return {};

  const lines = match[1].split(/\r?\n/);
  const parsed: Record<string, string | boolean> = {};
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1);
    if (!key) continue;
    parsed[key] = parseFrontmatterValue(value);
  }
  return parsed as TemplateFrontmatter;
}

export function getTemplateScope(content: string): TemplateScope {
  const frontmatter = parseTemplateFrontmatter(content);
  return frontmatter.scope ?? 'session';
}

export function parseArtifactIdList(raw: string): string[] {
  return raw
    .split(',')
    .map(part => part.trim())
    .map(part => part.replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

export function getContextArtifactOrder(
  config: WorkspaceConfig,
  plugins: Record<string, ArtifactPlugin>,
): string[] {
  const explicit = getContextConfig(config).artifacts ?? [];
  const result: string[] = [];
  const seen = new Set<string>();

  const push = (id: string): void => {
    if (!plugins[id] || seen.has(id)) return;
    seen.add(id);
    result.push(id);
  };

  for (const id of explicit) push(id);
  for (const id of DEFAULT_CONTEXT_ARTIFACTS) push(id);
  for (const id of Object.keys(plugins).sort()) push(id);

  return result;
}

export function resolveArtifactDir(
  artifact: ArtifactPlugin,
  options: {
    sessionId: string | null;
    workspaceName?: string;
    workspaceDescription?: string;
    noSessionPlaceholder?: string;
  },
): string | null {
  if (artifact.dir === null) return null;
  const sessionToken = options.sessionId ?? options.noSessionPlaceholder ?? '';
  return replaceTemplateVars(artifact.dir, {
    session_id: sessionToken,
    dojo_current_session_id: sessionToken,
    workspace_name: options.workspaceName ?? '',
    workspace_description: options.workspaceDescription ?? '',
    dojo_workspace_name: options.workspaceName ?? '',
    dojo_workspace_description: options.workspaceDescription ?? '',
  });
}

export async function resolveArtifactDirById(
  root: string,
  config: WorkspaceConfig,
  artifactId: string,
  options: {
    sessionId: string | null;
    noSessionPlaceholder?: string;
  },
): Promise<string | null> {
  const plugins = await loadArtifactPlugins(root);
  const artifact = plugins[artifactId];
  if (!artifact) {
    throw new Error(`Unknown artifact id: ${artifactId}`);
  }
  return resolveArtifactDir(artifact, {
    sessionId: options.sessionId,
    noSessionPlaceholder: options.noSessionPlaceholder,
    workspaceName: config.workspace.name,
    workspaceDescription: config.workspace.description,
  });
}

export async function getArtifactDescription(
  root: string,
  artifactId: string,
): Promise<string> {
  const plugins = await loadArtifactPlugins(root);
  const artifact = plugins[artifactId];
  if (!artifact) {
    throw new Error(`Unknown artifact id: ${artifactId}`);
  }
  return artifact.description ?? '';
}

export async function validateContextArtifacts(
  root: string,
  config: WorkspaceConfig,
): Promise<void> {
  const plugins = await loadArtifactPlugins(root);
  for (const id of getContextConfig(config).artifacts ?? []) {
    if (!plugins[id]) {
      throw new Error(`Unknown artifact id in context.artifacts: ${id}`);
    }
  }
}

async function transpileTypeScriptPlugin(filePath: string): Promise<string> {
  const ts = await import('typescript');
  const source = fs.readFileSync(filePath, 'utf-8');
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      isolatedModules: true,
      verbatimModuleSyntax: false,
    },
    fileName: filePath,
  });

  const hash = crypto
    .createHash('sha1')
    .update(filePath)
    .update(String(fs.statSync(filePath).mtimeMs))
    .digest('hex')
    .slice(0, 12);
  const cacheDir = path.join(os.tmpdir(), 'dojo-artifact-plugin-cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const outPath = path.join(cacheDir, `${path.basename(filePath).replace(/\.(ts|mts)$/i, '')}-${hash}.mjs`);
  fs.writeFileSync(outPath, result.outputText, 'utf-8');
  return outPath;
}

export function extractTemplateArtifactRefs(content: string): {
  reads: string[];
  writes: string[];
  placeholders: string[];
  all: string[];
} {
  const reads = new Set<string>();
  const writes = new Set<string>();
  const placeholders = new Set<string>();

  for (const match of content.matchAll(DOJO_READ_BLOCK_PATTERN)) {
    for (const id of parseArtifactIdList(match[1] ?? match[2] ?? '')) {
      reads.add(id);
    }
  }

  for (const match of content.matchAll(DOJO_WRITE_BLOCK_PATTERN)) {
    const id = (match[1] ?? match[2] ?? '').trim();
    if (id) writes.add(id);
  }

  for (const match of content.matchAll(ARTIFACT_DIR_PLACEHOLDER)) {
    placeholders.add(match[1].trim());
  }

  for (const match of content.matchAll(ARTIFACT_DESCRIPTION_PLACEHOLDER)) {
    placeholders.add(match[1].trim());
  }

  const all = new Set<string>([
    ...reads,
    ...writes,
    ...placeholders,
  ]);

  return {
    reads: [...reads],
    writes: [...writes],
    placeholders: [...placeholders],
    all: [...all],
  };
}

export async function validateTemplateArtifactRefs(
  root: string,
  content: string,
): Promise<void> {
  const refs = extractTemplateArtifactRefs(content);
  const plugins = await loadArtifactPlugins(root);
  for (const id of refs.all) {
    if (!plugins[id]) {
      throw new Error(`Unknown artifact id referenced in template: ${id}`);
    }
  }
}

function countLiteralOccurrences(content: string, token: string): number {
  if (!token) return 0;
  return content.split(token).length - 1;
}

function countMatches(content: string, pattern: RegExp): number {
  return [...content.matchAll(pattern)].length;
}

function validateMarkerPairing(
  content: string,
  start: string,
  end: string,
  label: string,
): string[] {
  const issues: string[] = [];
  const markers: Array<{ index: number; type: 'start' | 'end' }> = [];

  let searchFrom = 0;
  while (true) {
    const index = content.indexOf(start, searchFrom);
    if (index === -1) break;
    markers.push({ index, type: 'start' });
    searchFrom = index + start.length;
  }

  searchFrom = 0;
  while (true) {
    const index = content.indexOf(end, searchFrom);
    if (index === -1) break;
    markers.push({ index, type: 'end' });
    searchFrom = index + end.length;
  }

  markers.sort((a, b) => a.index - b.index);

  let depth = 0;
  for (const marker of markers) {
    if (marker.type === 'start') {
      depth += 1;
      continue;
    }
    if (depth === 0) {
      issues.push(`Unexpected ${label} closing marker.`);
      continue;
    }
    depth -= 1;
  }

  if (depth > 0) {
    issues.push(`Unclosed ${label} block.`);
  }

  return issues;
}

function validateTemplateSyntax(content: string): string[] {
  const issues: string[] = [];
  const frontmatter = parseTemplateFrontmatter(content);

  if (countLiteralOccurrences(content, '<dojo_read_block') !== countMatches(content, DOJO_READ_BLOCK_PATTERN)) {
    issues.push('Malformed <dojo_read_block ... /> directive.');
  }

  if (countLiteralOccurrences(content, '<dojo_write_block') !== countMatches(content, DOJO_WRITE_BLOCK_PATTERN)) {
    issues.push('Malformed <dojo_write_block ... /> directive.');
  }

  if (countLiteralOccurrences(content, '${artifact_dir:') !== countMatches(content, ARTIFACT_DIR_PLACEHOLDER)) {
    issues.push('Malformed ${artifact_dir:<id>} placeholder.');
  }

  if (countLiteralOccurrences(content, '${artifact_description:') !== countMatches(content, ARTIFACT_DESCRIPTION_PLACEHOLDER)) {
    issues.push('Malformed ${artifact_description:<id>} placeholder.');
  }

  for (const match of content.matchAll(DOJO_READ_BLOCK_PATTERN)) {
    const ids = parseArtifactIdList(match[1] ?? match[2] ?? '');
    if (ids.length === 0) {
      issues.push('<dojo_read_block ... /> must reference at least one artifact id.');
    }
  }

  for (const match of content.matchAll(DOJO_WRITE_BLOCK_PATTERN)) {
    const ids = parseArtifactIdList(match[1] ?? match[2] ?? '');
    if (ids.length !== 1) {
      issues.push('<dojo_write_block ... /> must reference exactly one artifact id.');
    }
  }

  for (const match of content.matchAll(ARTIFACT_DIR_PLACEHOLDER)) {
    if (!match[1].trim()) {
      issues.push('Malformed ${artifact_dir:<id>} placeholder: missing artifact id.');
    }
  }

  for (const match of content.matchAll(ARTIFACT_DESCRIPTION_PLACEHOLDER)) {
    if (!match[1].trim()) {
      issues.push('Malformed ${artifact_description:<id>} placeholder: missing artifact id.');
    }
  }

  issues.push(...validateMarkerPairing(content, SESSION_ONLY_START, SESSION_ONLY_END, 'DOJO_SESSION_ONLY'));
  issues.push(...validateMarkerPairing(content, NO_SESSION_ONLY_START, NO_SESSION_ONLY_END, 'DOJO_NO_SESSION_ONLY'));

  const scope = frontmatter.scope;
  if (scope && !['workspace', 'session', 'mixed'].includes(scope)) {
    issues.push('Invalid frontmatter value for scope. Use workspace, session, or mixed.');
  }

  return issues;
}

export async function validateTemplateContent(
  root: string,
  content: string,
): Promise<string[]> {
  const issues = [...validateTemplateSyntax(content)];
  const refs = extractTemplateArtifactRefs(content);
  const plugins = await loadArtifactPlugins(root);
  const scope = getTemplateScope(content);

  for (const id of refs.all) {
    if (!id) continue;
    const artifact = plugins[id];
    if (!artifact) {
      issues.push(`Unknown artifact id referenced in template: ${id}`);
      continue;
    }
    if (scope === 'workspace' && artifact.scope !== 'workspace') {
      issues.push(`Workspace-scoped templates may not reference non-workspace artifact id: ${id}`);
    }
  }

  if (scope === 'workspace') {
    if (content.includes(SESSION_ONLY_START) || content.includes(SESSION_ONLY_END)) {
      issues.push('Workspace-scoped templates may not use DOJO_SESSION_ONLY blocks.');
    }
    if (content.includes(NO_SESSION_ONLY_START) || content.includes(NO_SESSION_ONLY_END)) {
      issues.push('Workspace-scoped templates may not use DOJO_NO_SESSION_ONLY blocks.');
    }
    if (content.includes('${session_id}') || content.includes('${dojo_current_session_id}')) {
      issues.push('Workspace-scoped templates may not use session placeholders.');
    }
  }

  return [...new Set(issues)];
}

function renderArtifactReferenceBlock(
  label: string,
  artifactIds: string[],
  resolved: Array<{ id: string; dir: string | null; description: string }>,
): string {
  const lines: string[] = [];
  lines.push(`### ${label}`);
  lines.push('');
  for (const item of resolved) {
    lines.push(`- \`${item.id}\``);
    if (item.dir) {
      lines.push(`  Directory: \`${normalizeSlashes(item.dir)}\``);
    } else {
      lines.push('  Directory: derived artifact (no fixed directory)');
    }
    if (item.description) {
      lines.push(`  Description: ${item.description}`);
    }
  }
  if (artifactIds.length === 0) {
    lines.push('- No artifacts declared.');
  }
  return lines.join('\n');
}

export async function expandTemplateArtifactSyntax(
  content: string,
  root: string,
  config: WorkspaceConfig,
  options: {
    sessionId: string | null;
    noSessionPlaceholder?: string;
  },
): Promise<string> {
  const plugins = await loadArtifactPlugins(root);
  let out = content;

  out = out.replace(SESSION_ID_PLACEHOLDER, options.sessionId ?? options.noSessionPlaceholder ?? '');
  out = out.replace(LEGACY_SESSION_ID_PLACEHOLDER, options.sessionId ?? options.noSessionPlaceholder ?? '');
  out = out.replace(CONTEXT_PATH_PLACEHOLDER, normalizeSlashes(path.join(DOJO_DIR, 'context.md')));

  const replaceArtifactRef = async (
    input: string,
    pattern: RegExp,
    resolver: (id: string) => Promise<string>,
  ): Promise<string> => {
    let result = '';
    let lastIndex = 0;
    for (const match of input.matchAll(pattern)) {
      const full = match[0];
      const id = match[1].trim();
      const index = match.index ?? 0;
      result += input.slice(lastIndex, index);
      result += await resolver(id);
      lastIndex = index + full.length;
    }
    result += input.slice(lastIndex);
    return result;
  };

  out = await replaceArtifactRef(out, ARTIFACT_DIR_PLACEHOLDER, async (id) => {
    const artifact = plugins[id];
    if (!artifact) throw new Error(`Unknown artifact id: ${id}`);
    const resolved = resolveArtifactDir(artifact, {
      sessionId: options.sessionId,
      noSessionPlaceholder: options.noSessionPlaceholder,
      workspaceName: config.workspace.name,
      workspaceDescription: config.workspace.description,
    });
    return resolved ? normalizeSlashes(resolved) : '';
  });

  out = await replaceArtifactRef(out, ARTIFACT_DESCRIPTION_PLACEHOLDER, async (id) => {
    const artifact = plugins[id];
    if (!artifact) throw new Error(`Unknown artifact id: ${id}`);
    return artifact.description ?? '';
  });

  const replaceDirective = async (
    input: string,
    pattern: RegExp,
    builder: (artifactIds: string[]) => Promise<string>,
  ): Promise<string> => {
    let result = '';
    let lastIndex = 0;
    for (const match of input.matchAll(pattern)) {
      const full = match[0];
      const raw = match[1] ?? match[2] ?? '';
      const artifactIds = parseArtifactIdList(raw);
      const index = match.index ?? 0;
      result += input.slice(lastIndex, index);
      result += await builder(artifactIds);
      lastIndex = index + full.length;
    }
    result += input.slice(lastIndex);
    return result;
  };

  out = await replaceDirective(out, DOJO_READ_BLOCK_PATTERN, async (artifactIds) => {
    const resolved = artifactIds.map(id => {
      const artifact = plugins[id];
      if (!artifact) throw new Error(`Unknown artifact id: ${id}`);
      return {
        id,
        dir: resolveArtifactDir(artifact, {
          sessionId: options.sessionId,
          noSessionPlaceholder: options.noSessionPlaceholder,
          workspaceName: config.workspace.name,
          workspaceDescription: config.workspace.description,
        }),
        description: artifact.description ?? '',
      };
    });
    return renderArtifactReferenceBlock('Available Context', artifactIds, resolved);
  });

  out = await replaceDirective(out, DOJO_WRITE_BLOCK_PATTERN, async (artifactIds) => {
    const resolved = artifactIds.map(id => {
      const artifact = plugins[id];
      if (!artifact) throw new Error(`Unknown artifact id: ${id}`);
      return {
        id,
        dir: resolveArtifactDir(artifact, {
          sessionId: options.sessionId,
          noSessionPlaceholder: options.noSessionPlaceholder,
          workspaceName: config.workspace.name,
          workspaceDescription: config.workspace.description,
        }),
        description: artifact.description ?? '',
      };
    });
    return renderArtifactReferenceBlock('Output Artifact', artifactIds, resolved);
  });

  return out;
}

export function listArtifactTemplateFiles(root: string): string[] {
  const workspaceDir = path.join(root, DOJO_DIR, 'artifacts');
  if (!fileExists(workspaceDir)) return [];
  return listFiles(workspaceDir).filter(file => /\.(js|mjs|ts|mts)$/.test(file));
}
