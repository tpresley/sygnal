import { describe, expect, it } from 'vitest';
import { buildSnapTargets, snapRect } from '../src/model/snapping';

const targets = buildSnapTargets([
  { x: 0, y: 0, w: 100, h: 100 },
  { x: 300, y: 200, w: 50, h: 50 },
]);

describe('snapRect', () => {
  it('snaps a left edge to another shape\'s right edge', () => {
    const r = snapRect({ x: 103, y: 500, w: 40, h: 40 }, targets, 5);
    expect(r.dx).toBe(-3);
    expect(r.dy).toBe(0);
    expect(r.guides).toEqual([{ axis: 'x', at: 100, from: 0, to: 540 }]);
  });

  it('snaps centres to centres', () => {
    // moving centre x = 48 + 2 = 50 → target centre 50
    const r = snapRect({ x: 28, y: 1000, w: 40, h: 40 }, targets, 5);
    expect(r.dx).toBe(2);
  });

  it('does nothing beyond the threshold', () => {
    const r = snapRect({ x: 110, y: 500, w: 40, h: 40 }, targets, 5);
    expect(r).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('snaps both axes independently and picks the nearest candidate', () => {
    // right edge 298 → 300 (2 away); left edge 258 → no target nearby
    // bottom 252 → 250 (2 away), top 212 → 200 (12, too far)
    const r = snapRect({ x: 258, y: 212, w: 40, h: 40 }, targets, 5);
    expect(r.dx).toBe(2);
    expect(r.dy).toBe(-2);
    expect(r.guides.map((g) => [g.axis, g.at])).toEqual([['x', 300], ['y', 250]]);
  });

  it('shows a guide when already aligned exactly', () => {
    const r = snapRect({ x: 100, y: 500, w: 40, h: 40 }, targets, 5);
    expect(r.dx).toBe(0);
    expect(r.guides).toHaveLength(1);
  });

  it('copes with no targets', () => {
    expect(snapRect({ x: 1, y: 1, w: 1, h: 1 }, buildSnapTargets([]), 5)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('is fast enough to run every frame against 10k shapes', () => {
    const rects = Array.from({ length: 10000 }, (_, i) => ({ x: (i % 100) * 40, y: Math.floor(i / 100) * 40, w: 30, h: 30 }));
    const t = buildSnapTargets(rects);
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) snapRect({ x: i * 1.7, y: i * 2.3, w: 30, h: 30 }, t, 4);
    expect((performance.now() - t0) / 1000).toBeLessThan(0.5); // ms per snap
  });
});
