import { Background, Controls, ReactFlow, type Edge, type Node } from '@xyflow/react';
import { GitBranch, SquareTerminal } from 'lucide-react';
import type { TerminalInstance } from '../types';

interface InstanceCanvasProps {
  instances: TerminalInstance[];
  previews: Record<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreateChild: (id: string) => void;
}

function depthOf(instance: TerminalInstance, all: TerminalInstance[]): number {
  let depth = 0;
  let parentId = instance.parent_instance_id;
  while (parentId) {
    const parent = all.find((item) => item.id === parentId);
    if (!parent) break;
    depth += 1;
    parentId = parent.parent_instance_id;
  }
  return depth;
}

function layoutInstances(instances: TerminalInstance[], previews: Record<string, string>, selectedId: string | null): Node[] {
  const rows = new Map<number, TerminalInstance[]>();
  for (const instance of instances) {
    const depth = depthOf(instance, instances);
    rows.set(depth, [...(rows.get(depth) || []), instance]);
  }

  const nodes: Node[] = [];
  for (const [depth, row] of rows.entries()) {
    row.forEach((instance, index) => {
      nodes.push({
        id: instance.id,
        position: { x: depth * 330, y: index * 190 },
        data: {
          instance,
          preview: previews[instance.id] || '',
          selected: selectedId === instance.id,
        },
        type: 'terminalPreview',
      });
    });
  }
  return nodes;
}

function buildEdges(instances: TerminalInstance[]): Edge[] {
  return instances
    .filter((instance) => instance.parent_instance_id)
    .map((instance) => ({
      id: `${instance.parent_instance_id}-${instance.id}`,
      source: instance.parent_instance_id!,
      target: instance.id,
      animated: instance.status === 'running',
      style: { stroke: '#3f3f46' },
    }));
}

function TerminalPreviewNode({ data }: { data: { instance: TerminalInstance; preview: string; selected: boolean } }) {
  const preview = data.preview
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .split('\n')
    .slice(-6)
    .join('\n')
    .trim();

  return (
    <div className={`flow-node ${data.selected ? 'selected' : ''}`}>
      <div className="flow-node-header">
        <span className={`status-dot ${data.instance.status}`} />
        <SquareTerminal size={15} />
        <span className="flow-node-title">{data.instance.title}</span>
        <span className="flow-node-kind">{data.instance.kind}</span>
      </div>
      <pre className="flow-node-preview">{preview || 'No output yet.'}</pre>
    </div>
  );
}

const nodeTypes = {
  terminalPreview: TerminalPreviewNode,
};

export function InstanceCanvas({ instances, previews, selectedId, onSelect, onCreateChild }: InstanceCanvasProps) {
  const nodes = layoutInstances(instances, previews, selectedId);
  const edges = buildEdges(instances);

  if (instances.length === 0) {
    return (
      <div className="empty-canvas">
        <GitBranch size={42} />
        <h2>No instances yet</h2>
        <p>Create a shell or Codex terminal to start shaping this session.</p>
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      minZoom={0.35}
      maxZoom={1.4}
      onNodeClick={(_event, node) => onSelect(node.id)}
      onNodeDoubleClick={(_event, node) => onCreateChild(node.id)}
    >
      <Background color="#2b2b2d" gap={28} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
