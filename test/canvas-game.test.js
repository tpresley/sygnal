// @vitest-environment jsdom
// canvas-game (dev-plans/research/canvas-game): what a real-time game needs from the frame timer,
// sygnal/canvas and sygnal/three.
// - B2: a widget invalidated by a frame timer's action paints in that frame, every frame (a
//   recording requestAnimationFrame runs the frames, with a microtask checkpoint after each
//   callback, as a browser does)
// - R2: input sampled with the frame (`keys`), a fixed step (`step`)
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { Canvas, canvasOf } from '../src/canvas.ts'
import { Scene, sceneOf } from '../src/three.ts'

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = '' })

/** requestAnimationFrame under the test's control: frame() runs one frame's callbacks */
function recordingRaf() {
  let q = [], id = 0, t = 1000
  const cancelled = new Set()
  const raf = (f) => { q.push({ id: ++id, f }); return id }
  const caf = (i) => { cancelled.add(i) }
  const saved = [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame, window.requestAnimationFrame, window.cancelAnimationFrame]
  globalThis.requestAnimationFrame = window.requestAnimationFrame = raf
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame = caf
  const drain = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
  return {
    async frame() {
      t += 16
      const run = q
      q = []
      for (const c of run) {
        if (cancelled.has(c.id)) continue
        c.f(t)
        await drain()
      }
    },
    restore() {
      ;[globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame, window.requestAnimationFrame, window.cancelAnimationFrame] = saved
    },
  }
}

// one rect that moves a pixel every frame: the world steps through a frame timer
function Mover({ state }) {
  return h('div', {},
    h(Canvas, { className: 'c', width: 200, height: 100, headless: false, backend: state.backend, a11y: 0 },
      h('shapes', { className: 'actors', items: [{ id: 'a', type: 'rect', x: state.x, y: 0, width: 10, height: 10 }], live: true })))
}
Mover.timers = () => ({ frame: { frame: 'FRAME' } })
Mover.model = { FRAME: (s) => ({ ...s, x: s.x + 1 }) }

describe('B2: a frame timer and the widgets paint in the same frame', () => {
  it('<Canvas> paints once per frame, the frame its state changed', async () => {
    const r = recordingRaf()
    try {
      const painted = []
      const backend = () => ({ paint(f) { painted.push(f.layers[0].items[0].x) } })
      const t = renderComponent(Mover, { dom: 'real', initialState: { x: 0, backend } })
      await t.ready()
      painted.length = 0
      for (let i = 0; i < 20; i++) await r.frame()
      // every frame painted (it was every other one), and what it painted is the state of that frame
      expect(painted.length).toBeGreaterThanOrEqual(19)
      expect(painted.at(-1)).toBe(t.state.x)
      t.dispose()
    } finally { r.restore() }
  })

  it('sygnal/three renders once per frame with a frame timer moving a mesh', async () => {
    const r = recordingRaf()
    try {
      function Spinner({ state }) {
        return h(Scene, { className: 'v', width: 200, height: 100 },
          h('mesh', { className: 'm', position: [state.x, 0, 0] }, h('boxGeometry', {}), h('meshBasicMaterial', {})))
      }
      Spinner.timers = () => ({ frame: { frame: 'FRAME' } })
      Spinner.model = { FRAME: (s) => ({ ...s, x: s.x + 0.1 }) }
      const t = renderComponent(Spinner, { dom: 'real', initialState: { x: 0 } })
      await t.ready()
      const scene = sceneOf(t.container.querySelector('.v'))
      for (let i = 0; i < 3; i++) await r.frame()
      const before = scene.stats.renders
      for (let i = 0; i < 20; i++) await r.frame()
      expect(scene.stats.renders - before).toBeGreaterThanOrEqual(19)
      t.dispose()
    } finally { r.restore() }
  })
})

// R2: the frame samples the keyboard
function Player({ state }) { return h('p', {}, `x ${state.x}`) }
Player.timers = (s) => ({ frame: s.on && { frame: 'FRAME', keys: { left: ['ArrowLeft', 'KeyA'], right: 'ArrowRight', jump: 'Space' } } })
Player.model = {
  FRAME: (s, { held, pressed, released }) => ({ ...s, x: s.x + (held.right ? 1 : 0) - (held.left ? 1 : 0), jumps: s.jumps + (pressed.includes('jump') ? 1 : 0), log: [...s.log, { held, pressed, released }] }),
}

const key = (type, code, init = {}) => {
  const e = new KeyboardEvent(type, { code, key: init.key ?? code, bubbles: true, cancelable: true, ...init })
  ;(init.target || document).dispatchEvent(e)
  return e
}

describe('R2: input sampled with the frame', () => {
  const start = async () => {
    vi.useFakeTimers()
    const t = renderComponent(Player, { initialState: { on: true, x: 0, jumps: 0, log: [] } })
    await t.ready()
    return t
  }

  it('held keys move every frame; a press shorter than a frame still counts once', async () => {
    const t = await start()
    key('keydown', 'ArrowRight')
    await t.frames(10)
    expect(t.state.x).toBe(10)
    key('keyup', 'ArrowRight')
    await t.frames(1)
    expect(t.state.log.at(-1).released).toEqual(['right'])
    // a tap between two frames
    key('keydown', 'Space'); key('keyup', 'Space')
    await t.frames(2)
    expect(t.state.x).toBe(10)
    expect(t.state.jumps).toBe(1)
    const tap = t.state.log.at(-2)
    expect(tap.pressed).toEqual(['jump'])
    expect(tap.released).toEqual(['jump'])
    expect(tap.held.jump).toBe(false)
    // nothing changed: the same held object, empty edges
    expect(t.state.log.at(-1).held).toBe(tap.held)
    expect(t.state.log.at(-1).pressed).toEqual([])
    t.dispose()
  })

  it('repeats are ignored, the game keys are default-prevented, two keys for one button', async () => {
    const t = await start()
    const d = key('keydown', 'KeyA')
    const other = key('keydown', 'KeyQ')
    expect(d.defaultPrevented).toBe(true)
    expect(other.defaultPrevented).toBe(false)
    key('keydown', 'ArrowLeft')
    key('keydown', 'KeyA', { repeat: true })
    await t.frames(1)
    key('keyup', 'KeyA')
    await t.frames(1)
    // ArrowLeft still holds `left`
    expect(t.state.log.at(-1).held.left).toBe(true)
    expect(t.state.log.at(-1).released).toEqual([])
    key('keyup', 'ArrowLeft')
    await t.frames(1)
    expect(t.state.log.at(-1).released).toEqual(['left'])
    t.dispose()
  })

  it('the window losing focus releases every key; typing in a field is not game input', async () => {
    const t = await start()
    key('keydown', 'ArrowRight')
    await t.frames(1)
    window.dispatchEvent(new Event('blur'))
    await t.frames(1)
    expect(t.state.log.at(-1).held.right).toBe(false)
    expect(t.state.log.at(-1).released).toEqual(['right'])
    const input = document.createElement('input')
    document.body.appendChild(input)
    const e = key('keydown', 'ArrowRight', { target: input })
    await t.frames(1)
    expect(e.defaultPrevented).toBe(false)
    expect(t.state.log.at(-1).held.right).toBe(false)
    t.dispose()
  })

  it('stops listening when the timer stops', async () => {
    const t = await start()
    t.dispose()
    const e = key('keydown', 'ArrowRight')
    expect(e.defaultPrevented).toBe(false)
  })
})

describe('R2: a fixed step', () => {
  it('one action per whole step the frame time owes, the remainder carried, at most `max`', async () => {
    function Sim({ state }) { return h('p', {}, String(state.n)) }
    Sim.timers = () => ({ step: { frame: 'STEP', step: 10, max: 3 } })
    Sim.model = { STEP: (s, d) => ({ ...s, n: s.n + 1, seen: [...s.seen, [d.dt, d.steps, d.i]] }) }
    vi.useFakeTimers()
    const t = renderComponent(Sim, { initialState: { n: 0, seen: [] } })
    await t.ready()
    // fake frames are 16 ms apart: 16 → 1 step (6 left), 22 → 2 steps (2 left), 18 → 1 (8 left) …
    await t.frames(4)
    expect(t.state.seen.every(([dt]) => dt === 10)).toBe(true)
    expect(t.state.n).toBe(Math.floor((3 * 16) / 10))
    t.dispose()
  })

  it('a frame within 5 % of the step is exactly one step (no 0-then-2 stutter from rAF jitter)', async () => {
    function Sim({ state }) { return h('p', {}, String(state.n)) }
    Sim.timers = () => ({ step: { frame: 'STEP', step: 1000 / 60 } })
    Sim.model = { STEP: (s, d) => ({ ...s, n: s.n + 1, per: [...s.per, d.steps] }) }
    vi.useFakeTimers()
    const t = renderComponent(Sim, { initialState: { n: 0, per: [] } })
    await t.ready()
    // fake frames are 16 ms apart, 4 % short of 16.67
    await t.frames(30)
    expect(t.state.n).toBe(29)
    expect(t.state.per.every((n) => n === 1)).toBe(true)
    t.dispose()
  })
})

// ---------------------------------------------------------------- the painter (R3, R4, B4)
import { canvas2d, CAMERA } from '../src/canvas.ts'

// a recording 2D context: the backend's calls, no pixels (as canvas.test.js)
function fakeCanvas(w = 800, h = 600) {
  const calls = []
  const ctx = new Proxy({}, {
    get: (o, k) => k in o ? o[k] : (k == 'calls' ? calls : (...a) => { calls.push([k, ...a]) }),
    set: (o, k, v) => { o[k] = v; return true },
  })
  const made = [], divs = []
  // (a div: the scroll canvases' container, a list of children in order)
  const div = () => {
    const d = { style: {}, children: [], parentNode: null, setAttribute() {}, remove() { d.parentNode = null },
      insertBefore(c, at) { const i = d.children.indexOf(c); if (i >= 0) d.children.splice(i, 1); const j = at ? d.children.indexOf(at) : -1; d.children.splice(j < 0 ? d.children.length : j, 0, c); c.parentNode = d; c.remove = () => { d.children.splice(d.children.indexOf(c), 1); c.parentNode = null } } }
    divs.push(d)
    return d
  }
  const doc = { createElement: (tag) => { if (tag == 'div') return div(); const c = fakeCanvas(1, 1).canvas; made.push(c); return c } }
  const canvas = { width: w, height: h, ownerDocument: doc, getContext: () => ctx, style: {}, setAttribute() {}, remove() {} }
  return { canvas, ctx, calls, made, divs }
}
// a canvas in a parent element: the live canvas and the scroll canvases go next to it
function withParent(f) {
  const kids = [f.canvas]
  f.canvas.parentNode = { insertBefore(c, at) { const i = kids.indexOf(c); if (i >= 0) kids.splice(i, 1); const j = at ? kids.indexOf(at) : -1; kids.splice(j < 0 ? kids.length : j, 0, c); c.parentNode = this; c.nextSibling = undefined; kids.forEach((k, n) => { k.nextSibling = kids[n + 1] || null }) } }
  f.kids = kids
  return f
}
const frame = (layers, camera = CAMERA, more = {}) => ({ camera, width: 800, height: 600, dpr: 1, background: '#fff', grid: false, repaint: 'layers', layers, overlay: [], follow: null, moving: false, ...more })
const stats = () => ({ nodes: 0, culled: 0, ms: 0, blits: 0, cached: 0, shifted: 0, scaled: 0, statics: 0 })
const box = (id, x, y, more = {}) => ({ id, type: 'rect', x, y, width: 10, height: 10, fill: '#000', ...more })

describe('canvas2d(): live layers, layer order, parallax, the blit for nodes that move on their own', () => {
  it('B4: 1,200 nodes each moving its own way are painted directly after the first frame, no bitmap per frame', () => {
    const { canvas, calls, made } = fakeCanvas(), b = canvas2d()(canvas)
    const actors = (f) => Array.from({ length: 1200 }, (_, i) => box('a' + i, (i % 40) * 20 + ((i * 7 + f * 3) % 5), Math.floor(i / 40) * 20 + ((i + f) % 3)))
    b.paint(frame([{ items: actors(0), live: true, active: null }]), stats())
    const bitmaps = made.length
    for (let f = 1; f < 5; f++) {
      calls.length = 0
      const s = stats(); b.paint(frame([{ items: actors(f), live: true, active: null }]), s)
      if (f == 1) continue
      expect(s).toMatchObject({ blits: 0, statics: 0 })
      expect(s.nodes).toBe(1200)
      expect(calls.filter((c) => c[0] == 'drawImage')).toHaveLength(0)
    }
    // the blit bitmap is made once, never per frame
    expect(made.length).toBe(bitmaps)
    // then a frame that translated all of them: one bitmap of them, and the next is a blit
    const base = actors(4), moved = (d) => base.map((n) => ({ ...n, x: n.x + d }))
    b.paint(frame([{ items: moved(1), live: true, active: null }]), stats())
    const s = stats(); b.paint(frame([{ items: moved(2), live: true, active: null }]), s)
    expect(s.blits).toBe(1)
  })

  it('a live layer: no ids, no static repaint while its items change every frame', () => {
    const { canvas } = fakeCanvas(), b = canvas2d()(canvas)
    const tiles = Array.from({ length: 50 }, (_, i) => box('t' + i, i * 12, 500))
    b.paint(frame([{ items: tiles, active: null }, { items: [box('p', 0, 0)], active: null, live: true }]), stats())
    for (let x = 1; x < 4; x++) {
      const s = stats(); b.paint(frame([{ items: tiles, active: null }, { items: [box('p', x, 0)], active: null, live: true }]), s)
      expect(s).toMatchObject({ statics: 0, nodes: 1 })
    }
  })

  it('layers paint in their order: a live background under static tiles under live actors; parallax scrolls slower', () => {
    const { canvas, calls } = fakeCanvas(), b = canvas2d()(canvas)
    const hills = [box('hill', 100, 300, { fill: 'green' })], tiles = Array.from({ length: 30 }, (_, i) => box('t' + i, i * 30, 550, { fill: 'brown' }))
    const layers = (x) => [
      { items: hills, active: null, parallax: [0.5, 1] },
      { items: tiles, active: null },
      { items: [box('player', 200 + x, 540, { fill: 'red' })], active: null, live: true },
    ]
    b.paint(frame(layers(0)), stats())
    calls.length = 0
    const cam = { x: 200, y: 0, zoom: 1 }
    const s = stats(); b.paint(frame(layers(5), cam), s)
    const images = calls.map((c, k) => c[0] == 'drawImage' ? k : -1).filter((k) => k >= 0)
    const player = calls.findIndex((c) => c[0] == 'rect' && c[1] == 205)
    // the hills (a static run of their own: a bitmap), then the tiles (another), then the player
    expect(images).toHaveLength(2)
    expect(player).toBeGreaterThan(images[1])
    // the player painted on the main canvas through the camera
    expect(calls.findLast((c, k) => c[0] == 'setTransform' && k < player)).toEqual(['setTransform', 1, 0, 0, 1, -200, -0])
    const srcX = () => calls.filter((c) => c[0] == 'drawImage').map((c) => c[2])
    const before = srcX()
    // a pan by 20: both bitmaps shifted, nothing repainted; the hills move by half of it
    calls.length = 0
    const s2 = stats(); b.paint(frame(layers(6), { x: 220, y: 0, zoom: 1 }), s2)
    expect(s2).toMatchObject({ statics: 0, shifted: 2 })
    const after = srcX()
    expect([after[0] - before[0], after[1] - before[1]]).toEqual([10, 20])
  })

  it('with parallax, the live layers on top go on the live canvas: a still camera leaves the main canvas as it is', () => {
    const { canvas, calls, made } = withParent(fakeCanvas())
    const b = canvas2d()(canvas)
    const liveCalls = made[0].getContext('2d').calls
    const hills = [box('hill', 100, 300)], tiles = Array.from({ length: 30 }, (_, i) => box('t' + i, i * 30, 550))
    const layers = (x) => [{ items: hills, active: null, parallax: [0.5, 1] }, { items: tiles, active: null }, { items: [box('p', x, 540)], active: null, live: true }]
    b.paint(frame(layers(0)), stats())
    calls.length = 0; liveCalls.length = 0
    const s = stats(); b.paint(frame(layers(1)), s)
    // the main canvas untouched; the player painted on the live canvas
    expect(s.cached).toBe(1)
    expect(calls.filter((c) => c[0] == 'drawImage' || c[0] == 'fillRect')).toHaveLength(0)
    expect(liveCalls.some((c) => c[0] == 'rect' && c[1] == 1)).toBe(true)
  })

  it('R14: a scrolling camera moves the run canvases (a CSS transform, no pixels); at the edge of what they have, only the new strip is painted', () => {
    const f = withParent(fakeCanvas()), b = canvas2d()(f.canvas)
    const tiles = Array.from({ length: 400 }, (_, i) => box('t' + i, i * 40, 500, { width: 40 }))
    const layers = (x) => [{ items: tiles, active: null }, { items: [box('p', x + 100, 480)], active: null, live: true }]
    // a still camera: the main canvas (no scroll canvases for a scene that doesn't scroll)
    b.paint(frame(layers(0)), stats())
    expect(f.divs).toHaveLength(0)
    // the camera moves: the static layer goes on a scroll canvas (painted once)
    const s0 = stats(); b.paint(frame(layers(0), { x: 0.5, y: 0, zoom: 1 }), s0)
    expect(s0.statics).toBe(1)
    b.paint(frame(layers(0)), stats())
    const [box_] = f.divs, run = box_.children[0], rc = run.getContext('2d').calls
    // the order: main canvas, the scroll canvases' container, the live canvas
    expect(f.kids.map((k) => k.className ?? 'main')).toEqual(['main', 'sygnal-canvas-scroll', 'sygnal-canvas-live'])
    // the region: the view and half a view each way, clipped to the content (and its 20 px pad)
    expect([run.width, run.height]).toEqual([1221, 50])
    for (let x = 10; x <= 300; x += 10) {
      f.calls.length = 0; rc.length = 0
      const s = stats(); b.paint(frame(layers(x), { x, y: 0, zoom: 1 }), s)
      expect(s).toMatchObject({ statics: 0, scrolled: 1 })
      expect(f.calls).toHaveLength(0)
      expect(rc).toHaveLength(0)
      expect(run.style.transform).toBe(`translate(${-20 - x}px, 480px)`)
    }
    // past the region: a new one around the view (a size change: painted whole), then one the same size: the overlap shifted, one strip painted
    const s1 = stats(); b.paint(frame(layers(500), { x: 500, y: 0, zoom: 1 }), s1)
    expect(s1.statics).toBe(1)
    rc.length = 0
    const s2 = stats(); b.paint(frame(layers(1000), { x: 1000, y: 0, zoom: 1 }), s2)
    expect(s2).toMatchObject({ statics: 0, strips: 1 })
    const copy = rc.findIndex((c) => c[0] == 'drawImage')
    expect(rc[copy]).toEqual(['drawImage', run, -500, 0])
    const painted = rc.filter((c) => c[0] == 'rect' && c[4] == 10).map((c) => c[1])
    // only the tiles in the strip x 1700 … 2200 (clipped to it: one overlaps its left edge, one touches its right)
    expect(Math.min(...painted)).toBe(1680)
    expect(Math.max(...painted)).toBe(2200)
    expect(painted).toHaveLength(14)
    expect(run.style.transform).toBe('translate(-400px, 480px)')
  })

  it('R14: a static run that changes is repainted; a zoom repaints; a live layer under a static one goes back to the main canvas', () => {
    const f = withParent(fakeCanvas()), b = canvas2d()(f.canvas)
    const tiles = Array.from({ length: 50 }, (_, i) => box('t' + i, i * 40, 500))
    const actor = [box('p', 0, 0)], at = (x) => ({ x, y: 0, zoom: 1 })
    b.paint(frame([{ items: tiles, active: null }, { items: actor, active: null, live: true }]), stats())
    b.paint(frame([{ items: tiles, active: null }, { items: actor, active: null, live: true }], at(1)), stats())
    const s = stats(); b.paint(frame([{ items: tiles.slice(1), active: null }, { items: actor, active: null, live: true }], at(2)), s)
    expect(s).toMatchObject({ statics: 1 })
    const s2 = stats(); b.paint(frame([{ items: tiles.slice(1), active: null }, { items: actor, active: null, live: true }], { x: 0, y: 300, zoom: 2 }), s2)
    expect(s2.statics).toBe(1)
    // a live background under the tiles: everything on the main canvas again, the scroll canvases hidden
    f.calls.length = 0
    b.paint(frame([{ items: [box('sky', 0, 0)], active: null, live: true }, { items: tiles, active: null }, { items: actor, active: null, live: true }]), stats())
    expect(f.divs[0].style.display).toBe('none')
    expect(f.calls.some((c) => c[0] == 'drawImage')).toBe(true)    // refresh() (an image arrived): the next frame repaints what was cached
    const layers = [{ items: tiles, active: null }, { items: actor, active: null, live: true }]
    b.paint(frame(layers, at(5)), stats())
    const same = stats(); b.paint(frame(layers, at(6)), same)
    expect(same).toMatchObject({ statics: 0, scrolled: 1 })
    b.refresh()
    const after = stats(); b.paint(frame(layers, at(7)), after)
    expect(after.statics).toBe(1)
  })

  it('R14: a camera still for 30 frames folds the scroll canvases back onto the main canvas: a copy of their pixels, no repaint', () => {
    const f = withParent(fakeCanvas()), b = canvas2d()(f.canvas)
    const tiles = Array.from({ length: 50 }, (_, i) => box('t' + i, i * 40, 500)), cam = { x: 10, y: 0, zoom: 1 }
    const layers = [{ items: tiles, active: null }, { items: [box('p', 0, 0)], active: null, live: true }]
    b.paint(frame(layers), stats())
    b.paint(frame(layers, cam), stats())
    const run = f.divs[0].children[0]
    for (let i = 0; i < 29; i++) { const s = stats(); b.paint(frame(layers, cam), s); expect(s.scrolled).toBe(1) }
    f.calls.length = 0
    const s = stats(); b.paint(frame(layers, cam), s)
    expect(f.divs[0].style.display).toBe('none')
    expect(s).toMatchObject({ statics: 0, shifted: 1 })
    expect(f.calls.find((c) => c[0] == 'drawImage')[1]).toBe(run)
    // still: cached; the camera moves again: back on the scroll canvas, as it was (no repaint)
    const s2 = stats(); b.paint(frame(layers, cam), s2)
    expect(s2.cached).toBe(1)
    const s3 = stats(); b.paint(frame(layers, { x: 20, y: 0, zoom: 1 }), s3)
    expect(s3).toMatchObject({ statics: 0, scrolled: 1 })
    expect(f.divs[0].style.display).toBe('')
  })

  it('an editor (one document layer, a dragged node in it, outline layers above) keeps the two-canvas strategy', () => {
    const { canvas } = fakeCanvas(), b = canvas2d()(canvas)
    const doc = Array.from({ length: 100 }, (_, i) => box('d' + i, i * 8, 0))
    b.paint(frame([{ items: doc, active: null }, { items: [doc[0]], active: null, outline: '#09f' }]), stats())
    const s = stats(); b.paint(frame([{ items: doc, active: new Set(['d1']) }, { items: [doc[0]], active: null, outline: '#09f' }]), s)
    // the static layer was repainted without d1 (the two-canvas path), then cached
    expect(s.statics).toBe(1)
    const s2 = stats(); b.paint(frame([{ items: doc, active: new Set(['d1']) }, { items: [doc[0]], active: null, outline: '#09f' }]), s2)
    expect(s2).toMatchObject({ statics: 0, cached: 1 })
  })
})

// ---------------------------------------------------------------- the island: a11y, parallax hits, SYG262 (B3)
describe('<Canvas>: a11y, picking through parallax, SYG262', () => {
  function Board({ state }) {
    return h(Canvas, { className: 'b', width: 400, height: 300, a11y: state.a11y, camera: state.camera },
      h('shapes', { className: 'far', items: [box('cloud', 100, 50, { width: 40, height: 40, name: 'Cloud' })], parallax: 0.5 }),
      h('shapes', { className: 'near', items: state.near }),
      h('shapes', { className: 'actors', items: state.actors, live: true }))
  }
  Board.intent = ({ DOM }) => ({ HIT: DOM.select('.b').events('pointerdown').map((e) => e.hit) })
  Board.model = { HIT: (s, hit) => ({ ...s, hit }), TICK: (s) => ({ ...s, actors: s.actors.map((a) => ({ ...a })) }) }
  const near = Array.from({ length: 3 }, (_, i) => box('n' + i, 300 + i * 20, 200, { name: 'N' + i }))
  const actors = Array.from({ length: 100 }, (_, i) => box('a' + i, (i % 10) * 12, 260 + Math.floor(i / 10)))

  it('a11y={0} on the canvas: no projection; a live layer has none by default', async () => {
    const t = renderComponent(Board, { dom: 'real', initialState: { a11y: undefined, near, actors, camera: CAMERA } })
    await t.ready(); await t.settle()
    const labels = [...t.container.querySelectorAll('[data-node]')].map((e) => e.getAttribute('aria-label'))
    expect(labels).toContain('N0')
    expect(labels.some((l) => /^a\d/.test(l))).toBe(false)
    t.dispose()
    const t2 = renderComponent(Board, { dom: 'real', initialState: { a11y: 0, near, actors, camera: CAMERA } })
    await t2.ready(); await t2.settle()
    expect(t2.container.querySelectorAll('[data-node]')).toHaveLength(0)
    t2.dispose()
  })

  it('a press hits a parallax layer\'s node where it is drawn', async () => {
    const t = renderComponent(Board, { dom: 'real', initialState: { a11y: 0, near, actors: [], camera: { x: 100, y: 0, zoom: 1 } } })
    await t.ready()
    const c = canvasOf(t.container.querySelector('.b'))
    // the cloud at x 100 seen through camera x 50 (half of 100): canvas x 50..90
    c.pointer('down', 60, 60, { pointerId: 1 }); c.pointer('up', 60, 60, { pointerId: 1 })
    await t.settle()
    expect(t.state.hit).toBe('cloud')
    t.dispose()
  })

  it('B3: no SYG262 for a live layer, or for active nodes that keep their fields', async () => {
    function Frozen({ state }) {
      const a = Array.from({ length: 100 }, (_, i) => box('f' + i, i * 3, 0))
      return h(Canvas, { className: 'c', width: 400, height: 300, a11y: 0 },
        h('shapes', { className: 'one', items: a, active: a.map((n) => n.id) }),
        h('shapes', { className: 'two', items: a.map((n) => ({ ...n, id: 'g' + n.id })), live: true }))
    }
    Frozen.model = { TICK: (s) => ({ ...s, n: s.n + 1 }) }
    const t = renderComponent(Frozen, { dom: 'real', initialState: { n: 0 } })
    await t.ready()
    for (let i = 0; i < 3; i++) await t.simulateAction('TICK')
    t.expectNoDiagnostics()
    t.dispose()
  })
})

// ---------------------------------------------------------------- testing a frame loop (R5), replay (B1)
import { startRecording, replay } from '../src/extra/replay/index.ts'

describe('renderComponent with a frame loop', () => {
  function Loop({ state }) { return h('div', {}, h('p', { className: 'n' }, 'frames = ', state.n), h('button', { className: 'b' }, 'b')) }
  Loop.timers = (s) => ({ loop: s.on && { frame: 'FRAME', keys: { go: 'ArrowRight' } } })
  Loop.intent = ({ DOM }) => ({ CLICK: DOM.click('.b') })
  Loop.model = {
    FRAME: (s, { held, pressed }) => ({ ...s, n: s.n + 1, x: s.x + (held.go ? 2 : 0), presses: s.presses + (pressed.includes('go') ? 1 : 0) }),
    CLICK: (s) => ({ ...s, clicks: s.clicks + 1 }),
    STOP: (s) => ({ ...s, on: false }),
  }
  const init = { on: true, n: 0, x: 0, clicks: 0, presses: 0 }

  it('settle() resolves while the frame loop runs; frames(n) steps it', async () => {
    vi.useFakeTimers()
    const t = renderComponent(Loop, { dom: 'real', initialState: init })
    await t.ready()
    await t.settle()
    const n = t.state.n
    await t.frames(5)
    expect(t.state.n).toBe(n + 5)
    t.dispose()
  })

  it('simulateAction and simulateEvent are awaitable between frames', async () => {
    vi.useFakeTimers()
    const t = renderComponent(Loop, { dom: 'real', initialState: init })
    await t.ready()
    await t.simulateEvent('.b', 'click')
    expect(t.state.clicks).toBe(1)
    await t.simulateAction('STOP')
    expect(t.state.on).toBe(false)
    await expect(t.frames(1)).rejects.toThrow(/no frame timer is running/)
    t.dispose()
  })

  // (the recorder redacts by default: a timer's reply, the frame's sampled button names, is the app's own data, not redacted)
  it('a recorded run (frames with sampled keys, a number next to text in the view) replays under fake timers', async () => {
    vi.useFakeTimers()
    const errors = []
    const onErr = (e) => errors.push(e)
    process.on('uncaughtException', onErr)
    const rec = startRecording()
    const t = renderComponent(Loop, { dom: 'real', initialState: init })
    await t.ready()
    await t.frames(3)
    key('keydown', 'ArrowRight')
    await t.frames(10)
    key('keyup', 'ArrowRight')
    await t.frames(3)
    const log = rec.stop(), final = t.state
    t.dispose()
    const r = await replay(Loop, log, { warn: false })
    try {
      expect(r.divergence).toBeNull()
      expect(r.view).toBeNull()
      expect(r.final.x).toBe(final.x)
      expect(final.x).toBe(20)
      expect(r.final.presses).toBe(1)
    } finally { r.t.dispose(); process.off('uncaughtException', onErr) }
    expect(errors).toEqual([])
  }, 20000)
})
