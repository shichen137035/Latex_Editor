interface LayoutNode { id: string }
interface LayoutEdge { from: string; to: string }
interface LayoutRequest { nodes: LayoutNode[]; edges: LayoutEdge[]; previous?: Record<string, { x: number; y: number }> }

// A small cycle-safe layered layout keeps v0.3.4 functional without adding a
// runtime dependency. The worker boundary is compatible with a future ELK
// adapter, so large graphs never perform ranking on the renderer thread.
self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const { nodes, edges, previous = {} } = event.data;
  const ids = new Set(nodes.map((node) => node.id));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }
  const levels = new Map<string, number>();
  const queue = nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  if (!queue.length && nodes[0]) queue.push(nodes[0].id);
  const visited = new Set<string>();
  while (queue.length) {
    const id = queue.shift();
    if (!id || visited.has(id)) continue;
    visited.add(id);
    const level = levels.get(id) ?? 0;
    for (const next of outgoing.get(id) ?? []) {
      levels.set(next, Math.max(levels.get(next) ?? 0, level + 1));
      incoming.set(next, Math.max(0, (incoming.get(next) ?? 0) - 1));
      if (incoming.get(next) === 0) queue.push(next);
    }
  }
  // Cyclic leftovers are placed next to the nearest already-ranked neighbor.
  for (const node of nodes) if (!levels.has(node.id)) {
    const neighbor = edges.find((edge) => edge.to === node.id && levels.has(edge.from));
    levels.set(node.id, neighbor ? (levels.get(neighbor.from) ?? 0) + 1 : 0);
  }
  const columns = new Map<number, string[]>();
  for (const node of nodes) {
    const level = levels.get(node.id) ?? 0;
    columns.set(level, [...(columns.get(level) ?? []), node.id]);
  }
  const rowPitch = 94;
  const nodeHeight = 64;
  const tallestColumn = Math.max(0, ...[...columns.values()].map((column) => (column.length - 1) * rowPitch + nodeHeight));
  const positions: Record<string, { x: number; y: number }> = {};
  for (const [level, column] of columns) {
    column.sort((a, b) => (previous[a]?.y ?? Number.MAX_SAFE_INTEGER) - (previous[b]?.y ?? Number.MAX_SAFE_INTEGER));
    const columnHeight = (column.length - 1) * rowPitch + nodeHeight;
    const top = 42 + (tallestColumn - columnHeight) / 2;
    column.forEach((id, index) => { positions[id] = { x: 42 + level * 230, y: top + index * rowPitch }; });
  }
  self.postMessage({ positions });
};

export {};
