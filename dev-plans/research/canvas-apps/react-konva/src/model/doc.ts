// Pure, immutable operations on the document tree. Every function returns a new
// Doc and shares untouched nodes, so a history snapshot costs one object spread.
import {
  apply, applyVector, boundsOfPoints, fromTRS, IDENTITY, invert, multiply, rotationOf, unionRects,
  type Mat, type Point, type Rect,
} from './geometry';
import type { Doc, FrameNode, NodePatch, NodeType, SceneNode } from './types';

let seq = 0;
export const newId = (): string => `n${(++seq).toString(36)}`;

const DEFAULTS: Record<NodeType, Partial<SceneNode>> = {
  rect: { fill: '#d9d9d9', stroke: '#000000', strokeWidth: 0 },
  ellipse: { fill: '#d9d9d9', stroke: '#000000', strokeWidth: 0 },
  text: { fill: '#000000', stroke: '#000000', strokeWidth: 0 },
  frame: { fill: '#ffffff', stroke: '#000000', strokeWidth: 0 },
};
const NAMES: Record<NodeType, string> = { rect: 'Rectangle', ellipse: 'Ellipse', text: 'Text', frame: 'Frame' };

export function makeNode(type: NodeType, rect: Rect, extra: Partial<SceneNode> = {}): SceneNode {
  const id = extra.id ?? newId();
  const base = {
    id, type, name: NAMES[type], parentId: null,
    x: rect.x, y: rect.y, w: rect.w, h: rect.h, rotation: 0,
    fill: '#d9d9d9', stroke: '#000000', strokeWidth: 0, cornerRadius: 0, opacity: 1,
    visible: true, locked: false,
    ...DEFAULTS[type],
  };
  if (type === 'text') return { ...base, text: 'Text', fontSize: 24, ...extra, type } as SceneNode;
  if (type === 'frame') return { ...base, children: [], ...extra, type } as SceneNode;
  return { ...base, ...extra, type } as SceneNode;
}

// ---- tree queries -------------------------------------------------------------

export function childIds(doc: Doc, parentId: string | null): readonly string[] {
  if (parentId === null) return doc.root;
  const p = doc.nodes[parentId];
  return p && p.type === 'frame' ? p.children : [];
}

export function ancestors(doc: Doc, id: string): string[] {
  const out: string[] = [];
  let p = doc.nodes[id]?.parentId ?? null;
  while (p) {
    out.push(p);
    p = doc.nodes[p]?.parentId ?? null;
  }
  return out;
}

export function isDescendantOf(doc: Doc, id: string, ancestorId: string): boolean {
  return ancestors(doc, id).includes(ancestorId);
}

/** id and all of its descendants, depth first. */
export function subtree(doc: Doc, id: string, out: string[] = []): string[] {
  out.push(id);
  const n = doc.nodes[id];
  if (n?.type === 'frame') for (const c of n.children) subtree(doc, c, out);
  return out;
}

/** Drops ids whose ancestor is also in the list: moving a frame already moves its children. */
export function topLevel(doc: Doc, ids: readonly string[]): string[] {
  const set = new Set(ids);
  return ids.filter((id) => doc.nodes[id] && !ancestors(doc, id).some((a) => set.has(a)));
}

/** Visible in the tree: the node and all of its ancestors are visible. */
export function isEffectivelyVisible(doc: Doc, id: string): boolean {
  let n: SceneNode | undefined = doc.nodes[id];
  while (n) {
    if (!n.visible) return false;
    n = n.parentId ? doc.nodes[n.parentId] : undefined;
  }
  return true;
}

export function isEffectivelyLocked(doc: Doc, id: string): boolean {
  let n: SceneNode | undefined = doc.nodes[id];
  while (n) {
    if (n.locked) return true;
    n = n.parentId ? doc.nodes[n.parentId] : undefined;
  }
  return false;
}

/** Display order for the layers panel: depth-first, topmost first, like Figma. */
export function flattenTree(doc: Doc, collapsed: ReadonlySet<string> = new Set()): { id: string; depth: number }[] {
  const out: { id: string; depth: number }[] = [];
  const walk = (ids: readonly string[], depth: number) => {
    for (let i = ids.length - 1; i >= 0; i--) {
      const id = ids[i];
      out.push({ id, depth });
      const n = doc.nodes[id];
      if (n?.type === 'frame' && !collapsed.has(id)) walk(n.children, depth + 1);
    }
  };
  walk(doc.root, 0);
  return out;
}

// ---- geometry ---------------------------------------------------------------------

export function localMatrix(n: SceneNode): Mat {
  return fromTRS(n.x, n.y, n.rotation);
}

export function parentMatrix(doc: Doc, id: string): Mat {
  const p = doc.nodes[id]?.parentId;
  return p ? worldMatrix(doc, p) : IDENTITY;
}

export function worldMatrix(doc: Doc, id: string): Mat {
  const n = doc.nodes[id];
  if (!n) return IDENTITY;
  const local = localMatrix(n);
  return n.parentId ? multiply(worldMatrix(doc, n.parentId), local) : local;
}

export function worldCorners(doc: Doc, id: string, m: Mat = worldMatrix(doc, id)): Point[] {
  const n = doc.nodes[id];
  return [
    apply(m, { x: 0, y: 0 }),
    apply(m, { x: n.w, y: 0 }),
    apply(m, { x: n.w, y: n.h }),
    apply(m, { x: 0, y: n.h }),
  ];
}

/** Axis-aligned bounds in world space. */
export function worldBounds(doc: Doc, id: string): Rect {
  return boundsOfPoints(worldCorners(doc, id));
}

export function boundsOf(doc: Doc, ids: readonly string[]): Rect | null {
  return unionRects(ids.filter((id) => doc.nodes[id]).map((id) => worldBounds(doc, id)));
}

// ---- edits ------------------------------------------------------------------------

function withNodes(doc: Doc, changed: Record<string, SceneNode>, root = doc.root): Doc {
  return { nodes: { ...doc.nodes, ...changed }, root };
}

function setChildren(doc: Doc, changed: Record<string, SceneNode>, parentId: string | null, ids: string[]): Doc['root'] {
  if (parentId === null) return ids;
  const frame = (changed[parentId] ?? doc.nodes[parentId]) as FrameNode;
  changed[parentId] = { ...frame, children: ids };
  return doc.root;
}

export function updateNodes(doc: Doc, ids: readonly string[], patch: NodePatch | ((n: SceneNode) => NodePatch)): Doc {
  const changed: Record<string, SceneNode> = {};
  for (const id of ids) {
    const n = doc.nodes[id];
    if (!n) continue;
    const p = typeof patch === 'function' ? patch(n) : patch;
    if (n.type !== 'text') {
      const { text: _t, fontSize: _f, ...rest } = p;
      changed[id] = { ...n, ...rest } as SceneNode;
    } else {
      changed[id] = { ...n, ...p } as SceneNode;
    }
  }
  return withNodes(doc, changed);
}

/**
 * Inserts detached nodes (and their already-wired descendants) under a parent.
 * `roots` are the ids to add to the parent's child list; `all` includes descendants.
 */
export function insertNodes(doc: Doc, all: SceneNode[], roots: string[], parentId: string | null, index?: number): Doc {
  const changed: Record<string, SceneNode> = {};
  const rootSet = new Set(roots);
  for (const n of all) changed[n.id] = rootSet.has(n.id) ? { ...n, parentId } : n;
  const siblings = [...childIds(doc, parentId)];
  siblings.splice(index ?? siblings.length, 0, ...roots);
  const root = setChildren(doc, changed, parentId, siblings);
  return withNodes(doc, changed, root);
}

export function removeNodes(doc: Doc, ids: readonly string[]): Doc {
  const doomed = new Set<string>();
  for (const id of topLevel(doc, ids)) subtree(doc, id).forEach((d) => doomed.add(d));
  if (doomed.size === 0) return doc;
  const nodes: Record<string, SceneNode> = {};
  for (const [id, n] of Object.entries(doc.nodes)) {
    if (doomed.has(id)) continue;
    nodes[id] = n.type === 'frame' && n.children.some((c) => doomed.has(c))
      ? { ...n, children: n.children.filter((c) => !doomed.has(c)) }
      : n;
  }
  return { nodes, root: doc.root.filter((id) => !doomed.has(id)) };
}

/** Moves nodes by a world-space delta; descendants of moved frames follow implicitly. */
export function moveByWorld(doc: Doc, ids: readonly string[], dx: number, dy: number): Doc {
  if (dx === 0 && dy === 0) return doc;
  return updateNodes(doc, topLevel(doc, ids), (n) => {
    const d = n.parentId ? applyVector(invert(worldMatrix(doc, n.parentId)), { x: dx, y: dy }) : { x: dx, y: dy };
    return { x: n.x + d.x, y: n.y + d.y };
  });
}

/**
 * Moves a node to another parent at an index (z position among siblings), keeping its
 * world position and rotation. Used by drop-into-frame and the layers panel.
 */
export function moveInTree(doc: Doc, id: string, newParentId: string | null, index?: number): Doc {
  const n = doc.nodes[id];
  if (!n || id === newParentId) return doc;
  if (newParentId && (isDescendantOf(doc, newParentId, id) || doc.nodes[newParentId]?.type !== 'frame')) return doc;
  const world = worldMatrix(doc, id);
  const newParentWorld = newParentId ? worldMatrix(doc, newParentId) : IDENTITY;
  const local = multiply(invert(newParentWorld), world);

  const changed: Record<string, SceneNode> = {};
  // detach
  const oldSiblings = childIds(doc, n.parentId).filter((c) => c !== id);
  let root = setChildren(doc, changed, n.parentId, oldSiblings);
  const detached: Doc = { nodes: { ...doc.nodes, ...changed }, root };
  // attach
  const siblings = [...childIds(detached, newParentId)];
  const at = index === undefined ? siblings.length : Math.max(0, Math.min(index, siblings.length));
  siblings.splice(at, 0, id);
  root = setChildren(detached, changed, newParentId, siblings);
  changed[id] = { ...n, parentId: newParentId, x: local[4], y: local[5], rotation: normalizeAngle(rotationOf(local)) };
  return withNodes(doc, changed, root);
}

export function normalizeAngle(deg: number): number {
  let r = Math.round(deg * 1e6) / 1e6 % 360;
  if (r > 180) r -= 360;
  if (r <= -180) r += 360;
  return r === 0 ? 0 : r; // no -0
}

/** Raises (+1) or lowers (-1) nodes one step among their siblings. */
export function bringForward(doc: Doc, ids: readonly string[], dir: 1 | -1): Doc {
  let out = doc;
  for (const id of dir === 1 ? [...ids].reverse() : ids) {
    const n = out.nodes[id];
    if (!n) continue;
    const sibs = childIds(out, n.parentId);
    const i = sibs.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= sibs.length) continue;
    out = moveInTree(out, id, n.parentId, j);
  }
  return out;
}

/** Deep-copies subtrees with fresh ids. Returns detached nodes and the new root ids. */
export function cloneSubtrees(doc: Doc, ids: readonly string[], offset = 0): { nodes: SceneNode[]; roots: string[] } {
  const nodes: SceneNode[] = [];
  const copy = (id: string, parentId: string | null, isRoot: boolean): string => {
    const n = doc.nodes[id];
    const nid = newId();
    const clone = { ...n, id: nid, parentId } as SceneNode;
    if (isRoot) { clone.x += offset; clone.y += offset; }
    nodes.push(clone);
    if (clone.type === 'frame') clone.children = (n as FrameNode).children.map((c) => copy(c, nid, false));
    return nid;
  };
  const roots = topLevel(doc, ids).map((id) => copy(id, doc.nodes[id].parentId, true));
  return { nodes, roots };
}

/**
 * A clipboard payload: subtrees re-expressed in world space so they paste
 * correctly at the top level even if they came out of a rotated frame.
 */
export function extractForClipboard(doc: Doc, ids: readonly string[]): { nodes: SceneNode[]; roots: string[] } {
  const top = topLevel(doc, ids);
  const nodes: SceneNode[] = [];
  for (const id of top) {
    for (const d of subtree(doc, id)) {
      const n = doc.nodes[d];
      if (d === id) {
        const m = worldMatrix(doc, id);
        nodes.push({ ...n, parentId: null, x: m[4], y: m[5], rotation: normalizeAngle(rotationOf(m)) });
      } else nodes.push(n);
    }
  }
  return { nodes, roots: top };
}

/** Re-ids a clipboard payload so it can be inserted (possibly many times). */
export function reidentify(payload: { nodes: SceneNode[]; roots: string[] }, offset: number): { nodes: SceneNode[]; roots: string[] } {
  const map = new Map<string, string>();
  for (const n of payload.nodes) map.set(n.id, newId());
  const nodes = payload.nodes.map((n) => {
    const c = { ...n, id: map.get(n.id)!, parentId: n.parentId ? map.get(n.parentId) ?? null : null } as SceneNode;
    if (c.type === 'frame') c.children = (n as FrameNode).children.map((x) => map.get(x)!);
    if (payload.roots.includes(n.id)) { c.x += offset; c.y += offset; }
    return c;
  });
  return { nodes, roots: payload.roots.map((r) => map.get(r)!) };
}
