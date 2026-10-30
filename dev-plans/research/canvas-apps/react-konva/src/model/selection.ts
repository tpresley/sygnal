// Hit testing and selection rules in plain geometry. The shape layers are
// listening={false}, so Konva never draws a hit canvas; picking happens here.
import { apply, invert, multiply, rectsIntersect, type Mat, type Point, type Rect } from './geometry';
import { localMatrix, worldBounds } from './doc';
import type { Doc, SceneNode } from './types';

function containsLocal(n: SceneNode, p: Point): boolean {
  if (n.type === 'ellipse') {
    const rx = n.w / 2, ry = n.h / 2;
    if (rx === 0 || ry === 0) return false;
    const dx = (p.x - rx) / rx, dy = (p.y - ry) / ry;
    return dx * dx + dy * dy <= 1;
  }
  return p.x >= 0 && p.y >= 0 && p.x <= n.w && p.y <= n.h;
}

/**
 * Topmost unlocked, visible node under a world point. Children of a frame are
 * picked before the frame (Figma lets you click straight into a top-level frame)
 * and only inside the frame's clip.
 */
export function hitTest(doc: Doc, world: Point): string | null {
  const visit = (ids: readonly string[], parent: Mat): string | null => {
    for (let i = ids.length - 1; i >= 0; i--) {
      const n = doc.nodes[ids[i]];
      if (!n || !n.visible) continue;
      const m = multiply(parent, localMatrix(n));
      const local = apply(invert(m), world);
      if (n.type === 'frame') {
        if (!containsLocal(n, local)) continue; // clipped
        if (!n.locked) {
          const child = visit(n.children, m);
          if (child) return child;
        }
        if (!n.locked) return n.id;
        return null; // a locked frame blocks what is below it, like Figma
      }
      if (containsLocal(n, local)) return n.locked ? null : n.id;
    }
    return null;
  };
  return visit(doc.root, [1, 0, 0, 1, 0, 0]);
}

/** Top-level, visible, unlocked nodes whose world bounds touch the marquee. */
export function marqueeHits(doc: Doc, marquee: Rect, bounds?: Map<string, Rect>): string[] {
  const out: string[] = [];
  for (const id of doc.root) {
    const n = doc.nodes[id];
    if (!n.visible || n.locked) continue;
    const b = bounds?.get(id) ?? worldBounds(doc, id);
    if (rectsIntersect(b, marquee)) out.push(id);
  }
  return out;
}

/** Topmost visible frame under a world point, skipping `exclude` subtrees (the dragged nodes). */
export function frameAt(doc: Doc, world: Point, exclude: ReadonlySet<string> = new Set()): string | null {
  const visit = (ids: readonly string[], parent: Mat): string | null => {
    for (let i = ids.length - 1; i >= 0; i--) {
      const n = doc.nodes[ids[i]];
      if (!n || !n.visible || n.type !== 'frame' || exclude.has(n.id)) continue;
      const m = multiply(parent, localMatrix(n));
      if (!containsLocal(n, apply(invert(m), world))) continue;
      return visit(n.children, m) ?? n.id;
    }
    return null;
  };
  return visit(doc.root, [1, 0, 0, 1, 0, 0]);
}

/** Click semantics: plain click replaces, shift-click toggles. */
export function clickSelect(selection: readonly string[], hit: string | null, shift: boolean): string[] {
  if (!hit) return shift ? [...selection] : [];
  if (!shift) return selection.includes(hit) ? [...selection] : [hit];
  return selection.includes(hit) ? selection.filter((s) => s !== hit) : [...selection, hit];
}
