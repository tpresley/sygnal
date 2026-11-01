/**
 * window.__canvasBench: the React baseline's benchmark contract (react-konva/src/bench.ts on branch
 * claude/explore-canvas-react-baseline), so its perf/run.mjs measures this app unchanged. Its
 * stress grid is part of the contract: n top-level shapes on a ceil(sqrt(n)) grid of 40 px cells,
 * 30 × 30, rectangle (radius 4) / ellipse alternating, Mulberry32 (seed 1) fills as hex, no stroke,
 * zoomed to fit with 40 px padding.
 */
import {fit, union, toScreen} from '../lib/canvas'
import {make, byId, type Shape} from './doc'

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function hslToHex(h: number, s: number, l: number) {
  const a = s * Math.min(l, 1 - l)
  const f = (k: number) => { const n = (k + h / 30) % 12; return Math.round((l - a * Math.max(-1, Math.min(n - 3, 9 - n, 1))) * 255).toString(16).padStart(2, '0') }
  return `#${f(0)}${f(8)}${f(4)}`
}
export function contractStress(n: number): Shape[] {
  const rand = rng(1), cols = Math.ceil(Math.sqrt(n)), out: Shape[] = []
  for (let i = 0; i < n; i++) {
    const type = i % 2 == 0 ? 'rect' : 'ellipse'
    out.push(make(type, 's' + i, i + 1, {x: (i % cols) * 40, y: Math.floor(i / cols) * 40, width: 30, height: 30, radius: type == 'rect' ? 4 : 0, fill: hslToHex(Math.floor(rand() * 360), 0.7, 0.6), stroke: '#000000', strokeWidth: 0}))
  }
  return out
}

const frame = () => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))

export function installBench(app: any) {
  const rt = app.__runtime
  const board = () => (document.querySelector('.board') as HTMLElement).getBoundingClientRect()
  const set = async (f: (s: any) => any) => { rt.setState('root', f(rt.getState())); await rt.flushed(); await frame() }
  ;(window as any).__canvasBench = {
    version: 1,
    framework: 'sygnal-canvas',
    async generate(n: number) {
      const shapes = contractStress(n), r = board()
      await set(s => ({...s, shapes, past: [], future: [], selection: [], seq: n, gesture: null, hover: null, camera: fit(union(shapes), r.width, r.height, 40, 1)}))
    },
    async select(count: number | 'all') {
      await set(s => { const top = s.shapes.filter((x: Shape) => x.parent == null).map((x: Shape) => x.id); return {...s, selection: count == 'all' ? top : top.slice(0, count)} })
    },
    dragPoint() {
      const s = rt.getState(), sel = s.selection.map((id: string) => byId(s.shapes, id)).filter(Boolean)
      const all = union(sel)!, cx = (all.x0 + all.x1) / 2, cy = (all.y0 + all.y1) / 2
      let best = {x: cx, y: cy}, bd = Infinity
      for (const b of sel) { const c = {x: b.x + b.width / 2, y: b.y + b.height / 2}, d = (c.x - cx) ** 2 + (c.y - cy) ** 2; if (d < bd) bd = d, best = c }
      const p = toScreen(s.camera, best.x, best.y), r = board()
      return {x: r.left + p.x, y: r.top + p.y}
    },
    canvasCenter() { const r = board(); return {x: r.left + r.width / 2, y: r.top + r.height / 2} },
    count: () => rt.getState().shapes.length,
    frame,
  }
}
