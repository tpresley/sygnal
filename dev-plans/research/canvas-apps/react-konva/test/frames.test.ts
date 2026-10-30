import { describe, expect, it } from 'vitest';
import {
  cloneSubtrees, extractForClipboard, flattenTree, moveByWorld, moveInTree, removeNodes, reidentify,
  topLevel, worldBounds, worldMatrix,
} from '../src/model/doc';
import { apply } from '../src/model/geometry';
import { resetEditor, useEditor } from '../src/store/editor';
import { docOf, near } from './helpers';

const tree = () => docOf(
  { id: 'f', type: 'frame', x: 100, y: 100, w: 300, h: 300, kids: ['g', 'c'] },
  { id: 'g', type: 'frame', x: 50, y: 50, w: 100, h: 100, kids: ['gc'] },
  { id: 'gc', type: 'rect', x: 10, y: 10, w: 20, h: 20 },
  { id: 'c', type: 'ellipse', x: 200, y: 0, w: 50, h: 50 },
  { id: 'loose', type: 'rect', x: 600, y: 0 },
);

describe('frame hierarchy', () => {
  it('children are positioned relative to their frame', () => {
    const d = tree();
    expect(worldBounds(d, 'gc')).toEqual({ x: 160, y: 160, w: 20, h: 20 });
  });

  it('moving a frame moves its descendants', () => {
    const d = moveByWorld(tree(), ['f'], 10, -5);
    expect(worldBounds(d, 'gc')).toEqual({ x: 170, y: 155, w: 20, h: 20 });
    expect(d.nodes.gc.x).toBe(10); // local position unchanged
  });

  it('a selected child of a selected frame moves once, not twice', () => {
    const d = moveByWorld(tree(), ['f', 'gc'], 10, 0);
    expect(worldBounds(d, 'gc').x).toBe(170);
    expect(topLevel(tree(), ['gc', 'f', 'loose'])).toEqual(['f', 'loose']);
  });

  it('moves in world space inside a rotated frame', () => {
    let d = tree();
    d = { ...d, nodes: { ...d.nodes, f: { ...d.nodes.f, rotation: 90 } } };
    const before = worldBounds(d, 'c');
    d = moveByWorld(d, ['c'], 10, 0);
    const after = worldBounds(d, 'c');
    expect(near(after.x - before.x, 10)).toBe(true);
    expect(near(after.y - before.y, 0)).toBe(true);
  });

  it('reparenting keeps the world transform', () => {
    let d = tree();
    d = { ...d, nodes: { ...d.nodes, f: { ...d.nodes.f, rotation: 30 } } };
    const m0 = worldMatrix(d, 'gc');
    const out = moveInTree(d, 'gc', null);
    const m1 = worldMatrix(out, 'gc');
    m0.forEach((v, i) => expect(near(v, m1[i])).toBe(true));
    expect(out.root).toEqual(['f', 'loose', 'gc']);
    expect((out.nodes.g as { children: string[] }).children).toEqual([]);
    expect(out.nodes.gc.parentId).toBeNull();

    const back = moveInTree(out, 'gc', 'g', 0);
    const m2 = worldMatrix(back, 'gc');
    m0.forEach((v, i) => expect(near(v, m2[i])).toBe(true));
    expect(back.nodes.gc.parentId).toBe('g');
  });

  it('refuses cycles and non-frame parents', () => {
    const d = tree();
    expect(moveInTree(d, 'f', 'g')).toBe(d);
    expect(moveInTree(d, 'f', 'f')).toBe(d);
    expect(moveInTree(d, 'loose', 'c')).toBe(d);
  });

  it('reorders among siblings', () => {
    const d = moveInTree(tree(), 'c', 'f', 0);
    expect((d.nodes.f as { children: string[] }).children).toEqual(['c', 'g']);
  });

  it('deleting a frame deletes its subtree', () => {
    const d = removeNodes(tree(), ['g']);
    expect(Object.keys(d.nodes).sort()).toEqual(['c', 'f', 'loose']);
    expect((d.nodes.f as { children: string[] }).children).toEqual(['c']);
  });

  it('lists layers topmost first, depth first, honouring collapsed frames', () => {
    expect(flattenTree(tree()).map((r) => `${r.depth}${r.id}`)).toEqual(['0loose', '0f', '1c', '1g', '2gc']);
    expect(flattenTree(tree(), new Set(['g'])).map((r) => r.id)).toEqual(['loose', 'f', 'c', 'g']);
  });

  it('duplicating a frame deep-copies its children with new ids', () => {
    const d = tree();
    const { nodes, roots } = cloneSubtrees(d, ['g'], 10);
    expect(nodes).toHaveLength(2);
    const [copy, child] = nodes;
    expect(roots).toEqual([copy.id]);
    expect(copy).toMatchObject({ type: 'frame', parentId: 'f', x: 60, y: 60 });
    expect((copy as { children: string[] }).children).toEqual([child.id]);
    expect(child).toMatchObject({ parentId: copy.id, x: 10, y: 10 });
  });

  it('copying out of a rotated frame pastes at the same world position', () => {
    let d = tree();
    d = { ...d, nodes: { ...d.nodes, f: { ...d.nodes.f, rotation: 45 } } };
    const clip = reidentify(extractForClipboard(d, ['c']), 0);
    const pasted = { nodes: { ...d.nodes, ...Object.fromEntries(clip.nodes.map((n) => [n.id, n])) }, root: [...d.root, ...clip.roots] };
    const p0 = apply(worldMatrix(d, 'c'), { x: 0, y: 0 });
    const p1 = apply(worldMatrix(pasted, clip.roots[0]), { x: 0, y: 0 });
    expect(near(p0.x, p1.x) && near(p0.y, p1.y)).toBe(true);
    expect(pasted.nodes[clip.roots[0]].rotation).toBeCloseTo(45);
  });
});

describe('frames through the store', () => {
  it('a shape drawn inside a frame becomes its child', () => {
    resetEditor();
    useEditor.getState().loadDoc(tree());
    const id = useEditor.getState().createNode('rect', { x: 120, y: 120, w: 10, h: 10 });
    const d = useEditor.getState().doc;
    expect(d.nodes[id].parentId).toBe('f');
    expect(worldBounds(d, id)).toEqual({ x: 120, y: 120, w: 10, h: 10 });
  });

  it('dropping into a frame reparents; dragging out moves back to the page; one undo step each', () => {
    resetEditor();
    useEditor.getState().loadDoc(tree());
    const s = () => useEditor.getState();
    s().dropMove(['loose'], -400, 150, 'f');
    expect(s().doc.nodes.loose.parentId).toBe('f');
    expect(worldBounds(s().doc, 'loose')).toMatchObject({ x: 200, y: 150 });
    s().dropMove(['gc'], 1000, 0, null);
    expect(s().doc.nodes.gc.parentId).toBeNull();
    expect(worldBounds(s().doc, 'gc')).toMatchObject({ x: 1160, y: 160 });
    s().undo();
    expect(s().doc.nodes.gc.parentId).toBe('g');
    s().undo();
    expect(s().doc.nodes.loose.parentId).toBeNull();
  });
});
