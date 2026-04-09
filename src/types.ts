export type RepoType = 'biz' | 'dev' | 'wiki';
export type SessionStatus = 'active' | 'suspended' | 'completed';
export type AgentTool = 'claude-code' | 'codex' | 'cursor' | 'trae';

export interface RepoConfig {
  name: string;
  type: RepoType;
  git: string;
  path: string;
  description: string;
}

export interface WorkspaceConfig {
  workspace: {
    name: string;
    description: string;
  };
  agents: AgentTool[];
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
  updated_at?: string;
  status: SessionStatus;
}

export interface TaskState {
  is_completed: boolean;
}

export interface TaskManifestEntry {
  id?: string;
  name: string;
  description: string;
  depends_on: string[];
}

export interface TaskManifest {
  tasks: TaskManifestEntry[];
}

export type TaskRuntimeStatus = 'done' | 'ready' | 'blocked' | 'untracked';

export interface TaskOverviewItem {
  name: string;
  description: string;
  depends_on: string[];
  dependency_status: TaskRuntimeStatus;
  is_completed: boolean;
  task_dir: string;
}

export interface TaskOverview {
  session_id: string;
  items: TaskOverviewItem[];
  summary: {
    total: number;
    done: number;
    ready: number;
    blocked: number;
    untracked: number;
  };
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
export const AGENTS_SKILLS_DIR = '.agents/skills';
export const AGENT_COMMAND_DIRS: Partial<Record<AgentTool, string>> = {
  'claude-code': '.claude/commands',
  'trae': '.trae/commands',
};
export const AGENT_SKILL_DIRS: Partial<Record<AgentTool, string>> = {
  'claude-code': '.claude/skills',
};
