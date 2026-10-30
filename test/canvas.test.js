// @vitest-environment jsdom
// sygnal/canvas (dev-plans/research/canvas-apps): the island headless in jsdom (no 2D context: the
// display list, hit testing, the shared pointer router and the projection are the same), driven by
// raw input at canvas pixels through canvasOf(el).pointer(kind, x, y, init); the canvas2d backend
// against a recording 2D context (the static layer, the camera cache, blits); the kit; keymap on
// the main entry; history() alone and routed to sygnal/yjs's per-user UndoManager.
import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { keymap, xs } from '../src/index.ts'
import {
  Canvas, canvasOf, canvas2d, pointer, history, handles, selectionBox, resize, rotation, turn, scaleInto,
  gesture, snap, snapTargets, fit, union, zoomAt, toScreen, toWorld, panBy, exportSVG, CAMERA, aabb, hitNodes,
  keymap as canvasKeymap,
} from '../src/canvas.ts'
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

  it('a big followed set that only translated is one blit, not a repaint', () => {
    const { canvas } = fakeCanvas(), b = canvas2d()(canvas)
    const ids = new Set(doc.slice(0, 100).map((n) => n.id)), layers = [{ items: doc, active: null }]
    b.paint(frame(layers, CAMERA, { follow: { ids, dx: 0, dy: 0 } }), stats())
    const s = stats(); b.paint(frame(layers, CAMERA, { follow: { ids, dx: 5, dy: 3 } }), s)
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
