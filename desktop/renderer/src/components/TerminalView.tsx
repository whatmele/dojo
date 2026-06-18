import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { TerminalInstance } from '../types';

interface TerminalViewProps {
  root: string;
  sessionId: string;
  instance: TerminalInstance;
}

export function TerminalView({ root, sessionId, instance }: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const statusRef = useRef(instance.status);

  useEffect(() => {
    statusRef.current = instance.status;
  }, [instance.status]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.22,
      letterSpacing: 0,
      drawBoldTextInBrightColors: true,
      theme: {
        background: '#111111',
        foreground: '#cccccc',
        cursor: '#f5f5f5',
        selectionBackground: '#3a3a3a',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff',
      },
      allowProposedApi: false,
      scrollback: 5000,
    });

    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    window.requestAnimationFrame(() => {
      terminal.focus();
      fit.fit();
      window.dojoDesktop.resizeTerminal({
        instanceId: instance.id,
        cols: terminal.cols,
        rows: terminal.rows,
      });
    });
    fit.fit();

    terminal.onData((data) => {
      if (statusRef.current !== 'running') return;
      window.dojoDesktop.writeTerminal({ instanceId: instance.id, data });
    });

    const focusTerminal = () => {
      terminal.focus();
    };
    host.addEventListener('pointerdown', focusTerminal);

    let disposed = false;
    window.dojoDesktop.readTranscript({ root, sessionId, instanceId: instance.id }).then((data) => {
      if (!disposed && data) terminal.write(data);
    });

    const disposeData = window.dojoDesktop.onTerminalData((event) => {
      if (event.instanceId === instance.id) {
        terminal.write(event.data);
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      if (!terminal.element) return;
      fit.fit();
      window.dojoDesktop.resizeTerminal({
        instanceId: instance.id,
        cols: terminal.cols,
        rows: terminal.rows,
      });
    });
    resizeObserver.observe(host);

    terminalRef.current = terminal;
    fitRef.current = fit;

    return () => {
      disposed = true;
      disposeData();
      resizeObserver.disconnect();
      host.removeEventListener('pointerdown', focusTerminal);
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [root, sessionId, instance.id]);

  return <div ref={hostRef} className="terminal-host" />;
}
