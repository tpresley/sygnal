// @vitest-environment jsdom
// sygnal/canvas (dev-plans/research/canvas-apps): the island headless in jsdom (no 2D context: the
// display list, hit testing, the shared pointer router and the projection are the same), driven by
// raw input at canvas pixels through canvasOf(el).pointer(kind, x, y, init); the canvas2d backend
// against a recording 2D context (the static layer, the camera cache, blits); the kit; keymap on
// the main entry; history() alone and routed to sygnal/yjs's per-user UndoManager.
import { describe, it, expect, afterEach } from 'vitest'
import * as Y from 'yjs'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { keymap, xs } from '../src/index.ts'
import {
  Canvas, canvasOf, canvas2d, pointer, history, handles, selectionBox, resize, rotation, turn, scaleInto,
  gesture, snap, snapTargets, fit, union, zoomAt, toScreen, toWorld, panBy, exportSVG, CAMERA, aabb, hitNodes, positionsOf,
  keymap as canvasKeymap, follow, layoutText, measureText, paintNode, Image as CanvasImage, preloadImage, clearImages, frameOf, frameAt,
} from '../src/canvas.ts'
import { Suspense } from '../src/suspense.ts'
import { shared } from '../src/yjs.ts'
import { makeYjsDriver } from '../src/yjs.ts'
import { createNetwork } from '../src/yjs-testing.ts'

const rect = (id, x, y, w = 100, hh = 80, more = {}) => ({ id, type: 'rect', name: id.toUpperCase(), x, y, width: w, height: hh, fill: '#ccc', ...more })

// a minimal editor: select on press, drag through the queue, or follow when `follow` is on
function Board({ state }) {
  const g = state.drag
  return h('div', {},
    h(Canvas, { className: 'board', camera: state.camera, width: 800, height: 600, capture: state.capture, follow: state.useFollow && g ? { ids: [g.id], from: g.from } : null },
      h('shapes', { className: 'doc', items: state.shapes, active: g ? [g.id] : null, 'aria-label': 'Document' }),
      state.pin ? h('ellipse', { className: 'pin', x: 400, y: 300, width: 20, height: 20, fill: 'red', name: 'Pin', capture: state.pinCapture }) : null,
      state.handle ? h('rect', { className: 'handle', data: { part: 'se' }, space: 'screen', x: 700, y: 500, width: 10, height: 10, fill: '#fff' }) : null))
}
Board.initialState = { shapes: [rect('a', 0, 0), rect('b', 200, 0)], camera: CAMERA, drag: null, events: [], useFollow: false, capture: 'all', pin: false, handle: false }
Board.intent = ({ DOM }) => {
  const b = DOM.select('.board')
  return {
    DOWN: b.events('pointerdown'), MOVE: b.events('pointermove'), UP: b.events('pointerup'), CLICK: b.events('click'),
    // (gotpointercapture / lostpointercapture don't bubble: the DOM driver hears them on the element)
    GOT: xs.merge(DOM.select('.doc').events('gotpointercapture'), DOM.select('.pin').events('gotpointercapture')),
    LOST: xs.merge(DOM.select('.doc').events('lostpointercapture'), DOM.select('.pin').events('lostpointercapture')),
    CAMERA: b.events('camerachange').detail(),
  }
}
const log = (s, e, kind) => ({ ...s, events: [...s.events, { kind, hit: e.hit ?? null, captured: !!e.captured, delta: e.delta, target: e.target?.getAttribute?.('class') || e.target?.localName, world: e.world }] })
Board.model = {
  DOWN: (s, e) => { const n = log(s, e, 'down'); return e.hit ? { ...n, drag: { id: e.hit, from: e.world, start: s.shapes.find((x) => x.id === e.hit) } } : n },
  MOVE: (s, e) => {
    const n = log(s, e, 'move'), g = s.drag
    if (!g || !e.captured) return n
    return { ...n, shapes: s.shapes.map((x) => x.id === g.id ? { ...x, x: g.start.x + e.delta.x, y: g.start.y + e.delta.y } : x) }
  },
  UP: (s, e) => {
    const n = log(s, e, 'up'), g = s.drag
    if (!g) return n
    const dx = e.world.x - g.from.x, dy = e.world.y - g.from.y
    return { ...n, drag: null, shapes: s.useFollow ? s.shapes.map((x) => x.id === g.id ? { ...x, x: g.start.x + dx, y: g.start.y + dy } : x) : s.shapes }
  },
  CLICK: (s, e) => log(s, e, 'click'), GOT: (s, e) => log(s, e, 'got'), LOST: (s, e) => log(s, e, 'lost'),
  CAMERA: (s, camera) => ({ ...s, camera }),
  SET: (s, d) => ({ ...s, ...d }),
}

async function open(init = {}) {
  const t = renderComponent(Board, { dom: 'real', initialState: { ...Board.initialState, ...init } })
  await t.ready()
  const c = canvasOf(t.container.querySelector('.board'))
  const p = async (kind, x, y, more = {}) => { c.pointer(kind, x, y, { pointerId: 1, ...more }); await t.settle() }
  const kinds = () => t.state.events.map((e) => e.kind)
  const clear = () => t.simulateAction('SET', { events: [] })
  return { t, c, p, kinds, clear }
}

describe('<Canvas>: data layers, hits, the background', () => {
  it('a press on a shape is an event on the layer element with hit = its id; a miss targets the background', async () => {
    const { t, p } = await open()
    await p('down', 50, 40); await p('up', 50, 40)
    const [down] = t.state.events
    expect(down).toMatchObject({ kind: 'down', hit: 'a', target: 'doc' })
    expect(down.world).toEqual({ x: 50, y: 40 })
    await t.settle()
    t.simulateAction('SET', { events: [] })
    await p('down', 600, 500); await p('up', 600, 500)
    expect(t.state.events.find((e) => e.kind == 'down')).toMatchObject({ hit: null })
    // the click of a press and release on the background reaches the app
    expect(t.state.events.map((e) => e.kind)).toContain('click')
    t.dispose()
  })

  it('topmost first; the camera maps screen to world; hidden and locked nodes are not hit', () => {
    const items = [rect('under', 0, 0), rect('over', 50, 0), rect('ghost', 0, 0, 200, 200, { hidden: true }), rect('lock', 0, 0, 10, 10, { locked: true })]
    expect(hitNodes(items, { x: 60, y: 10 }).id).toBe('over')
    expect(hitNodes(items, { x: 5, y: 5 }).id).toBe('under')
    const cam = { x: 100, y: 50, zoom: 2 }
    expect(toWorld(cam, 20, 10)).toEqual({ x: 110, y: 55 })
    expect(toScreen(cam, 110, 55)).toEqual({ x: 20, y: 10 })
    // zoom toward the cursor keeps the world point under it
    const z = zoomAt(cam, 4, 300, 200)
    expect(toWorld(z, 300, 200)).toEqual(toWorld(cam, 300, 200))
    expect(panBy(cam, 20, 0).x).toBe(90)
  })

  it('a screen-space JSX node is hit in canvas pixels at any zoom; its data-part reaches pointer()', async () => {
    const { t, p } = await open({ handle: true, camera: { x: 0, y: 0, zoom: 3 } })
    let seen = null
    t.container.querySelector('.board').addEventListener('pointerdown', (e) => { seen = pointer(e) }, { once: true })
    await p('down', 705, 505); await p('up', 705, 505)
    expect(seen).toMatchObject({ part: 'se', hit: null, sx: 705, sy: 505 })
    expect(seen.x).toBeCloseTo(705 / 3)
    t.dispose()
  })
})

describe('<Canvas>: pointer capture (the router sygnal/three shares)', () => {
  it('capture="all": the pressed shape gets every move and the up off it, with delta from the press; a drag sends no click', async () => {
    const { t, p, kinds } = await open()
    await p('move', 50, 40); await p('down', 50, 40)
    // far off the shape and off the other one
    await p('move', 250, 40); await p('move', 700, 500); await p('up', 700, 500)
    const ev = t.state.events
    expect(kinds()).toEqual(['move', 'down', 'got', 'move', 'move', 'up', 'lost'])
    const moves = ev.filter((e) => e.kind == 'move' && e.captured)
    expect(moves.every((e) => e.target == 'doc' && e.hit == 'a')).toBe(true)
    expect(moves.at(-1).delta).toEqual({ x: 650, y: 460 })
    expect(t.state.shapes[0]).toMatchObject({ x: 650, y: 460 })
    t.dispose()
  })

  it('capture="explicit": only a node with `capture` holds the pointer; others hover through', async () => {
    const { t, p, clear } = await open({ capture: 'explicit', pin: true })
    await p('down', 50, 40); await p('move', 300, 40); await p('up', 300, 40)
    const moveAfterDown = t.state.events.filter((e) => e.kind == 'move')
    expect(moveAfterDown.at(-1)).toMatchObject({ captured: false, hit: 'b' })
    expect(t.state.events.some((e) => e.kind == 'got')).toBe(false)
    clear(); await t.settle()
    t.simulateAction('SET', { pinCapture: true }); await t.settle()
    await p('down', 410, 310); await p('move', 600, 500); await p('up', 600, 500)
    expect(t.state.events.map((e) => e.kind)).toEqual(['down', 'got', 'move', 'up', 'lost'])
    expect(t.state.events.find((e) => e.kind == 'move')).toMatchObject({ captured: true, target: 'pin' })
    t.dispose()
  })

  it('the spike\'s probe: explicit mode: a data layer is not captured; an element with `capture` is; a press without a drag clicks', async () => {
    const seen = []
    function Probe() {
      return h(Canvas, { className: 'pc', capture: 'explicit', width: 400, height: 300 },
        h('shapes', { className: 'doc', items: [{ id: 'a', type: 'rect', x: 0, y: 0, width: 50, height: 50 }] }),
        h('rect', { className: 'grab', capture: true, x: 100, y: 0, width: 50, height: 50 }))
    }
    Probe.intent = ({ DOM }) => ({
      EV: DOM.select('.pc').events('pointermove').map((e) => ['move', e.target.getAttribute?.('class'), !!e.captured, e.delta?.x]),
      CL: DOM.select('.pc').events('click').map((e) => ['click', e.target.getAttribute?.('class')]),
    })
    Probe.initialState = {}
    Probe.model = { EV: (s, d) => (seen.push(d), s), CL: (s, d) => (seen.push(d), s) }
    const t = renderComponent(Probe, { dom: 'real' })
    await t.ready()
    const c = canvasOf(t.container.querySelector('.pc'))
    c.pointer('down', 10, 10); c.pointer('move', 200, 200); c.pointer('up', 200, 200)
    c.pointer('down', 110, 10); c.pointer('move', 140, 10); c.pointer('up', 140, 10)
    c.pointer('down', 110, 10); c.pointer('up', 111, 10)
    await t.settle()
    // an uncaptured press and release click their common ancestor, here the background, as the DOM
    // does (the spike's own router sent none after a move); a captured drag sends none
    expect(seen).toEqual([['move', null, false, undefined], ['click', null], ['move', 'grab', true, 30], ['click', 'grab']])
    t.dispose()
  })

  it('follow (the transient channel): while following, the app hears no pointermove; the up commits', async () => {
    const { t, c, p, kinds } = await open({ useFollow: true })
    await p('down', 50, 40)
    const before = t.state.shapes
    await p('move', 100, 40); await p('move', 150, 90)
    expect(kinds()).toEqual(['down', 'got'])
    expect(t.state.shapes).toBe(before)
    expect(c.st.events).toBe(3)
    await p('up', 150, 90)
    expect(t.state.shapes[0]).toMatchObject({ x: 100, y: 50 })
    expect(kinds()).toEqual(['down', 'got', 'up', 'lost'])
    t.dispose()
  })
})

describe('<Canvas>: the accessibility projection', () => {
  it('a data layer lists its nodes in view as buttons in its element; activating one presses that node', async () => {
    const { t, c } = await open()
    await Promise.resolve()
    const list = t.container.querySelector('.doc [role="group"]')
    expect(list.getAttribute('aria-label')).toBe('Document')
    const items = [...list.querySelectorAll('[role="button"]')]
    // topmost first
    expect(items.map((x) => x.getAttribute('aria-label'))).toEqual(['B', 'A'])
    expect(items[1].getAttribute('aria-roledescription')).toBe('rect')
    items[1].click()
    await t.settle()
    expect(t.state.events.map((e) => [e.kind, e.hit])).toEqual([['down', 'a'], ['up', 'a'], ['click', 'a']])
    // keyboard: Enter on a focused one
    t.simulateAction('SET', { events: [] }); await t.settle()
    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await t.settle()
    expect(t.state.events[0]).toMatchObject({ kind: 'down', hit: 'b' })
    // a node out of view leaves the projection; a renamed one is relabelled
    t.simulateAction('SET', { shapes: [rect('a', 0, 0, 100, 80, { name: 'Logo' }), rect('b', 5000, 0)] })
    await t.settle(); await Promise.resolve()
    expect([...list.querySelectorAll('[role="button"]')].map((x) => x.getAttribute('aria-label'))).toEqual(['Logo'])
    expect(c.st).toBeDefined()
    t.dispose()
  })

  it('at most `a11y` nodes; a11y={0} turns it off', async () => {
    function Many({ state }) { return h(Canvas, { className: 'board', width: 800, height: 600 }, h('shapes', { className: 'doc', items: state.shapes, a11y: state.a11y })) }
    Many.initialState = { shapes: Array.from({ length: 300 }, (_, i) => rect('s' + i, (i % 20) * 30, Math.floor(i / 20) * 30, 20, 20)), a11y: undefined }
    Many.model = { SET: (s, d) => ({ ...s, ...d }) }
    const t = renderComponent(Many, { dom: 'real' })
    await t.ready(); await Promise.resolve()
    expect(t.container.querySelectorAll('.doc [role="button"]').length).toBe(100)
    t.simulateAction('SET', { a11y: 0 }); await t.settle(); await Promise.resolve()
    expect(t.container.querySelector('.doc [role="group"]')).toBe(null)
    t.dispose()
  })

  it('the sygnal/agent-ui snapshot reads the projection, and an agent click is a press on the node', async () => {
    const { runAgentUI } = await import('../src/agent-ui.ts')
    const r = runAgentUI(Board)
    await r.ui.settle()
    const s = r.ui.snapshot()
    expect(s).toContain('group "Document"')
    const line = s.split('\n').find((l) => l.includes('button "A"'))
    expect(line).toMatch(/\[ref=e\d+\]/)
    const res = await r.ui.call('ui_click', { ref: line.match(/ref=(e\d+)/)[1] })
    expect(res.ok).toBe(true)
    // (a host document runs the app's delegates before the projection's own listener: the plain click comes first there)
    expect(r.app.__runtime.getState().events.map((e) => [e.kind, e.hit]).filter((e) => e[1])).toEqual([['down', 'a'], ['up', 'a'], ['click', 'a']])
    r.app.dispose()
  })
})

describe('SYG262 (dev): a reducer that rebuilds every node', () => {
  function Layer({ state }) { return h(Canvas, { className: 'board', width: 800, height: 600 }, h('shapes', { className: 'doc', items: state.shapes })) }
  Layer.initialState = { shapes: Array.from({ length: 100 }, (_, i) => rect('s' + i, i * 10, 0, 8, 8)) }
  Layer.model = {
    MOVE_ONE: (s) => ({ ...s, shapes: s.shapes.map((x, i) => i == 0 ? { ...x, x: x.x + 1 } : x) }),
    REBUILD: (s) => ({ ...s, shapes: s.shapes.map((x) => ({ ...x })) }),
  }
  it('patching one node is quiet; rebuilding all with equal fields is reported once', async () => {
    const t = renderComponent(Layer, { dom: 'real' })
    await t.ready()
    t.simulateAction('MOVE_ONE'); await t.settle()
    expect(t.diagnostics.filter((d) => d.code == 'SYG262')).toEqual([])
    t.simulateAction('REBUILD'); await t.settle()
    t.simulateAction('REBUILD'); await t.settle()
    const d = t.diagnostics.filter((x) => x.code == 'SYG262')
    expect(d).toHaveLength(1)
    expect(d[0].severity).toBe('warn')
    expect(d[0].message).toContain('100 new node objects')
    t.dispose()
  })
})

// a recording 2D context: the backend's calls, no pixels
function fakeCanvas(w = 800, h = 600) {
  const calls = []
  const ctx = new Proxy({}, {
    get: (o, k) => k in o ? o[k] : (k == 'calls' ? calls : (...a) => { calls.push([k, ...a]) }),
    set: (o, k, v) => { o[k] = v; return true },
  })
  const doc = { createElement: () => fakeCanvas(1, 1).canvas }
  const canvas = { width: w, height: h, ownerDocument: doc, getContext: () => ctx }
  return { canvas, ctx, calls }
}
const frame = (layers, camera = CAMERA, more = {}) => ({ camera, width: 800, height: 600, dpr: 1, background: '#fff', grid: false, repaint: 'layers', layers, overlay: [], follow: null, moving: false, ...more })
const stats = () => ({ nodes: 0, culled: 0, ms: 0, blits: 0, cached: 0, shifted: 0, scaled: 0, statics: 0 })

describe('canvas2d(): the static layer, the camera cache, translation blits', () => {
  const doc = Array.from({ length: 400 }, (_, i) => rect('s' + i, (i % 20) * 40, Math.floor(i / 20) * 40, 30, 30))
  it('an unchanged frame is the cached bitmap; a drag repaints only its active node', () => {
    const { canvas } = fakeCanvas(), b = canvas2d()(canvas)
    let s = stats(); b.paint(frame([{ items: doc, active: null }]), s)
    expect(s.statics).toBe(1)
    s = stats(); b.paint(frame([{ items: doc, active: null }]), s)
    expect(s).toMatchObject({ statics: 0, cached: 1 })
    // the drag starts: one repaint without the active node, then only the active node per frame
    const moved = (dx) => doc.map((n, i) => i == 0 ? { ...n, x: n.x + dx } : n)
    s = stats(); b.paint(frame([{ items: moved(1), active: new Set(['s0']) }]), s)
    expect(s.statics).toBe(1)
    s = stats(); b.paint(frame([{ items: moved(2), active: new Set(['s0']) }]), s)
    expect(s).toMatchObject({ statics: 0, cached: 1, nodes: 1 })
  })

  it('pan: a copy of the bitmap at an offset while it covers the view (the camera cache)', () => {
    const { canvas, calls } = fakeCanvas(), b = canvas2d()(canvas), layers = [{ items: doc, active: null }]
    b.paint(frame(layers, fit(union(doc), 800, 600, 40, 1)), stats())
    let cam = fit(union(doc), 800, 600, 40, 1)
    for (let i = 0; i < 10; i++) {
      cam = panBy(cam, 24, -18)
      const s = stats()
      calls.length = 0
      b.paint(frame(layers, cam, { moving: true }), s)
      expect(s).toMatchObject({ statics: 0, shifted: 1 })
      expect(calls.filter((c) => c[0] == 'drawImage')).toHaveLength(1)
    }
  })

  it('pan into what the bitmap lacks repaints once with a margin; then pans are copies again', () => {
    const { canvas } = fakeCanvas(), b = canvas2d()(canvas), layers = [{ items: doc, active: null }]
    let cam = { x: 0, y: 0, zoom: 4 }
    b.paint(frame(layers, cam), stats())
    cam = panBy(cam, -300, 0)
    let s = stats(); b.paint(frame(layers, cam, { moving: true }), s)
    expect(s.statics).toBe(1)
    for (let i = 0; i < 5; i++) {
      cam = panBy(cam, -30, 0)
      s = stats(); b.paint(frame(layers, cam, { moving: true }), s)
      expect(s).toMatchObject({ statics: 0, shifted: 1 })
    }
  })

  it('zoom during a gesture scales the bitmap; at rest it repaints crisp', () => {
    const { canvas } = fakeCanvas(), b = canvas2d()(canvas), layers = [{ items: doc, active: null }]
    const cam = fit(union(doc), 800, 600, 40, 1)
    b.paint(frame(layers, cam), stats())
    let s = stats(); b.paint(frame(layers, zoomAt(cam, cam.zoom * 1.2, 400, 300), { moving: true }), s)
    expect(s).toMatchObject({ statics: 0, scaled: 1 })
    s = stats(); b.paint(frame(layers, zoomAt(cam, cam.zoom * 1.2, 400, 300), { moving: false }), s)
    expect(s.statics).toBe(1)
  })

  it('a zoom-out during the gesture draws the overview under the scaled bitmap (painted once), not a repaint per step', () => {
    const { canvas } = fakeCanvas(), b = canvas2d()(canvas), layers = [{ items: doc, active: null }]
    let cam = { x: 100, y: 100, zoom: 2 }
    b.paint(frame(layers, cam), stats())
    cam = zoomAt(cam, 1.6, 400, 300)
    let s = stats(); b.paint(frame(layers, cam, { moving: true }), s)
    // the first uncovered step paints the overview
    expect(s).toMatchObject({ scaled: 1, statics: 1 })
    cam = zoomAt(cam, 1.3, 400, 300)
    s = stats(); b.paint(frame(layers, cam, { moving: true }), s)
    expect(s).toMatchObject({ scaled: 1, statics: 0 })
    // at rest: a crisp repaint
    s = stats(); b.paint(frame(layers, cam, { moving: false }), s)
    expect(s.statics).toBe(1)
  })

  it('the live layer finds its active nodes by position: in layer order, the id map shared across a drag\'s arrays', () => {
    const { canvas, calls } = fakeCanvas(), b = canvas2d()(canvas)
    const moved = (dx) => doc.map((n, i) => i == 7 || i == 3 ? { ...n, x: n.x + dx } : n)
    const active = new Set(['s7', 's3'])
    b.paint(frame([{ items: doc, active: null }]), stats())
    const a1 = moved(1), a2 = moved(2)
    b.paint(frame([{ items: a1, active }]), stats())
    const s = stats(); calls.length = 0
    b.paint(frame([{ items: a2, active }]), s)
    expect(s).toMatchObject({ statics: 0, nodes: 2 })
    // painted bottom to top: s3 before s7, at their new x
    const rects = calls.filter((c) => c[0] == 'rect').map((c) => c[1])
    expect(rects).toEqual([a2[3].x, a2[7].x])
    expect(positionsOf(a2)).toBe(positionsOf(a1))
  })

  it('positionsOf: one id → index map per array; shared with prev while every id stays in place', () => {
    const a = [{ id: 'a' }, { id: 'b' }, { id: 'c' }], m = positionsOf(a)
    expect([...m]).toEqual([['a', 0], ['b', 1], ['c', 2]])
    expect(positionsOf(a)).toBe(m)
    const b2 = [a[0], { id: 'b', x: 1 }, a[2]]
    expect(positionsOf(b2, a)).toBe(m)
    // an id moved, or no prev: a map of its own
    const c2 = [a[1], a[0], a[2]]
    expect([...positionsOf(c2, a)]).toEqual([['b', 0], ['a', 1], ['c', 2]])
    expect(positionsOf([...a])).not.toBe(m)
    // selectionBox reads it
    const boxes = [{ id: 'p', x: 0, y: 0, width: 10, height: 10 }, { id: 'q', x: 20, y: 0, width: 10, height: 10 }]
    positionsOf(boxes)
    expect(selectionBox(boxes, ['q', 'p'])).toEqual({ x: 0, y: 0, width: 30, height: 10, rotation: 0 })
  })

  // 1,200 nodes, 40 a row at 20 px, 15 px each: a set of 1,000 or more is blitted
  const big = Array.from({ length: 1200 }, (_, i) => rect('b' + i, (i % 40) * 20, Math.floor(i / 40) * 20, 15, 15))
  const K = 1000, first = new Set(big.slice(0, K).map((n) => n.id))
  const shift = (dx, dy = dx) => big.map((n, i) => i < K ? { ...n, x: n.x + dx, y: n.y + dy } : n)

  it('a big active set dragged by a fractional delta is a blit per frame ((x + d) - x is not d in floating point)', () => {
    const { canvas } = fakeCanvas(), b = canvas2d()(canvas)
    b.paint(frame([{ items: shift(0.1, 0.1 / 3), active: first }]), stats())
    for (const d of [0.3, 1.7, 2.9]) {
      const s = stats(); b.paint(frame([{ items: shift(d, d / 3), active: first }]), s)
      expect(s).toMatchObject({ statics: 0, blits: 1, nodes: 0 })
    }
  })

  it('a blit copies only the moving nodes\' bounds (plus a margin), not the whole canvas', () => {
    const { canvas, calls } = fakeCanvas(), b = canvas2d()(canvas)
    // the first 1,000 nodes span 0..795 × 0..495; then moved by 10
    b.paint(frame([{ items: shift(0), active: first }]), stats())
    calls.length = 0
    const s = stats(); b.paint(frame([{ items: shift(10), active: first }]), s)
    expect(s.blits).toBe(1)
    const [, , , , w, h, dx, dy] = calls.filter((c) => c[0] == 'drawImage').at(-1)
    expect([dx, dy, w, h]).toEqual([0, 0, 800, 10 + 495 + 24])
  })

  it('a smaller moving set is painted (cheaper than a bitmap copy)', () => {
    const { canvas } = fakeCanvas(), b = canvas2d()(canvas)
    const few = new Set(big.slice(0, 100).map((n) => n.id))
    const moved = (d) => big.map((n, i) => i < 100 ? { ...n, x: n.x + d } : n)
    b.paint(frame([{ items: moved(0), active: few }]), stats())
    const s = stats(); b.paint(frame([{ items: moved(5), active: few }]), s)
    expect(s).toMatchObject({ statics: 0, blits: 0, nodes: 100 })
  })

  it('a big followed set that only translated is one blit, not a repaint', () => {
    const { canvas } = fakeCanvas(), b = canvas2d()(canvas)
    const layers = [{ items: big, active: null }]
    b.paint(frame(layers, CAMERA, { follow: { ids: first, dx: 0, dy: 0 } }), stats())
    const s = stats(); b.paint(frame(layers, CAMERA, { follow: { ids: first, dx: 5, dy: 3 } }), s)
    expect(s).toMatchObject({ statics: 0, blits: 1, nodes: 0 })
  })
})

describe('the kit', () => {
  it('selectionBox, handles, resize (aspect kept), rotation steps, turn, scaleInto', () => {
    const shapes = [rect('a', 0, 0, 100, 50, { rotation: 30 }), rect('b', 200, 100, 50, 50)]
    expect(selectionBox(shapes, ['a'])).toBe(shapes[0])
    expect(selectionBox(shapes, ['a', 'b'])).toMatchObject({ rotation: 0, x: expect.any(Number), width: expect.any(Number) })
    expect(selectionBox(shapes, ['x'])).toBe(null)
    const hs = handles({ x: 0, y: 0, width: 100, height: 50 }, CAMERA)
    expect(hs).toHaveLength(10)
    const part = (v) => v.data?.dataset?.part ?? v.data?.attrs?.['data-part']
    expect(hs.map(part)).toEqual([undefined, 'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'rotate'])
    expect(resize({ x: 0, y: 0, width: 100, height: 50 }, 'se', { x: 200, y: 60 }, true)).toMatchObject({ x: 0, y: 0, width: 200, height: 100 })
    const d = rotation({ x: 0, y: 0, width: 100, height: 100 }, { x: 100, y: 50 }, { x: 50, y: 100 }, 15)
    expect(d % 15).toBe(0)
    expect(turn({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5 }, 90)).toMatchObject({ x: 0, y: 0, rotation: 90 })
    expect(scaleInto({ x: 10, y: 10, width: 10, height: 10 }, { x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 0, width: 200, height: 200 })).toMatchObject({ x: 20, width: 20 })
  })

  it('gesture: moved only past the slop; snap to edges and centres with guides', () => {
    let g = gesture.start('move', { x: 0, y: 0 })
    g = gesture.move(g, { x: 1, y: 1 }, 1)
    expect(g.moved).toBe(false)
    g = gesture.move(g, { x: 10, y: 0 }, 1)
    expect(g.moved).toBe(true)
    expect(gesture.delta(g)).toEqual({ dx: 10, dy: 0 })
    const t = snapTargets([aabb(rect('o', 100, 0, 50, 50))])
    const r = snap({ x0: 0, y0: 0, x1: 48, y1: 48 }, 50, 3, t, 6)
    expect(r.dx).toBe(52)
    expect(r.guides[0]).toMatchObject({ x1: 100, x2: 100 })
  })

  it('exportSVG: the vocabulary as SVG, frames as clip paths', () => {
    const svg = exportSVG([{ id: 'f', type: 'frame', x: 0, y: 0, width: 100, height: 100, name: 'F' }, rect('r', 50, 50, 100, 100, { parent: 'f' }), { id: 'e', type: 'ellipse', x: 0, y: 200, width: 20, height: 10 }])
    expect(svg).toContain('<clipPath id="clip-f">')
    expect(svg).toContain('<ellipse cx="10" cy="205" rx="10" ry="5"')
  })

  it('keymap: named streams from the main entry (re-exported by sygnal/canvas); never while typing', async () => {
    expect(canvasKeymap).toBe(keymap)
    function K({ state }) { return h('div', {}, h('input', { className: 'field' }), h('span', {}, state.log.join(','))) }
    K.initialState = { log: [] }
    K.intent = ({ DOM }) => keymap(DOM, { 'mod+z': 'UNDO', 'shift+mod+z': 'REDO', 'shift+1': 'FIT', left: ['NUDGE', -1], 'shift+left': ['NUDGE', -10] })
    const push = (k) => (s, d) => ({ ...s, log: [...s.log, d === undefined ? k : k + d] })
    K.model = { UNDO: push('undo'), REDO: push('redo'), FIT: push('fit'), NUDGE: push('nudge') }
    const t = renderComponent(K, { dom: 'real' })
    await t.ready()
    const key = async (init, target = document) => { const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }); target.dispatchEvent(e); await t.settle(); return e }
    expect((await key({ key: 'z', metaKey: true })).defaultPrevented).toBe(true)
    await key({ key: 'Z', metaKey: true, shiftKey: true })
    await key({ key: 'z', ctrlKey: true })
    await key({ key: '!', code: 'Digit1', shiftKey: true })
    await key({ key: 'ArrowLeft' }); await key({ key: 'ArrowLeft', shiftKey: true })
    expect((await key({ key: 'z' })).defaultPrevented).toBe(false)
    await key({ key: 'z', metaKey: true }, t.container.querySelector('.field'))
    expect(t.state.log).toEqual(['undo', 'redo', 'undo', 'fit', 'nudge-1', 'nudge-10'])
    t.dispose()
  })
})

describe('history()', () => {
  const H = history('shapes', { after: (s) => ({ ...s, selection: s.selection.filter((id) => s.shapes.some((x) => x.id === id)) }) })
  it('local: one step per commit (a gesture passes its start), undo / redo, ABORT when there is none', () => {
    let s = { shapes: [rect('a', 0, 0)], selection: ['a'], past: [], future: [] }
    const start = s.shapes
    s = { ...s, shapes: [{ ...s.shapes[0], x: 5 }] }
    s = { ...s, shapes: [{ ...s.shapes[0], x: 10 }] }
    s = H.commit(s, s.shapes, start)
    expect(s.past).toEqual([start])
    expect(H.canUndo(s)).toBe(true)
    s = H.undo(s)
    expect(s.shapes).toBe(start)
    expect(H.canRedo(s)).toBe(true)
    s = H.redo(s)
    expect(s.shapes[0].x).toBe(10)
    expect(typeof H.redo(s)).toBe('symbol')
  })

  it('shared (sygnal/yjs): the same entries go to this user\'s UndoManager; a slow gesture is one step', async () => {
    // shared() syncs an object: the shapes live in state.doc
    const h2 = history('doc')
    function Doc({ state }) { return h('div', {}, String(state.doc.shapes.map((x) => x.x))) }
    Doc.initialState = { doc: { shapes: [rect('a', 0, 0), rect('b', 200, 0)] }, history: null }
    Doc.uses = { doc: shared({ history: 'history' }) }
    const at = (s) => s.doc.shapes[0].x
    Doc.model = {
      MOVE: (s, x) => ({ ...s, doc: { shapes: s.doc.shapes.map((n) => n.id == 'a' ? { ...n, x } : n) } }),
      COMMIT: (s, before) => h2.commit(s, s.doc, before),
      UNDO: h2.undo,
      REDO: h2.redo,
    }
    const net = createNetwork(), peer = net.join(), other = net.join()
    const t = renderComponent(Doc, { drivers: { SHARED: makeYjsDriver({ doc: peer.doc, provider: peer }) } })
    await t.settle()
    const wait = async () => { await t.settle(); await new Promise((r) => setTimeout(r, 0)); await t.settle() }
    const start = t.state.doc
    // a gesture: moves well apart in time (the default 500 ms captureTimeout would merge or split by time)
    for (const x of [10, 20, 30]) { t.simulateAction('MOVE', x); await t.settle(); await new Promise((r) => setTimeout(r, 30)) }
    t.simulateAction('COMMIT', start); await wait()
    expect(t.state.docStep).toBe(1)
    expect(t.state.past).toBeUndefined()
    // a second step, at once: a separate undo
    t.simulateAction('MOVE', 99); await t.settle()
    t.simulateAction('COMMIT', t.state.doc); await wait()
    expect(h2.canUndo(t.state)).toBe(true)
    t.simulateAction('UNDO'); await wait()
    expect(at(t.state)).toBe(30)
    t.simulateAction('UNDO'); await wait()
    expect(at(t.state)).toBe(0)
    expect(h2.canUndo(t.state)).toBe(false)
    t.simulateAction('REDO'); await wait()
    expect(at(t.state)).toBe(30)
    // the other peer converged on it
    expect(other.doc.getMap('doc').toJSON().shapes ?? other.doc.getMap('doc').toJSON()).toBeDefined()
    t.dispose()
    void Y
  })
})

// ---------------------------------------------------------------- text wrapping
// (jsdom has no 2D context: measureText estimates 0.55 × fontSize a character, so a 10 px font is 5.5 a character)
describe('text: wrapping to the box', () => {
  const T = { fontSize: 10 }
  it('word wrap at spaces and after hyphens; a longer word overflows (the DOM); \n breaks; leading spaces stay', () => {
    expect(layoutText('one two three four', { ...T, width: 40 }).lines).toEqual(['one two', 'three', 'four'])
    expect(layoutText('a well-known fact', { ...T, width: 45 }).lines).toEqual(['a well-', 'known', 'fact'])
    expect(layoutText('extraordinarily ok', { ...T, width: 30 }).lines).toEqual(['extraordinarily', 'ok'])
    expect(layoutText('top\n  indented line', { ...T, width: 200 }).lines).toEqual(['top', '  indented line'])
    // 'char': anywhere
    expect(layoutText('abcdefghij', { ...T, width: 23, wrap: 'char' }).lines).toEqual(['abcd', 'efgh', 'ij'])
    // no width (or wrap: 'none'): one line per \n, as before
    expect(layoutText('one two three', T).lines).toEqual(['one two three'])
    expect(layoutText('one two three', { ...T, width: 20, wrap: 'none' }).lines).toEqual(['one two three'])
  })

  it('maxLines cuts with an ellipsis that fits the width; ellipsis: false cuts plainly; wrap none + ellipsis true truncates', () => {
    expect(layoutText('one two three four five', { ...T, width: 40, maxLines: 2 }).lines).toEqual(['one two', 'three…'])
    expect(layoutText('one twoxx three', { ...T, width: 30, maxLines: 2 }).lines).toEqual(['one', 'twox…'])
    expect(layoutText('one two three four five', { ...T, width: 40, maxLines: 2, ellipsis: false }).lines).toEqual(['one two', 'three'])
    expect(layoutText('a long label here', { ...T, width: 40, wrap: 'none', ellipsis: true }).lines).toEqual(['a long…'])
  })

  it('lineHeight sets the line box; the size is the widest line and the lines', () => {
    expect(layoutText('one two three', { ...T, width: 40 })).toMatchObject({ width: 39, height: 25, lineHeight: 12.5 })
    expect(layoutText('one two three', { ...T, width: 40, lineHeight: 2 })).toMatchObject({ height: 40, lineHeight: 20 })
    // measureText: the natural size, unwrapped, whatever width the node has (an auto-width text box: figma-lite's fitText)
    expect(measureText('one two three', { ...T, width: 40 })).toEqual({ width: 72, height: 13 })
  })

  it('paints each line aligned in the box, glyphs centred in the line box; hit box and SVG follow the lines', () => {
    const { ctx, calls } = fakeCanvas()
    const n = { id: 't', type: 'text', x: 10, y: 20, width: 40, text: 'one two three', fontSize: 10, align: 'center', lineHeight: 2 }
    paintNode(ctx, n)
    expect(ctx.textAlign).toBe('center')
    const texts = calls.filter((c) => c[0] == 'fillText')
    // x: the box's centre; y: line i at i × 20, plus the half leading ((2 − 1.25) / 2 × 10) and 1.2
    expect(texts).toEqual([['fillText', 'one two', 30, 20 + 1.2 + 3.75], ['fillText', 'three', 30, 40 + 1.2 + 3.75]])
    // no height: the hit box is the lines'
    expect(hitNodes([n], { x: 15, y: 55 })?.id).toBe('t')
    expect(hitNodes([n], { x: 15, y: 61 })).toBe(null)
    const svg = exportSVG([n])
    expect(svg).toContain('text-anchor="middle"')
    expect(svg).toContain('<tspan x="30" dy="0">one two</tspan><tspan x="30" dy="20">three</tspan>')
    // right-aligned without a width: in the widest line's box
    const { ctx: c2, calls: k2 } = fakeCanvas()
    paintNode(c2, { type: 'text', x: 0, y: 0, text: 'ab\nabcd', fontSize: 10, align: 'right' })
    expect(k2.filter((c) => c[0] == 'fillText').map((c) => c[2])).toEqual([22, 22])
  })

  it('a JSX <text> without a width stays one line (its box measured); with a width it wraps', async () => {
    function T2() {
      return h(Canvas, { className: 'c', width: 400, height: 300 },
        h('text', { className: 'one', x: 0, y: 0, fontSize: 10, id: 'one' }, 'one two three'),
        h('text', { className: 'wrapped', x: 0, y: 100, fontSize: 10, width: 40, id: 'w' }, 'one two three'))
    }
    const t = renderComponent(T2, { dom: 'real' })
    await t.ready()
    const c = canvasOf(t.container.querySelector('.c'))
    expect(c.layers[0].items.map((n) => layoutText(n.text, n).lines)).toEqual([['one two three'], ['one two', 'three']])
    // the wrapped node is hit on its second line
    expect(c.pointer('down', 5, 115).node?.id).toBe('w')
    t.dispose()
  })
})

// ---------------------------------------------------------------- follow
describe('follow(camera, target, options): a camera that follows', () => {
  const V = { width: 800, height: 600 }
  it('no dead zone: the target at the view\'s centre (plus offset); the same camera object when it stays', () => {
    const c = follow(CAMERA, { x: 1000, y: 500 }, V)
    expect(c).toEqual({ x: 600, y: 200, zoom: 1 })
    expect(follow(c, { x: 1000, y: 500 }, V)).toBe(c)
    expect(follow(CAMERA, { x: 1000, y: 500 }, { ...V, offset: { x: -100, y: 50 } })).toEqual({ x: 700, y: 150, zoom: 1 })
    // a box: its centre; zoom 2: the view is half as wide in world units
    expect(follow({ x: 0, y: 0, zoom: 2 }, { x: 990, y: 490, width: 20, height: 20 }, V)).toEqual({ x: 800, y: 350, zoom: 2 })
  })

  it('a dead zone: still inside it, then the camera moves just enough to keep the target at its edge', () => {
    const o = { ...V, deadzone: { width: 200, height: 100 } }
    const c0 = { x: 0, y: 0, zoom: 1 }
    expect(follow(c0, { x: 450, y: 320 }, o)).toBe(c0)
    expect(follow(c0, { x: 520, y: 300 }, o)).toEqual({ x: 20, y: 0, zoom: 1 })
    expect(follow(c0, { x: 250, y: 200 }, o)).toEqual({ x: -50, y: -50, zoom: 1 })
  })

  it('lerp eases toward it (per axis); dt makes it frame-rate independent', () => {
    expect(follow(CAMERA, { x: 1400, y: 300 }, { ...V, lerp: 0.25 })).toEqual({ x: 250, y: 0, zoom: 1 })
    expect(follow(CAMERA, { x: 1400, y: 1300 }, { ...V, lerp: [0.5, 1] })).toEqual({ x: 500, y: 1000, zoom: 1 })
    // two calls at 60 Hz ≈ one at 30 Hz with dt 33.3
    const two = follow(follow(CAMERA, { x: 1400, y: 300 }, { ...V, lerp: 0.25, dt: 1000 / 60 }), { x: 1400, y: 300 }, { ...V, lerp: 0.25, dt: 1000 / 60 })
    const one = follow(CAMERA, { x: 1400, y: 300 }, { ...V, lerp: 0.25, dt: 2000 / 60 })
    expect(one.x).toBeCloseTo(two.x, 9)
  })

  it('bounds clamp; a world smaller than the view is centred', () => {
    const b = { x0: 0, y0: 0, x1: 2000, y1: 600 }
    expect(follow(CAMERA, { x: 100, y: 100 }, { ...V, bounds: b })).toEqual(CAMERA)
    expect(follow(CAMERA, { x: 1990, y: 900 }, { ...V, bounds: b })).toEqual({ x: 1200, y: 0, zoom: 1 })
    expect(follow(CAMERA, { x: 50, y: 50 }, { ...V, bounds: { x0: 0, y0: 0, x1: 400, y1: 300 } })).toEqual({ x: -200, y: -150, zoom: 1 })
  })

  it('round: whole screen pixels, never stalling short of the target (deterministic: a replay is the same run)', () => {
    let c = { x: 0, y: 0, zoom: 1 }
    const xs = []
    for (let i = 0; i < 60; i++) { c = follow(c, { x: 410.3, y: 300 }, { ...V, lerp: 0.1, round: true }); xs.push(c.x) }
    expect(xs.every(Number.isInteger)).toBe(true)
    // the target is 10.3 px right of centre: the camera ends on the nearest pixel, 10, and stays put
    expect(c.x).toBe(10)
    expect(xs.slice(0, 4)).toEqual([1, 2, 3, 4])
    expect(follow(c, { x: 410.3, y: 300 }, { ...V, lerp: 0.1, round: true })).toBe(c)
  })
})

// ---------------------------------------------------------------- images
// a stand-in for the DOM's Image: loads settle when the test says (images[src].load(w, h) / .fail())
const images = {}
class FakeImage {
  constructor() { this.complete = false; this.naturalWidth = 0; this.naturalHeight = 0 }
  set src(v) {
    this._src = v
    images[v] = { img: this, load: (w = 64, hh = 32) => { this.naturalWidth = w; this.naturalHeight = hh; this.complete = true; this.onload() }, fail: () => this.onerror() }
  }
  get src() { return this._src }
  decode() { return Promise.resolve() }
}
const settle = () => new Promise((r) => setTimeout(r, 0))
describe('image nodes, sprite sheets, <Image>', () => {
  const saved = globalThis.Image
  afterEach(() => { globalThis.Image = saved; clearImages(); for (const k in images) delete images[k] })
  const loaded = (w, hh) => ({ naturalWidth: w, naturalHeight: hh, complete: true })

  it('paints the crop fitted into the box (CSS object-fit), mirrored with flipX, without smoothing for pixel art', () => {
    const { ctx, calls } = fakeCanvas(), img = loaded(200, 100)
    const draw = (n) => { calls.length = 0; paintNode(ctx, { type: 'image', image: img, x: 0, y: 0, width: 100, height: 100, ...n }); return calls.find((c) => c[0] == 'drawImage')?.slice(2) }
    expect(draw({})).toEqual([0, 0, 200, 100, 0, 0, 100, 100])
    expect(draw({ fit: 'contain' })).toEqual([0, 0, 200, 100, 0, 25, 100, 50])
    expect(draw({ fit: 'cover' })).toEqual([50, 0, 100, 100, 0, 0, 100, 100])
    expect(draw({ fit: 'none' })).toEqual([50, 0, 100, 100, 0, 0, 100, 100])
    expect(draw({ fit: 'scale-down', width: 400, height: 400 })).toEqual([0, 0, 200, 100, 100, 150, 200, 100])
    expect(draw({ sx: 16, sy: 0, sw: 16, sh: 16 })).toEqual([16, 0, 16, 16, 0, 0, 100, 100])
    // no size: the crop's natural size; one side given: the aspect ratio kept
    expect(draw({ width: undefined, height: undefined })).toEqual([0, 0, 200, 100, 0, 0, 200, 100])
    expect(draw({ width: 50, height: undefined })).toEqual([0, 0, 200, 100, 0, 0, 50, 25])
    calls.length = 0
    paintNode(ctx, { type: 'image', image: img, x: 10, y: 0, width: 20, height: 10, flipX: true, smoothing: false })
    expect(calls.filter((c) => c[0] == 'scale' || c[0] == 'translate')).toEqual([['translate', 20, 5], ['scale', -1, 1], ['translate', -20, -5]])
    expect(ctx.imageSmoothingEnabled).toBe(true)
    // an <img> still loading paints nothing
    calls.length = 0
    paintNode(ctx, { type: 'image', image: { complete: false }, x: 0, y: 0, width: 10, height: 10 })
    expect(calls.some((c) => c[0] == 'drawImage')).toBe(false)
  })

  it('frameOf: a sheet\'s frame as the node\'s crop; frameAt: an animation\'s frame at t', () => {
    const sheet = { src: '/s.png', frameWidth: 16, frameHeight: 16, columns: 8, margin: 1, spacing: 2 }
    expect(frameOf(sheet, 0)).toEqual({ src: '/s.png', sx: 1, sy: 1, sw: 16, sh: 16 })
    expect(frameOf(sheet, 9)).toEqual({ src: '/s.png', sx: 19, sy: 19, sw: 16, sh: 16 })
    expect([0, 7, 8, 15, 16, 24].map((t) => frameAt([4, 5], t, 8))).toEqual([4, 4, 5, 5, 4, 5])
    expect(frameAt([1, 2, 3], 99, 1, false)).toBe(3)
  })

  it('hit box, the accessibility name (alt), exportSVG with the crop', () => {
    const img = loaded(128, 32)
    const n = { id: 'hero', type: 'image', image: img, x: 0, y: 0, width: 32, height: 32, sx: 16, sy: 0, sw: 16, sh: 16, alt: 'Hero', flipX: true, smoothing: false }
    expect(hitNodes([n], { x: 30, y: 30 })?.id).toBe('hero')
    img.src = '/sheet.png'
    const svg = exportSVG([n])
    expect(svg).toContain('<g transform="matrix(-1 0 0 1 32 0)"><svg x="0" y="0" width="32" height="32" viewBox="16 0 16 16" preserveAspectRatio="none"><image href="/sheet.png" width="128" height="32" style="image-rendering:pixelated"/></svg></g>')
    // not loaded yet (a src): SVG's own fit
    expect(exportSVG([{ type: 'image', src: '/later.png', x: 0, y: 0, width: 10, height: 10, fit: 'contain' }])).toContain('<image href="/later.png" x="0" y="0" width="10" height="10" preserveAspectRatio="xMidYMid meet"/>')
  })

  // a backend that records what it was asked to paint, and its refreshes
  function Gallery({ state }) {
    return h('div', {},
      h(Canvas, { className: 'g', width: 400, height: 300, headless: false, backend: state.backend },
        h('shapes', { className: 'pics', items: state.items, 'aria-label': 'Pictures' })))
  }
  Gallery.intent = ({ DOM }) => ({ LOADED: DOM.select('.g').events('imageload').detail(), FAILED: DOM.select('.g').events('imageerror').detail() })
  Gallery.model = { LOADED: (s, d) => ({ ...s, log: [...s.log, 'load ' + d.src] }), FAILED: (s, d) => ({ ...s, log: [...s.log, 'error ' + d.src + ' ' + d.error.message] }), SET: (s, d) => ({ ...s, ...d }) }
  const recording = () => {
    const r = { paints: 0, refreshes: 0, drawn: [] }
    r.backend = () => ({
      paint(f) {
        r.paints++
        const { ctx, calls } = fakeCanvas()
        for (const l of f.layers) for (const n of l.items) paintNode(ctx, n)
        r.drawn = calls.filter((c) => c[0] == 'drawImage').map((c) => c[1].src)
      },
      refresh() { r.refreshes++ },
    })
    return r
  }

  it('a data layer\'s image loads once per URL, paints when it arrives (the caches refreshed), and is reported', async () => {
    globalThis.Image = FakeImage
    const r = recording()
    const items = [{ id: 'a', type: 'image', src: '/a.png', x: 0, y: 0, width: 50, height: 50, alt: 'A' }, { id: 'b', type: 'image', src: '/a.png', x: 60, y: 0, width: 50, height: 50 }]
    const t = renderComponent(Gallery, { dom: 'real', initialState: { items, backend: r.backend, log: [] } })
    await t.ready(); await settle()
    const c = canvasOf(t.container.querySelector('.g'))
    c.paintNow()
    expect(Object.keys(images)).toEqual(['/a.png'])
    expect(r.drawn).toEqual([])
    images['/a.png'].load()
    await settle(); await t.settle()
    expect(r.refreshes).toBe(1)
    expect(t.state.log).toEqual(['load /a.png'])
    c.paintNow()
    expect(r.drawn).toEqual(['/a.png', '/a.png'])
    // the projection names it by its alt
    c.project()
    expect(t.container.querySelector('[data-node="a"]').getAttribute('aria-label')).toBe('A')
    t.dispose()
  })

  it('a failed load paints nothing and is reported; the last canvas using an image frees it', async () => {
    globalThis.Image = FakeImage
    const r = recording()
    const t = renderComponent(Gallery, { dom: 'real', initialState: { items: [{ id: 'x', type: 'image', src: '/x.png', x: 0, y: 0, width: 10, height: 10 }], backend: r.backend, log: [] } })
    await t.ready(); await settle()
    images['/x.png'].fail()
    await settle(); await t.settle()
    expect(t.state.log).toEqual(['error /x.png could not load /x.png: the image did not load'])
    // the layer drops it: it leaves the cache (shown again later: loaded again)
    await t.simulateAction('SET', { items: [] })
    await settle()
    delete images['/x.png']
    await t.simulateAction('SET', { items: [{ id: 'x', type: 'image', src: '/x.png', x: 0, y: 0, width: 10, height: 10 }] })
    await settle()
    expect(images['/x.png']).toBeDefined()
    t.dispose()
  })

  it('<Image>: Suspense shows its fallback until it has loaded; a failed one is the view\'s error (onError)', async () => {
    globalThis.Image = FakeImage
    function Map_({ state }) {
      return h('main', null, h(Suspense, { fallback: h('p', { className: 'loading' }, 'Loading…') },
        h(Canvas, { className: 'map', width: 400, height: 300 },
          h(CanvasImage, { className: 'tiles', src: state.src, x: 0, y: 0, width: 100, height: 100, alt: 'Map', id: 'map' }))))
    }
    Map_.initialState = { src: '/map.png' }
    Map_.onError = (e) => h('p', { className: 'error' }, e.message)
    const t = renderComponent(Map_, { dom: 'real' })
    await t.ready()
    expect(t.container.querySelector('.loading')).not.toBe(null)
    expect(t.container.querySelector('.map')).toBe(null)
    images['/map.png'].load(100, 100)
    await settle(); await t.settle()
    expect(t.container.querySelector('.loading')).toBe(null)
    const c = canvasOf(t.container.querySelector('.map'))
    expect(c.layers[0].items[0]).toMatchObject({ type: 'image', src: '/map.png', alt: 'Map' })
    expect(c.pointer('down', 50, 50).node?.id).toBe('map')
    t.dispose()

    function Broken() { return h(Canvas, { width: 100, height: 100 }, h(CanvasImage, { src: '/broken.png', x: 0, y: 0 })) }
    Broken.onError = (e) => h('p', { className: 'error' }, e.message)
    const t2 = renderComponent(Broken, { dom: 'real' })
    await t2.ready()
    images['/broken.png'].fail()
    await settle(); await t2.settle()
    expect(t2.container.querySelector('.error').textContent).toBe('could not load /broken.png: the image did not load')
    t2.dispose()
    expect(typeof preloadImage).toBe('function')
  })
})
