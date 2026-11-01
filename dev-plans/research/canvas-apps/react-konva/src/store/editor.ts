// The document store. One Zustand store holds what undo covers (doc + selection)
// and the tool; everything that changes per pointer frame lives in ./view.ts so
// the 10k per-node subscriptions here are not re-run on every mouse move.
import { create } from 'zustand';
import {
  bringForward, cloneSubtrees, extractForClipboard, insertNodes, makeNode, moveByWorld, moveInTree,
  normalizeAngle, reidentify, removeNodes, topLevel, updateNodes, worldMatrix,
} from '../model/doc';
import { apply, invert, rotationOf, type Rect } from '../model/geometry';
import { frameAt } from '../model/selection';
import type { Doc, NodePatch, NodeType, SceneNode, Tool } from '../model/types';
import { EMPTY_DOC } from '../model/types';

interface Snapshot { doc: Doc; selection: string[] }
interface Clip { nodes: SceneNode[]; roots: string[] }

export const HISTORY_LIMIT = 200;

export interface EditorState {
  doc: Doc;
  selection: string[];
  tool: Tool;
  past: Snapshot[];
  future: Snapshot[];
  clipboard: Clip | null;
  pasteCount: number;

  setTool(tool: Tool): void;
  select(ids: string[]): void;
  /** Applies an edit as one undo step. */
  commit(doc: Doc, selection?: string[]): void;
  undo(): void;
  redo(): void;
  loadDoc(doc: Doc): void;

  createNode(type: NodeType, rect: Rect, extra?: Partial<SceneNode>): string;
  updateSelected(patch: NodePatch): void;
  updateNode(id: string, patch: NodePatch): void;
  /** Results of a Transformer gesture: local x/y/w/h/rotation per node. */
  applyTransforms(updates: { id: string; x: number; y: number; w: number; h: number; rotation: number }[]): void;
  /** End of a drag: move by a world delta and drop into the frame under the pointer. */
  dropMove(ids: string[], dx: number, dy: number, dropParent: string | null | undefined): void;
  nudge(dx: number, dy: number): void;
  deleteSelected(): void;
  duplicate(): void;
  copy(): void;
  cut(): void;
  paste(): void;
  selectAll(): void;
  moveLayer(id: string, parentId: string | null, index: number): void;
  reorder(dir: 1 | -1): void;
}

const initial = {
  doc: EMPTY_DOC, selection: [] as string[], tool: 'select' as Tool,
  past: [] as Snapshot[], future: [] as Snapshot[], clipboard: null as Clip | null, pasteCount: 0,
};

export const useEditor = create<EditorState>()((set, get) => ({
  ...initial,

  setTool: (tool) => set({ tool }),
  select: (ids) => {
    const cur = get().selection;
    if (ids.length === cur.length && ids.every((id, i) => id === cur[i])) return;
    set({ selection: ids });
  },
  commit: (doc, selection) => {
    const s = get();
    if (doc === s.doc && (!selection || selection === s.selection)) return;
    set({
      doc,
      selection: (selection ?? s.selection).filter((id) => doc.nodes[id]),
      past: [...s.past.slice(-(HISTORY_LIMIT - 1)), { doc: s.doc, selection: s.selection }],
      future: [],
    });
  },
  undo: () => {
    const { past, future, doc, selection } = get();
    const prev = past[past.length - 1];
    if (!prev) return;
    set({ ...prev, past: past.slice(0, -1), future: [{ doc, selection }, ...future] });
  },
  redo: () => {
    const { past, future, doc, selection } = get();
    const next = future[0];
    if (!next) return;
    set({ ...next, past: [...past, { doc, selection }], future: future.slice(1) });
  },
  loadDoc: (doc) => set({ ...initial, doc, tool: get().tool }),

  createNode: (type, rect, extra) => {
    const { doc } = get();
    // a shape drawn inside a frame becomes its child, in the frame's local space
    const parentId = frameAt(doc, { x: rect.x, y: rect.y });
    const node = makeNode(type, rect, extra);
    const placed = parentId ? toParentSpace(doc, node, parentId) : node;
    get().commit(insertNodes(doc, [placed], [placed.id], parentId), [placed.id]);
    return placed.id;
  },
  updateSelected: (patch) => {
    const { doc, selection } = get();
    get().commit(updateNodes(doc, selection, clampPatch(patch)));
  },
  updateNode: (id, patch) => get().commit(updateNodes(get().doc, [id], clampPatch(patch))),
  applyTransforms: (updates) => {
    const byId = new Map(updates.map((u) => [u.id, u]));
    const { doc } = get();
    get().commit(updateNodes(doc, [...byId.keys()], (n) => {
      const u = byId.get(n.id)!;
      return { x: u.x, y: u.y, w: Math.max(1, u.w), h: Math.max(1, u.h), rotation: u.rotation };
    }));
  },
  dropMove: (ids, dx, dy, dropParent) => {
    let doc = moveByWorld(get().doc, ids, dx, dy);
    if (dropParent !== undefined) {
      for (const id of topLevel(doc, ids)) {
        if (doc.nodes[id].parentId !== dropParent) doc = moveInTree(doc, id, dropParent);
      }
    }
    get().commit(doc);
  },
  nudge: (dx, dy) => {
    const { doc, selection } = get();
    if (selection.length) get().commit(moveByWorld(doc, selection, dx, dy));
  },
  deleteSelected: () => {
    const { doc, selection } = get();
    if (selection.length) get().commit(removeNodes(doc, selection), []);
  },
  duplicate: () => {
    const { doc, selection } = get();
    if (!selection.length) return;
    let out = doc;
    const newIds: string[] = [];
    for (const id of topLevel(doc, selection)) {
      const { nodes, roots } = cloneSubtrees(doc, [id], 10);
      const parentId = doc.nodes[id].parentId;
      out = insertNodes(out, nodes, roots, parentId);
      newIds.push(...roots);
    }
    get().commit(out, newIds);
  },
  copy: () => {
    const { doc, selection } = get();
    if (selection.length) set({ clipboard: extractForClipboard(doc, selection), pasteCount: 0 });
  },
  cut: () => { get().copy(); get().deleteSelected(); },
  paste: () => {
    const { clipboard, pasteCount, doc } = get();
    if (!clipboard) return;
    const { nodes, roots } = reidentify(clipboard, 10 * (pasteCount + 1));
    set({ pasteCount: pasteCount + 1 });
    get().commit(insertNodes(doc, nodes, roots, null), roots);
  },
  selectAll: () => {
    const { doc } = get();
    get().select(doc.root.filter((id) => doc.nodes[id].visible && !doc.nodes[id].locked));
  },
  moveLayer: (id, parentId, index) => get().commit(moveInTree(get().doc, id, parentId, index)),
  reorder: (dir) => {
    const { doc, selection } = get();
    get().commit(bringForward(doc, topLevel(doc, selection), dir));
  },
}));

export function resetEditor() {
  useEditor.setState(initial);
}

function clampPatch(p: NodePatch): NodePatch {
  const out = { ...p };
  if (out.w !== undefined) out.w = Math.max(1, out.w);
  if (out.h !== undefined) out.h = Math.max(1, out.h);
  if (out.opacity !== undefined) out.opacity = Math.min(1, Math.max(0, out.opacity));
  if (out.cornerRadius !== undefined) out.cornerRadius = Math.max(0, out.cornerRadius);
  if (out.strokeWidth !== undefined) out.strokeWidth = Math.max(0, out.strokeWidth);
  return out;
}

function toParentSpace(doc: Doc, node: SceneNode, parentId: string): SceneNode {
  const m = invert(worldMatrix(doc, parentId));
  const p = apply(m, { x: node.x, y: node.y });
  return { ...node, x: p.x, y: p.y, rotation: normalizeAngle(rotationOf(m)) };
}
