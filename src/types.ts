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

export const DOJO_DIR = '.dojo';
export const AGENTS_COMMANDS_DIR = '.agents/commands';
export const AGENT_COMMAND_DIRS: Partial<Record<AgentTool, string>> = {
  'claude-code': '.claude/commands',
  'trae': '.trae/commands',
};
