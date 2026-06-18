import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  FolderOpen,
  GitBranch,
  LayoutDashboard,
  Play,
  Plus,
  Settings,
  Split,
  SquareTerminal,
} from 'lucide-react';
import { InstanceCanvas } from './components/InstanceCanvas';
import { TerminalView } from './components/TerminalView';
import type { CodexPreflightStatus, DojoSession, TerminalInstance, WorkspaceSnapshot } from './types';

const LAST_WORKSPACE_KEY = 'dojo-desktop:last-workspace';

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || `session-${Date.now()}`;
}

export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [instances, setInstances] = useState<TerminalInstance[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [codexStatus, setCodexStatus] = useState<CodexPreflightStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeSession = useMemo(() => {
    return workspace?.sessions.find((session) => session.id === activeSessionId) || null;
  }, [workspace, activeSessionId]);

  const selectedInstance = useMemo(() => {
    return instances.find((instance) => instance.id === selectedInstanceId) || null;
  }, [instances, selectedInstanceId]);

  const codexInstances = useMemo(() => {
    return instances.filter((instance) => instance.kind === 'codex');
  }, [instances]);

  const shellInstances = useMemo(() => {
    return instances.filter((instance) => instance.kind === 'shell');
  }, [instances]);

  const selectedIsClosed = selectedInstance?.status === 'exited' || selectedInstance?.status === 'error';

  const refreshCodexStatus = useCallback(async () => {
    const status = await window.dojoDesktop.preflightCodex();
    setCodexStatus(status);
    return status;
  }, []);

  const openWorkspace = useCallback(async () => {
    setError(null);
    const root = await window.dojoDesktop.chooseWorkspace();
    if (!root) return;
    const snapshot = await window.dojoDesktop.openWorkspace(root);
    await refreshCodexStatus();
    window.localStorage.setItem(LAST_WORKSPACE_KEY, root);
    setWorkspace(snapshot);
    const sessionId = snapshot.state.active_session || snapshot.sessions[0]?.id || null;
    setActiveSessionId(sessionId);
    if (sessionId) {
      const nextInstances = await window.dojoDesktop.listInstances({ root, sessionId });
      setInstances(nextInstances);
    }
  }, [refreshCodexStatus]);

  const openWorkspaceRoot = useCallback(async (root: string) => {
    setError(null);
    const snapshot = await window.dojoDesktop.openWorkspace(root);
    await refreshCodexStatus();
    window.localStorage.setItem(LAST_WORKSPACE_KEY, root);
    setWorkspace(snapshot);
    const sessionId = snapshot.state.active_session || snapshot.sessions[0]?.id || null;
    setActiveSessionId(sessionId);
    setSelectedInstanceId(null);
    if (sessionId) {
      const nextInstances = await window.dojoDesktop.listInstances({ root, sessionId });
      setInstances(nextInstances);
    } else {
      setInstances([]);
    }
  }, [refreshCodexStatus]);

  const createSession = useCallback(async () => {
    if (!workspace) return;
    const description = window.prompt('Session description', 'New Dojo session');
    if (!description) return;
    const id = slugify(description);
    const result = await window.dojoDesktop.createSession({ root: workspace.root, id, description });
    setWorkspace(result.workspace);
    setActiveSessionId(result.session.id);
    setInstances(result.instances);
    setSelectedInstanceId(null);
  }, [workspace]);

  const activateSession = useCallback(async (session: DojoSession) => {
    if (!workspace) return;
    const result = await window.dojoDesktop.activateSession({ root: workspace.root, sessionId: session.id });
    setWorkspace(result.workspace);
    setActiveSessionId(session.id);
    setInstances(result.instances);
    setSelectedInstanceId(null);
  }, [workspace]);

  const createCodex = useCallback(async (
    parentId: string | null = null,
    mode: 'new' | 'fork' | 'resume' = 'new',
    codexSessionId: string | null = null,
  ) => {
    if (!workspace || !activeSessionId) {
      setError('Create or activate a Dojo session first.');
      return null;
    }
    setError(null);
    const status = await refreshCodexStatus();
    if (!status.ok) {
      setError(`${status.reason} Run: ${status.install_command}`);
      return null;
    }
    const parent = parentId ? instances.find((item) => item.id === parentId) : null;
    const sessionForCodex = codexSessionId || parent?.codex_session_id || null;
    try {
      const result = await window.dojoDesktop.createTerminal({
        root: workspace.root,
        sessionId: activeSessionId,
        kind: 'codex',
        parent_instance_id: parentId,
        mode,
        codex_session_id: mode === 'fork' || mode === 'resume' ? sessionForCodex : null,
        title: parentId ? 'Codex child' : 'Codex',
      });
      setInstances(result.instances);
      setSelectedInstanceId(result.instance.id);
      return result.instance;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setError(`Failed to start Codex: ${detail}`);
      return null;
    }
  }, [activeSessionId, instances, refreshCodexStatus, workspace]);

  const createShell = useCallback(async () => {
    if (!workspace || !activeSessionId) {
      setError('Create or activate a Dojo session before opening a workspace shell.');
      return null;
    }
    setError(null);
    try {
      const result = await window.dojoDesktop.createTerminal({
        root: workspace.root,
        sessionId: activeSessionId,
        kind: 'shell',
        title: 'Workspace shell',
      });
      setInstances(result.instances);
      setSelectedInstanceId(result.instance.id);
      return result.instance;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setError(`Failed to start shell: ${detail}`);
      return null;
    }
  }, [activeSessionId, workspace]);

  const restartSelectedCodex = useCallback(async () => {
    if (!selectedInstance || selectedInstance.kind !== 'codex') return;
    await createCodex(selectedInstance.parent_instance_id, 'new');
  }, [createCodex, selectedInstance]);

  useEffect(() => {
    const lastWorkspace = window.localStorage.getItem(LAST_WORKSPACE_KEY);
    if (lastWorkspace && !workspace) {
      openWorkspaceRoot(lastWorkspace).catch(() => {
        window.localStorage.removeItem(LAST_WORKSPACE_KEY);
      });
    }
  }, [openWorkspaceRoot, workspace]);

  useEffect(() => {
    const disposeData = window.dojoDesktop.onTerminalData((event) => {
      if (event.instanceId === selectedInstanceId) return;
      setPreviews((current) => ({
        ...current,
        [event.instanceId]: `${current[event.instanceId] || ''}${event.data}`.slice(-2400),
      }));
    });
    const disposeExit = window.dojoDesktop.onTerminalExit((event) => {
      setInstances((current) => current.map((item) => item.id === event.instanceId ? event.instance : item));
    });
    return () => {
      disposeData();
      disposeExit();
    };
  }, [selectedInstanceId]);

  const hasSession = Boolean(workspace && activeSessionId);

  if (!workspace) {
    return (
      <main className="welcome-screen">
        <div className="welcome-card">
          <div className="app-mark">
            <GitBranch size={28} />
          </div>
          <h1>Dojo Desktop</h1>
          <p>Open a folder to create a Codex-like terminal workspace backed by real PTYs.</p>
          <button className="primary-button" onClick={openWorkspace}>
            <FolderOpen size={17} />
            Open Folder
          </button>
        </div>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="workspace-badge">
            <div className="workspace-icon"><FolderOpen size={17} /></div>
            <div>
              <div className="workspace-name">{workspace.config.workspace.name}</div>
              <div className="workspace-path">{workspace.root}</div>
            </div>
          </div>
          <button className="ghost-button full" onClick={openWorkspace}>
            <FolderOpen size={15} />
            Switch Folder
          </button>
          <div className="workspace-tools">
            <div className="section-title compact">
              <span>Workspace Tools</span>
            </div>
            <button className="tool-action" disabled={!hasSession} onClick={createShell}>
              <SquareTerminal size={15} />
              Open shell
            </button>
            {shellInstances.map((instance) => (
              <button
                key={instance.id}
                className={`nav-item tool-item ${instance.id === selectedInstanceId ? 'active' : ''}`}
                onClick={() => setSelectedInstanceId(instance.id)}
              >
                <SquareTerminal size={15} />
                <span>{instance.title}</span>
                <span className={`mini-status ${instance.status}`} />
              </button>
            ))}
          </div>
        </div>

        <section className="sidebar-section grow">
          <div className="section-title">
            <span>Sessions</span>
            <button className="icon-button" title="New session" onClick={createSession}>
              <Plus size={15} />
            </button>
          </div>
          <div className="nav-list session-tree">
            {workspace.sessions.length === 0 && <div className="empty-nav">No sessions yet</div>}
            {workspace.sessions.map((session) => (
              <div key={session.id} className={`session-group ${session.id === activeSessionId ? 'active' : ''}`}>
                <button
                  className="nav-item session-item"
                  onClick={() => activateSession(session)}
                >
                  <LayoutDashboard size={16} />
                  <span>{session.description || session.id}</span>
                </button>
                {session.id === activeSessionId && (
                  <div className="conversation-list">
                    {codexStatus && !codexStatus.ok && (
                      <div className="codex-setup-notice">
                        <div className="setup-title">Codex CLI required</div>
                        <div>{codexStatus.reason}</div>
                        <code>{codexStatus.install_command}</code>
                        <button className="setup-recheck" onClick={refreshCodexStatus}>Recheck</button>
                      </div>
                    )}
                    <button className="conversation-action" onClick={() => createCodex()}>
                      <Plus size={14} />
                      New Codex conversation
                    </button>
                    {codexInstances.length === 0 && <div className="empty-nav indented">No Codex conversations</div>}
                    {codexInstances.map((instance) => (
                      <button
                        key={instance.id}
                        className={`nav-item conversation-item ${instance.id === selectedInstanceId ? 'active' : ''}`}
                        onClick={() => setSelectedInstanceId(instance.id)}
                      >
                        <Bot size={15} />
                        <span>{instance.title}</span>
                        <span className={`mini-status ${instance.status}`} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        <button className="settings-button">
          <Settings size={16} />
          Settings
        </button>
      </aside>

      <section className="main-pane">
        <header className="topbar">
          <div>
            <div className="crumb">{activeSession ? activeSession.description : 'No session selected'}</div>
            <div className="subcrumb">
              {selectedInstance
                ? `${selectedInstance.kind} · ${selectedInstance.status}${selectedInstance.exit_code != null ? ` · code ${selectedInstance.exit_code}` : ''} · ${selectedInstance.command}`
                : 'Session canvas'}
            </div>
          </div>
          <div className="topbar-actions">
            <button className="ghost-button" disabled={!hasSession} onClick={() => setSelectedInstanceId(null)}>
              <GitBranch size={15} />
              Canvas
            </button>
            <button className="ghost-button" disabled={!selectedInstance || selectedInstance.status !== 'running' || !selectedInstance.codex_session_id} onClick={() => selectedInstance && createCodex(selectedInstance.id, 'fork')}>
              <Split size={15} />
              Fork
            </button>
            <button className="ghost-button" disabled={!selectedInstance || selectedInstance.kind !== 'codex' || !selectedIsClosed} onClick={restartSelectedCodex}>
              <Play size={15} />
              Restart
            </button>
          </div>
        </header>

        <div className="content-area">
          {!activeSessionId ? (
            <div className="empty-canvas">
              <LayoutDashboard size={42} />
              <h2>Create a Dojo session</h2>
              <p>Sessions group terminal and Codex instances under one workspace task.</p>
              <button className="primary-button" onClick={createSession}>
                <Plus size={16} />
                New Session
              </button>
            </div>
          ) : selectedInstance ? (
            <TerminalView
              root={workspace.root}
              sessionId={activeSessionId}
              instance={selectedInstance}
            />
          ) : (
            <InstanceCanvas
              instances={codexInstances}
              previews={previews}
              selectedId={selectedInstanceId}
              onSelect={setSelectedInstanceId}
              onCreateChild={(id) => createCodex(id, 'fork')}
            />
          )}
        </div>

        {error && <div className="error-toast">{error}</div>}
      </section>
    </div>
  );
}
