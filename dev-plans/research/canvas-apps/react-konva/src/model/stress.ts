// Stress documents for the perf scripts. The layout is part of the benchmark
// contract (see README "Benchmark contract") so another implementation can match it.
import type { Doc, SceneNode } from './types';

export const STRESS_CELL = 40;
export const STRESS_SIZE = 30;

/** Mulberry32: deterministic so every run draws the same document. */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (k: number) => {
    const n = (k + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(n - 3, 9 - n, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * n top-level shapes on a ceil(sqrt(n)) column grid, 40 px cells, 30×30 shapes,
 * alternating rectangle / ellipse, seeded fills (hsl(h, 70%, 60%) as hex), no stroke.
 */
export function stressDoc(n: number, seed = 1): Doc {
  const rand = rng(seed);
  const cols = Math.ceil(Math.sqrt(n));
  const nodes: Record<string, SceneNode> = {};
  const root: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = `s${i}`;
    const type = i % 2 === 0 ? 'rect' : 'ellipse';
    nodes[id] = {
      id, type, name: `${type === 'rect' ? 'Rectangle' : 'Ellipse'} ${i + 1}`, parentId: null,
      x: (i % cols) * STRESS_CELL, y: Math.floor(i / cols) * STRESS_CELL, w: STRESS_SIZE, h: STRESS_SIZE,
      rotation: 0, fill: hslToHex(Math.floor(rand() * 360), 0.7, 0.6), stroke: '#000000', strokeWidth: 0,
      cornerRadius: type === 'rect' ? 4 : 0, opacity: 1, visible: true, locked: false,
    };
    root.push(id);
  }
  return { nodes, root };
}
