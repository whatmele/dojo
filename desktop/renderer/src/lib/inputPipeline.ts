import type { TerminalInstance } from '../types';

export interface PipelineResult {
  kind: 'send' | 'command' | 'noop';
  payload?: string;
  command?: 'new-shell' | 'new-codex' | 'fork' | 'canvas';
}

export function runInputPipeline(input: string, current: TerminalInstance | null): PipelineResult {
  const text = input.trim();
  if (!text) return { kind: 'noop' };

  if (text === '/new-shell') return { kind: 'command', command: 'new-shell' };
  if (text === '/new-codex') return { kind: 'command', command: 'new-codex' };
  if (text === '/fork') return { kind: 'command', command: 'fork' };
  if (text === '/canvas') return { kind: 'command', command: 'canvas' };

  if (text.startsWith('/') && !current) {
    return { kind: 'noop' };
  }

  return { kind: 'send', payload: input.endsWith('\n') ? input : `${input}\r` };
}
