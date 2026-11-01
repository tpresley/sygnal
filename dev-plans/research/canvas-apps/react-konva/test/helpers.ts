import { makeNode } from '../src/model/doc';
import type { Doc, FrameNode, SceneNode } from '../src/model/types';

/** Builds a doc from a compact spec; frames list their children by id. */
export function docOf(...specs: (Partial<SceneNode> & { id: string; type: SceneNode['type']; kids?: string[] })[]): Doc {
  const nodes: Record<string, SceneNode> = {};
  for (const { kids, ...s } of specs) {
    nodes[s.id] = makeNode(s.type, { x: s.x ?? 0, y: s.y ?? 0, w: s.w ?? 100, h: s.h ?? 100 }, s);
    if (s.type === 'frame') (nodes[s.id] as FrameNode).children = kids ?? [];
  }
  for (const n of Object.values(nodes)) {
    if (n.type === 'frame') for (const c of n.children) nodes[c] = { ...nodes[c], parentId: n.id };
  }
  const root = Object.values(nodes).filter((n) => !n.parentId).map((n) => n.id);
  return { nodes, root };
}

export const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
