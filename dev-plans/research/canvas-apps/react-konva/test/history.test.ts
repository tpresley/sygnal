import { beforeEach, describe, expect, it } from 'vitest';
import { HISTORY_LIMIT, resetEditor, useEditor } from '../src/store/editor';
import { docOf } from './helpers';

const ed = () => useEditor.getState();
const xOf = (id: string) => ed().doc.nodes[id]?.x;

beforeEach(() => {
  resetEditor();
  ed().loadDoc(docOf({ id: 'a', type: 'rect', x: 0 }, { id: 'b', type: 'ellipse', x: 200 }));
});

describe('undo / redo', () => {
  it('undoes and redoes an edit, restoring the selection with it', () => {
    ed().select(['a']);
    ed().updateSelected({ x: 50, fill: '#ff0000' });
    ed().select(['b']);
    ed().undo();
    expect(xOf('a')).toBe(0);
    expect(ed().doc.nodes.a.fill).toBe('#d9d9d9');
    expect(ed().selection).toEqual(['a']); // the selection at the time of the edit
    ed().redo();
    expect(xOf('a')).toBe(50);
  });

  it('selection changes alone are not undo steps', () => {
    ed().select(['a']);
    ed().select(['b']);
    expect(ed().past).toHaveLength(0);
  });

  it('a new edit clears the redo stack', () => {
    ed().select(['a']);
    ed().nudge(1, 0);
    ed().undo();
    expect(ed().future).toHaveLength(1);
    ed().nudge(0, 1);
    expect(ed().future).toHaveLength(0);
    ed().redo(); // no-op
    expect(xOf('a')).toBe(0);
    expect(ed().doc.nodes.a.y).toBe(1);
  });

  it('undo and redo at the ends of history are no-ops', () => {
    const doc = ed().doc;
    ed().undo();
    ed().redo();
    expect(ed().doc).toBe(doc);
  });

  it('keeps at most HISTORY_LIMIT steps', () => {
    ed().select(['a']);
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) ed().nudge(1, 0);
    expect(ed().past).toHaveLength(HISTORY_LIMIT);
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) ed().undo();
    expect(xOf('a')).toBe(20);
  });

  it('snapshots share untouched nodes (structural sharing)', () => {
    ed().select(['a']);
    ed().nudge(5, 0);
    const before = ed().past[0].doc;
    expect(ed().doc.nodes.b).toBe(before.nodes.b);
    expect(ed().doc.nodes.a).not.toBe(before.nodes.a);
  });
});

describe('editing commands are undoable', () => {
  it('delete', () => {
    ed().select(['a', 'b']);
    ed().deleteSelected();
    expect(ed().doc.root).toEqual([]);
    expect(ed().selection).toEqual([]);
    ed().undo();
    expect(ed().doc.root).toEqual(['a', 'b']);
    expect(ed().selection).toEqual(['a', 'b']);
  });

  it('duplicate selects the copies, offset by 10', () => {
    ed().select(['a']);
    ed().duplicate();
    const [copy] = ed().selection;
    expect(copy).not.toBe('a');
    expect(xOf(copy)).toBe(10);
    expect(ed().doc.root).toEqual(['a', 'b', copy]);
    ed().undo();
    expect(ed().doc.root).toEqual(['a', 'b']);
  });

  it('copy / paste pastes fresh copies, cascading the offset', () => {
    ed().select(['b']);
    ed().copy();
    ed().paste();
    const p1 = ed().selection[0];
    ed().paste();
    const p2 = ed().selection[0];
    expect(new Set([p1, p2, 'b']).size).toBe(3);
    expect([xOf(p1), xOf(p2)]).toEqual([210, 220]);
    ed().undo();
    ed().undo();
    expect(ed().doc.root).toEqual(['a', 'b']);
  });

  it('transformer results are one step', () => {
    ed().applyTransforms([{ id: 'a', x: 5, y: 6, w: 70, h: 0.2, rotation: 30 }]);
    expect(ed().doc.nodes.a).toMatchObject({ x: 5, y: 6, w: 70, h: 1, rotation: 30 });
    ed().undo();
    expect(ed().doc.nodes.a).toMatchObject({ x: 0, y: 0, w: 100, h: 100, rotation: 0 });
  });

  it('property edits are clamped', () => {
    ed().select(['a']);
    ed().updateSelected({ opacity: 3, w: -5, cornerRadius: -1 });
    expect(ed().doc.nodes.a).toMatchObject({ opacity: 1, w: 1, cornerRadius: 0 });
  });
});
