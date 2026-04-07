export type RepoType = 'biz' | 'dev' | 'wiki';
export type SessionStatus = 'active' | 'suspended' | 'completed';
export type AgentTool = 'claude-code' | 'codex' | 'cursor' | 'trae';
export type BranchSource = 'existing' | 'created';
export type WorkspaceMode = 'session' | 'no-session';
export type ReconcileStatus =
  | 'aligned'
  | 'branch-mismatch'
  | 'dirty'
  | 'missing-repo'
  | 'missing-branch'
  | 'not-git'
  | 'detached-head';

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
  runtime?: RuntimeConfig;
}

export interface WorkspaceState {
  active_session: string | null;
}

export interface RuntimeConfig {
  workspace_root?: {
    default_branch: string;
  };
  switch_guard?: {
    clean_policy: 'all-registered';
  };
  remote?: {
    auto_push_on_session_create: boolean;
  };
}

export interface SessionWorkspaceRootBinding {
  target_branch: string;
  base_branch: string;
  branch_source: BranchSource;
}

export interface SessionRepoBinding {
  repo: string;
  path_snapshot: string;
  target_branch: string;
  base_branch: string;
  branch_source: BranchSource;
}

export interface SessionState {
  id: string;
  description: string;
  external_link?: string;
  created_at: string;
  updated_at?: string;
  status: SessionStatus;
  workspace_root?: SessionWorkspaceRootBinding;
  repos?: SessionRepoBinding[];
  /** Compatibility fields retained for transitional in-repo callers and tests. */
  repo_branches?: Record<string, string>;
  workspace_branch?: string;
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

export interface WorkspaceTargetRepoState {
  repo: string;
  path: string;
  expected_branch: string;
  source: 'session' | 'baseline';
}

export interface WorkspaceTargetState {
  mode: WorkspaceMode;
  session_id: string | null;
  root: {
    expected_branch: string;
  };
  repos: WorkspaceTargetRepoState[];
}

export interface ObservedGitState {
  exists: boolean;
  is_git_repo: boolean;
  current_branch: string | null;
  dirty: boolean;
  detached: boolean;
  has_upstream: boolean | null;
}

export interface ObservedWorkspaceState {
  root: ObservedGitState;
  repos: Record<string, ObservedGitState>;
}

export interface ReconciledItem {
  name: string;
  expected_branch: string;
  current_branch: string | null;
  dirty: boolean;
  status: ReconcileStatus;
}

export interface WorkspaceReconciliation {
  mode: WorkspaceMode;
  session_id: string | null;
  overall: 'aligned' | 'drifted' | 'blocked';
  root: ReconciledItem;
  repos: ReconciledItem[];
  blocking_issues: string[];
}

export type SwitchActionType =
  | 'checkout-existing'
  | 'create-from-base'
  | 'checkout-tracking-remote'
  | 'noop';

export interface SwitchAction {
  scope: 'root' | 'repo';
  repo?: string;
  path: string;
  target_branch: string;
  base_branch?: string;
  action: SwitchActionType;
}

export interface SwitchPlan {
  mode: WorkspaceMode;
  session_id: string | null;
  actions: SwitchAction[];
  blocking_issues: string[];
  warnings: string[];
}

export const DOJO_DIR = '.dojo';
export const AGENTS_COMMANDS_DIR = '.agents/commands';
export const AGENTS_SKILLS_DIR = '.agents/skills';
export const AGENT_COMMAND_DIRS: Partial<Record<AgentTool, string>> = {
  'claude-code': '.claude/commands',
  'trae': '.trae/commands',
};
export const AGENT_SKILL_DIRS: Partial<Record<AgentTool, string>> = {
  'claude-code': '.claude/skills',
  'trae': '.trae/skills',
};
