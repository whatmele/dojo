export type RepoType = 'biz' | 'dev' | 'wiki';
export type SessionStatus = 'active' | 'suspended' | 'completed';
export type AgentTool = 'claude-code' | 'codex' | 'cursor' | 'trae';

export interface RepoConfig {
  name: string;
  type: RepoType;
  git: string;
  path: string;
  default_branch: string;
  description: string;
}

export interface WorkspaceConfig {
  workspace: {
    name: string;
    description: string;
  };
  agents: AgentTool[];
  /** Custom CLI executable per agent tool (overrides built-in defaults). */
  agent_commands?: Partial<Record<AgentTool, string>>;
  repos: RepoConfig[];
  context?: ContextConfig;
}

export interface WorkspaceState {
  active_session: string | null;
}

export interface SessionState {
  id: string;
  description: string;
  external_link?: string;
  created_at: string;
  status: SessionStatus;
  repo_branches: Record<string, string>;
  /** Branch created on the workspace root repo for this session */
  workspace_branch?: string;
}

export interface TaskState {
  is_completed: boolean;
}

export interface TaskManifestEntry {
  name: string;
  description: string;
  depends_on: string[];
}

export interface TaskManifest {
  tasks: TaskManifestEntry[];
}

export interface ArtifactPlugin {
  id: string;
  scope: TemplateScope;
  dir: string | null;
  description?: string;
  renderContext: ArtifactRenderFunction;
}

export type TemplateScope = 'workspace' | 'session' | 'mixed';

export interface TemplateFrontmatter {
  description?: string;
  'argument-hint'?: string;
  scope?: TemplateScope;
}

export interface ContextConfig {
  artifacts?: string[];
}

export interface ArtifactPluginHelpers {
  resolveArtifactDir(id: string): string | null;
  listMarkdownFiles(dir: string | null): string[];
  listDirs(dir: string | null): string[];
  readText(filePath: string, maxChars?: number): string;
  readJSON<T>(filePath: string): T | null;
  relative(filePath: string): string;
  pickPreferred(files: string[], preferredNames: string[]): string | null;
}

export interface ArtifactRenderInput {
  root: string;
  config: WorkspaceConfig;
  session: SessionState;
  artifact: ArtifactPlugin;
  dir: string | null;
  helpers: ArtifactPluginHelpers;
}

export type ArtifactRenderFunction = (input: ArtifactRenderInput) => Promise<string | null> | string | null;

export const DOJO_DIR = '.dojo';
export const AGENTS_COMMANDS_DIR = '.agents/commands';
export const AGENTS_SKILLS_DIR = '.agents/skill';
export const AGENT_COMMAND_DIRS: Partial<Record<AgentTool, string>> = {
  'claude-code': '.claude/commands',
  'trae': '.trae/commands',
};
export const AGENT_SKILL_DIRS: Partial<Record<AgentTool, string>> = {
  'claude-code': '.claude/skills',
  'trae': '.trae/skills',
};
