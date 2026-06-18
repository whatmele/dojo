export type InstanceKind = 'shell' | 'codex';
export type InstanceStatus = 'idle' | 'running' | 'exited' | 'error';

export interface DojoSession {
  id: string;
  description: string;
  created_at: string;
  updated_at?: string;
  status: string;
}

export interface WorkspaceSnapshot {
  root: string;
  config: {
    workspace: {
      name: string;
      description: string;
    };
  };
  state: {
    active_session: string | null;
  };
  sessions: DojoSession[];
}

export interface TerminalInstance {
  id: string;
  title: string;
  kind: InstanceKind;
  dojo_session_id: string;
  parent_instance_id: string | null;
  cwd: string;
  command: string;
  pid: number | null;
  status: InstanceStatus;
  exit_code?: number | null;
  exit_signal?: number | string | null;
  ended_at?: string | null;
  exit_reason?: string | null;
  last_error?: string | null;
  codex_session_id: string | null;
  codex_session_source?: string;
  created_at: string;
  updated_at: string;
  transcript_path: string;
}

export interface TerminalDataEvent {
  instanceId: string;
  data: string;
}

export interface CodexPreflightStatus {
  ok: boolean;
  reason: string | null;
  path: string | null;
  version: string | null;
  version_error: string | null;
  npm_package_installed: boolean;
  npm_package_version: string | null;
  npm_package_error: string | null;
  install_command: string;
  update_note: string;
}

export interface DesktopApi {
  chooseWorkspace(): Promise<string | null>;
  openWorkspace(root: string): Promise<WorkspaceSnapshot>;
  readWorkspace(root: string): Promise<WorkspaceSnapshot>;
  createSession(input: { root: string; id?: string; description: string }): Promise<{
    session: DojoSession;
    workspace: WorkspaceSnapshot;
    instances: TerminalInstance[];
  }>;
  activateSession(input: { root: string; sessionId: string }): Promise<{
    workspace: WorkspaceSnapshot;
    instances: TerminalInstance[];
  }>;
  listInstances(input: { root: string; sessionId: string }): Promise<TerminalInstance[]>;
  preflightCodex(): Promise<CodexPreflightStatus>;
  createTerminal(input: {
    root: string;
    sessionId: string;
    kind: InstanceKind;
    parent_instance_id?: string | null;
    mode?: 'new' | 'fork' | 'resume';
    codex_session_id?: string | null;
    title?: string;
    cwd?: string;
    cols?: number;
    rows?: number;
  }): Promise<{ instance: TerminalInstance; instances: TerminalInstance[] }>;
  writeTerminal(input: { instanceId: string; data: string }): Promise<{ ok: boolean; reason?: string }>;
  resizeTerminal(input: { instanceId: string; cols: number; rows: number }): Promise<{ ok: boolean; reason?: string }>;
  killTerminal(input: { instanceId: string }): Promise<{ ok: boolean; reason?: string }>;
  readTranscript(input: { root: string; sessionId: string; instanceId: string }): Promise<string>;
  onTerminalData(callback: (event: TerminalDataEvent) => void): () => void;
  onTerminalExit(callback: (event: { instanceId: string; instance: TerminalInstance }) => void): () => void;
}

declare global {
  interface Window {
    dojoDesktop: DesktopApi;
  }
}
