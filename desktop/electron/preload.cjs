const { contextBridge, ipcRenderer } = require('electron');

const subscriptions = new Map();

function on(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  const key = `${channel}:${Math.random()}`;
  subscriptions.set(key, () => ipcRenderer.off(channel, listener));
  return () => {
    const dispose = subscriptions.get(key);
    if (dispose) dispose();
    subscriptions.delete(key);
  };
}

contextBridge.exposeInMainWorld('dojoDesktop', {
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  openWorkspace: (root) => ipcRenderer.invoke('workspace:open', root),
  readWorkspace: (root) => ipcRenderer.invoke('workspace:read', root),
  createSession: (input) => ipcRenderer.invoke('session:create', input),
  activateSession: (input) => ipcRenderer.invoke('session:activate', input),
  listInstances: (input) => ipcRenderer.invoke('instances:list', input),
  preflightCodex: () => ipcRenderer.invoke('codex:preflight'),
  createTerminal: (input) => ipcRenderer.invoke('terminal:create', input),
  writeTerminal: (input) => ipcRenderer.invoke('terminal:write', input),
  resizeTerminal: (input) => ipcRenderer.invoke('terminal:resize', input),
  killTerminal: (input) => ipcRenderer.invoke('terminal:kill', input),
  readTranscript: (input) => ipcRenderer.invoke('terminal:readTranscript', input),
  onTerminalData: (callback) => on('terminal:data', callback),
  onTerminalExit: (callback) => on('terminal:exit', callback),
});
