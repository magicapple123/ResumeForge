// SPDX-License-Identifier: Apache-2.0
/** Pure relationship layout: newest-first within each source, alternating sources. */
export type GraphResumeKind = "internal" | "external";
export interface GraphResume {
  id: number;
  title: string;
  kind: GraphResumeKind;
  updatedAt: string;
}
export interface GraphResumeNode extends GraphResume {
  key: string;
  x: number;
  y: number;
  edge: string;
}
export const GRAPH_RESUME_LIMIT = 60;
export const GRAPH_WIDTH = 1000;
export const GRAPH_NODE_WIDTH = 260;
export const GRAPH_NODE_HEIGHT = 76;
const GRAPH_ROW_PITCH = 96;

function recentFirst(a: GraphResume, b: GraphResume): number {
  return b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id;
}

export function jobResumeGraphLayout(internal: GraphResume[], external: GraphResume[]) {
  const recent = [...internal, ...external].sort(recentFirst).slice(0, GRAPH_RESUME_LIMIT);
  const queues = [
    recent.filter((resume) => resume.kind === "internal"),
    recent.filter((resume) => resume.kind === "external"),
  ];
  let next =
    !queues[0].length || (queues[1].length && recentFirst(queues[0][0], queues[1][0]) > 0) ? 1 : 0;
  const ordered: GraphResume[] = [];
  while (ordered.length < GRAPH_RESUME_LIMIT && (queues[0].length || queues[1].length)) {
    const item = queues[next].shift() ?? queues[1 - next].shift();
    if (item) ordered.push(item);
    next = 1 - next;
  }
  const rows = Math.ceil(ordered.length / 2);
  const height = Math.max(420, rows * GRAPH_ROW_PITCH + 80);
  const job = { x: 410, y: height / 2 - 50, width: 180, height: 100 };
  const nodes: GraphResumeNode[] = ordered.map((item, index) => {
    const left = index % 2 === 0;
    const x = left ? 20 : 720;
    const y = (height - rows * GRAPH_ROW_PITCH + 24) / 2 + Math.floor(index / 2) * GRAPH_ROW_PITCH;
    const fromX = left ? job.x : job.x + job.width;
    const toX = left ? x + GRAPH_NODE_WIDTH : x;
    const fromY = height / 2;
    const toY = y + GRAPH_NODE_HEIGHT / 2;
    const middle = (fromX + toX) / 2;
    return {
      ...item,
      key: `${item.kind}:${item.id}`,
      x,
      y,
      edge: `M ${fromX} ${fromY} C ${middle} ${fromY}, ${middle} ${toY}, ${toX} ${toY}`,
    };
  });
  return { width: GRAPH_WIDTH, height, job, nodes, total: internal.length + external.length };
}
