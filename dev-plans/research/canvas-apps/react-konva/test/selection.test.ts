import { describe, expect, it } from 'vitest';
import { clickSelect, frameAt, hitTest, marqueeHits } from '../src/model/selection';
import { docOf } from './helpers';

describe('hitTest', () => {
  const doc = docOf(
    { id: 'a', type: 'rect', x: 0, y: 0 },
    { id: 'b', type: 'rect', x: 50, y: 50 }, // above a
    { id: 'e', type: 'ellipse', x: 300, y: 0 },
  );

  it('picks the topmost node', () => {
    expect(hitTest(doc, { x: 75, y: 75 })).toBe('b');
    expect(hitTest(doc, { x: 25, y: 25 })).toBe('a');
    expect(hitTest(doc, { x: 200, y: 200 })).toBeNull();
  });

  it('uses the real ellipse shape, not its box', () => {
    expect(hitTest(doc, { x: 350, y: 50 })).toBe('e');
    expect(hitTest(doc, { x: 303, y: 3 })).toBeNull(); // corner of the bounding box
  });

  it('accounts for rotation', () => {
    const d = docOf({ id: 'r', type: 'rect', x: 0, y: 0, w: 100, h: 10, rotation: 90 });
    // rotated 90° clockwise around its origin: occupies x ∈ [-10, 0], y ∈ [0, 100]
    expect(hitTest(d, { x: -5, y: 50 })).toBe('r');
    expect(hitTest(d, { x: 50, y: 5 })).toBeNull();
  });

  it('skips hidden and locked nodes', () => {
    const d = docOf({ id: 'low', type: 'rect' }, { id: 'hid', type: 'rect', visible: false }, { id: 'lock', type: 'rect', locked: true });
    // a locked node blocks clicks (Figma: you cannot select through it), a hidden one does not
    expect(hitTest(d, { x: 10, y: 10 })).toBeNull();
    const d2 = docOf({ id: 'low', type: 'rect' }, { id: 'hid', type: 'rect', visible: false });
    expect(hitTest(d2, { x: 10, y: 10 })).toBe('low');
  });

  it('prefers a frame child, falls back to the frame, and clips children', () => {
    const d = docOf(
      { id: 'f', type: 'frame', x: 100, y: 100, w: 200, h: 200, kids: ['c', 'out'] },
      { id: 'c', type: 'rect', x: 10, y: 10, w: 50, h: 50 },
      { id: 'out', type: 'rect', x: 180, y: 180, w: 100, h: 100 }, // overflows the frame
    );
    expect(hitTest(d, { x: 120, y: 120 })).toBe('c');
    expect(hitTest(d, { x: 250, y: 150 })).toBe('f');
    expect(hitTest(d, { x: 290, y: 290 })).toBe('out');
    expect(hitTest(d, { x: 350, y: 350 })).toBeNull(); // the clipped part of `out`
  });
});

describe('marquee', () => {
  it('selects top-level nodes touching the rect, not frame children or locked ones', () => {
    const d = docOf(
      { id: 'a', type: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { id: 'b', type: 'rect', x: 100, y: 0, w: 10, h: 10 },
      { id: 'l', type: 'rect', x: 0, y: 0, w: 10, h: 10, locked: true },
      { id: 'f', type: 'frame', x: 0, y: 50, w: 50, h: 50, kids: ['c'] },
      { id: 'c', type: 'rect', x: 0, y: 0, w: 10, h: 10 },
    );
    expect(marqueeHits(d, { x: -5, y: -5, w: 20, h: 60 })).toEqual(['a', 'f']);
    expect(marqueeHits(d, { x: 95, y: -5, w: 20, h: 20 })).toEqual(['b']);
  });
});

describe('clickSelect', () => {
  it('replaces, toggles with shift, keeps a multi-selection when clicking a member', () => {
    expect(clickSelect(['a'], 'b', false)).toEqual(['b']);
    expect(clickSelect(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(clickSelect(['a', 'b'], 'a', true)).toEqual(['b']);
    expect(clickSelect(['a', 'b'], 'a', false)).toEqual(['a', 'b']); // narrowed on pointerup if no drag
    expect(clickSelect(['a'], null, false)).toEqual([]);
    expect(clickSelect(['a'], null, true)).toEqual(['a']);
  });
});

describe('frameAt', () => {
  it('finds the innermost frame under a point, skipping excluded ones', () => {
    const d = docOf(
      { id: 'outer', type: 'frame', x: 0, y: 0, w: 400, h: 400, kids: ['inner'] },
      { id: 'inner', type: 'frame', x: 100, y: 100, w: 100, h: 100 },
    );
    expect(frameAt(d, { x: 150, y: 150 })).toBe('inner');
    expect(frameAt(d, { x: 50, y: 50 })).toBe('outer');
    expect(frameAt(d, { x: 150, y: 150 }, new Set(['inner']))).toBe('outer');
    expect(frameAt(d, { x: 500, y: 500 })).toBeNull();
  });
});
