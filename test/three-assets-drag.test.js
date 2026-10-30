// @vitest-environment jsdom
// sygnal/three: <Model> / <Texture> (loaded assets with Suspense, the cache, disposal, onError)
// and dragging (pointer capture, drag planes, the HTML drag events processDrag reads). jsdom:
// the Scene is headless; a fake loader decides when each load settles.
import { describe, it, expect, afterEach } from 'vitest'
import * as THREE from 'three'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/collection.ts'
import { Suspense } from '../src/suspense.ts'
import { renderComponent } from '../src/extra/testing.js'
import processDrag from '../src/extra/processDrag.ts'
import run from '../src/extra/run.ts'
import { Scene, sceneOf, Model, Texture, clear, createThreeHost } from '../src/three.ts'

// a loader whose loads settle when the test says: loads[url] = { resolve, reject }, count per url
const loads = {}, count = {}
class FakeLoader {
  loadAsync(url) {
    count[url] = (count[url] || 0) + 1
    return new Promise((resolve, reject) => { loads[url] = { resolve, reject } })
  }
}
const tree = () => {
  const g = new THREE.Group()
  g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial({ map: new THREE.Texture() })))
  return { scene: g, animations: [] }
}
const flush = () => new Promise((r) => setTimeout(r, 0))

afterEach(() => {
  document.body.innerHTML = ''
  clear()
  for (const k in count) delete count[k]
})

function Forest({ state }) {
  return h('main', null,
    h('p', { className: 'n' }, String(state.trees.length)),
    h(Suspense, { fallback: h('p', { className: 'loading' }, 'Loading…') },
      h(Scene, { className: 'viewport', width: 400, height: 300, frameloop: 'never' },
        h('perspectiveCamera', { makeDefault: true, position: [0, 0, 8] }),
        ...state.trees.map((x, i) => h(Model, { key: i, src: state.src, loader: FakeLoader, className: 'tree', position: [x, 0, 0] })))))
}
Forest.initialState = { src: '/tree.glb', trees: [-2, 2] }
Forest.intent = ({ DOM }) => ({ PICK: DOM.click('.tree'), CUT: DOM.select('.cut').events('click') })
Forest.model = { PICK: (s, e) => ({ ...s, picked: e.point }), CUT: (s) => ({ ...s, trees: [] }), SET: (s, d) => ({ ...s, ...d }) }

describe('<Model> and <Texture>', () => {
  it('Suspense shows its fallback until the model loads; one load for both trees, one clone each', async () => {
    const t = renderComponent(Forest, { dom: 'real' })
    await t.ready()
    expect(t.container.querySelector('.loading')).not.toBe(null)
    expect(t.container.querySelector('.viewport')).toBe(null)
    expect(count['/tree.glb']).toBe(1)
    loads['/tree.glb'].resolve(tree())
    await flush(); await t.settle()
    expect(t.container.querySelector('.loading')).toBe(null)
    const s = sceneOf(t.container.querySelector('.viewport'))
    const els = [...t.container.querySelectorAll('primitive.tree')]
    expect(els).toHaveLength(2)
    const [a, b] = els.map((el) => s.target.objectOf(el))
    expect(a).not.toBe(b)
    expect(a.position.x).toBe(-2)
    expect(b.position.x).toBe(2)
    // the clones share the geometry
    expect(a.children[0].geometry).toBe(b.children[0].geometry)
    // a raycast on a mesh of the model is a click on the Model's element
    s.click(els[1])
    await t.waitForState((st) => st.picked)
    expect(t.state.picked[0]).toBeCloseTo(2, 0)
    t.dispose()
  })

  it('frees the geometries, materials and textures with the last element, and loads again after', async () => {
    const t = renderComponent(Forest, { dom: 'real' })
    await t.ready()
    const v = tree()
    loads['/tree.glb'].resolve(v)
    await flush(); await t.settle()
    const mesh = v.scene.children[0], freed = []
    mesh.geometry.addEventListener('dispose', () => freed.push('geometry'))
    mesh.material.addEventListener('dispose', () => freed.push('material'))
    mesh.material.map.addEventListener('dispose', () => freed.push('texture'))
    t.simulateAction('SET', { trees: [0] })
    await t.settle(); await flush()
    expect(freed).toEqual([])
    t.simulateAction('SET', { trees: [] })
    await t.settle(); await flush()
    expect(freed.sort()).toEqual(['geometry', 'material', 'texture'])
    t.simulateAction('SET', { trees: [1] })
    await t.settle()
    expect(count['/tree.glb']).toBe(2)
    t.dispose()
  })

  it('a remount in the same patch keeps the asset (no free, no second load)', async () => {
    const t = renderComponent(Forest, { dom: 'real' })
    await t.ready()
    const v = tree()
    loads['/tree.glb'].resolve(v)
    await flush(); await t.settle()
    let freed = 0
    v.scene.children[0].geometry.addEventListener('dispose', () => freed++)
    // the elements change (new keys): old ones go, new ones come in one patch
    t.simulateAction('SET', { trees: [5, 6, 7] })
    await t.settle(); await flush()
    expect(freed).toBe(0)
    expect(count['/tree.glb']).toBe(1)
    expect(t.container.querySelectorAll('primitive.tree')).toHaveLength(3)
    t.dispose()
  })

  it("a failed load is the view's error: the component's onError renders", async () => {
    function Broken() { return h('div', null, h(Scene, { frameloop: 'never' }, h(Model, { src: '/missing.glb', loader: FakeLoader }))) }
    Broken.onError = (e) => h('p', { className: 'error' }, e.message)
    const t = renderComponent(Broken, { dom: 'real' })
    await t.ready()
    loads['/missing.glb'].reject(new Error('404'))
    await flush(); await t.settle()
    expect(t.container.querySelector('.error').textContent).toBe('could not load /missing.glb: 404')
    t.dispose()
  })

  it('without Suspense the scene is there at once and the model joins it when loaded', async () => {
    function Plain() { return h(Scene, { className: 'viewport', frameloop: 'never' }, h('ambientLight'), h(Model, { src: '/late.glb', loader: FakeLoader, className: 'late' })) }
    const t = renderComponent(Plain, { dom: 'real' })
    await t.ready()
    const s = sceneOf(t.container.querySelector('.viewport'))
    expect(t.container.querySelector('sygnal-asset').getAttribute('data-sygnal-lazy')).toBe('loading')
    expect(s.target.size()).toBe(1)
    loads['/late.glb'].resolve(tree())
    await flush(); await t.settle()
    expect(s.target.objectOf(t.container.querySelector('primitive.late')).isGroup).toBe(true)
    t.dispose()
  })

  it('Suspense inside the Scene: a 3D fallback in place of the loading part', async () => {
    function Inner() {
      return h(Scene, { className: 'viewport', frameloop: 'never' },
        h('ambientLight'),
        h(Suspense, { fallback: h('mesh', { className: 'box' }, h('boxGeometry'), h('meshBasicMaterial', { wireframe: true })) },
          h(Model, { src: '/inner.glb', loader: FakeLoader, className: 'model' })))
    }
    const t = renderComponent(Inner, { dom: 'real' })
    await t.ready()
    const s = sceneOf(t.container.querySelector('.viewport'))
    expect(s.target.objectOf(t.container.querySelector('mesh.box')).material.wireframe).toBe(true)
    loads['/inner.glb'].resolve(tree())
    await flush(); await t.settle()
    expect(t.container.querySelector('mesh.box')).toBe(null)
    expect(s.target.objectOf(t.container.querySelector('primitive.model')).isGroup).toBe(true)
    // the same Scene instance throughout (Suspense inside it doesn't remount it)
    expect(sceneOf(t.container.querySelector('.viewport'))).toBe(s)
    t.dispose()
  })

  it('<Texture> attaches as map by default (sRGB with the default loader), or where attach says', async () => {
    const tex = new THREE.Texture()
    function Mat() {
      return h(Scene, { className: 'viewport', frameloop: 'never' },
        h('mesh', { className: 'a' }, h('planeGeometry'), h('meshStandardMaterial', null, h(Texture, { src: '/wood.png', loader: FakeLoader }))),
        h('mesh', { className: 'b' }, h('planeGeometry'), h('meshStandardMaterial', null, h(Texture, { src: '/wood.png', loader: FakeLoader, attach: 'roughnessMap' }))))
    }
    const t = renderComponent(Mat, { dom: 'real' })
    await t.ready()
    loads['/wood.png'].resolve(tex)
    await flush(); await t.settle()
    const s = sceneOf(t.container.querySelector('.viewport'))
    expect(s.target.objectOf(t.container.querySelector('mesh.a')).material.map).toBe(tex)
    expect(s.target.objectOf(t.container.querySelector('mesh.b')).material.roughnessMap).toBe(tex)
    expect(count['/wood.png']).toBe(1)
    t.dispose()
  })

  it('preload starts a load ahead; the view then renders it at once', async () => {
    const p = Model.preload('/early.glb', FakeLoader)
    loads['/early.glb'].resolve(tree())
    await p
    function Early() { return h(Scene, { className: 'viewport', frameloop: 'never' }, h(Model, { src: '/early.glb', loader: FakeLoader, className: 'm' })) }
    const t = renderComponent(Early, { dom: 'real' })
    await t.ready()
    expect(t.container.querySelector('sygnal-asset')).toBe(null)
    expect(t.container.querySelector('primitive.m')).not.toBe(null)
    expect(count['/early.glb']).toBe(1)
    t.dispose()
  })

  it('<primitive object>: an object of the app, never disposed', async () => {
    const geo = new THREE.BoxGeometry()
    const obj = new THREE.Mesh(geo, new THREE.MeshBasicMaterial())
    let disposed = 0
    geo.addEventListener('dispose', () => disposed++)
    function P({ state }) { return h(Scene, { className: 'viewport', frameloop: 'never' }, state.on ? h('primitive', { object: obj, position: [1, 2, 3] }) : null) }
    P.initialState = { on: true }
    P.model = { OFF: (s) => ({ ...s, on: false }) }
    const t = renderComponent(P, { dom: 'real' })
    await t.ready()
    expect(obj.position.toArray()).toEqual([1, 2, 3])
    t.simulateAction('OFF')
    await t.settle()
    expect(obj.parent).toBe(null)
    expect(disposed).toBe(0)
    t.dispose()
  })
})

// ---------------------------------------------------------------------------------------- drag

function Piece({ state }) {
  return h('mesh', { className: 'piece', capture: 'xz', position: [state.x, 0.5, state.z] },
    h('boxGeometry'), h('meshBasicMaterial'))
}
Piece.intent = ({ DOM }) => ({
  GRAB: DOM.select('.piece').events('gotpointercapture'),
  MOVE: DOM.select('.piece').events('pointermove').filter((e) => e.captured),
  DROP: DOM.select('.piece').events('lostpointercapture'),
  CLICK: DOM.click('.piece'),
})
Piece.model = {
  GRAB: (s) => ({ ...s, from: [s.x, s.z], dragging: true }),
  MOVE: (s, e) => ({ ...s, x: s.from[0] + e.delta[0], z: s.from[1] + e.delta[2], y: e.point[1] }),
  DROP: (s) => ({ ...s, dragging: false }),
  CLICK: (s) => ({ ...s, clicks: (s.clicks || 0) + 1 }),
}
function Board() {
  return h(Scene, { className: 'viewport', width: 400, height: 300, frameloop: 'never' },
    h('perspectiveCamera', { makeDefault: true, position: [0, 6, 6], lookAt: [0, 0, 0] }),
    h('mesh', { className: 'floor', rotation: [-Math.PI / 2, 0, 0] }, h('planeGeometry', { args: [20, 20] }), h('meshBasicMaterial')),
    h(Collection, { of: Piece, from: 'pieces' }))
}
Board.initialState = { pieces: [{ id: 1, x: 0, z: 0 }] }

describe('dragging', () => {
  it('capture="xz": the drag follows the pointer on the ground plane, off the object too, and clicks nothing', async () => {
    const t = renderComponent(Board, { dom: 'real' })
    await t.ready()
    const s = sceneOf(t.container.querySelector('.viewport'))
    const piece = t.container.querySelector('.piece')
    const events = []
    // (s.drag moves onto the piece before the press: a plain pointermove, not captured)
    for (const type of ['gotpointercapture', 'lostpointercapture', 'pointermove', 'pointerup', 'click']) piece.addEventListener(type, (e) => (e.type != 'pointermove' || e.captured) && events.push(type))
    // far to the right: the pointer leaves the box after the first steps
    const [x, y] = s.pixelOf(piece)
    s.drag(piece, [x + 120, y], { steps: 6 })
    await t.settle()
    const p = t.state.pieces[0]
    expect(p.dragging).toBe(false)
    expect(p.x).toBeGreaterThan(1.5)
    expect(Math.abs(p.z)).toBeLessThan(0.3)
    // the ground plane through the grab point (on the box: 0 < y <= 1)
    expect(p.y).toBeGreaterThan(0)
    expect(p.y).toBeLessThanOrEqual(1)
    expect(s.target.objectOf(piece).position.x).toBeCloseTo(p.x, 5)
    expect(events[0]).toBe('gotpointercapture')
    expect(events.filter((e) => e == 'pointermove')).toHaveLength(6)
    expect(events.slice(-2)).toEqual(['pointerup', 'lostpointercapture'])
    expect(p.clicks).toBe(undefined)
    // a press without a move is still a click
    s.click(piece)
    await t.settle()
    expect(t.state.pieces[0].clicks).toBe(1)
    t.dispose()
  })

  it('el.setPointerCapture(e.pointerId) from code: the same capture, a plane facing the camera', async () => {
    function Free() {
      return h(Scene, { className: 'viewport', width: 400, height: 300, frameloop: 'never' },
        h('mesh', { className: 'ball' }, h('sphereGeometry', { args: [0.5] }), h('meshBasicMaterial')))
    }
    const t = renderComponent(Free, { dom: 'real' })
    await t.ready()
    const s = sceneOf(t.container.querySelector('.viewport'))
    const ball = t.container.querySelector('.ball'), moves = []
    ball.addEventListener('pointerdown', (e) => { e.target.setPointerCapture(e.pointerId); expect(e.target.hasPointerCapture(e.pointerId)).toBe(true) })
    ball.addEventListener('pointermove', (e) => e.captured && moves.push(e))
    const [x, y] = s.pixelOf(ball)
    s.drag(ball, [x + 100, y + 60], { steps: 4 })
    expect(moves).toHaveLength(4)
    expect(moves.every((e) => e.captured)).toBe(true)
    // facing the camera (at z = 5, looking down -z): the plane z = the grab point's
    expect(moves[3].point[2]).toBeCloseTo(moves[0].point[2] - moves[0].delta[2], 5)
    expect(moves[3].point[0]).toBeGreaterThan(0.8)
    expect(moves[3].point[1]).toBeLessThan(-0.4)
    expect(s.target.pick(0.9, 0.9)).toBe(null)
    t.dispose()
  })

  it('draggable: the HTML drag events on the scene, so processDrag works (a box into a bin)', async () => {
    function Bin({ state }) {
      return h(Scene, { className: 'viewport', width: 400, height: 300, frameloop: 'never' },
        state.boxes.map((b) => h('mesh', { key: b, className: 'box', draggable: true, 'data-id': b, position: [-1.5, 0, 0] }, h('boxGeometry'), h('meshBasicMaterial'))),
        h('mesh', { className: 'bin', position: [1.5, 0, 0] }, h('boxGeometry', { args: [1, 1, 1] }), h('meshBasicMaterial')))
    }
    Bin.initialState = { boxes: ['a'], over: 0, started: 0 }
    Bin.intent = ({ DOM }) => {
      const { dragStart$, dragOver$, drop$, dragEnd$ } = processDrag({ draggable: DOM.select('.box'), dropZone: DOM.select('.bin') })
      return { START: dragStart$, OVER: dragOver$, DROP: drop$, END: dragEnd$ }
    }
    Bin.model = {
      START: (s, e) => ({ ...s, started: s.started + 1, allowed: e.dataTransfer.effectAllowed }),
      OVER: (s) => ({ ...s, over: s.over + 1 }),
      DROP: (s, e) => ({ ...s, boxes: [], dropEffect: e.dataTransfer.dropEffect, at: e.point }),
      END: (s) => ({ ...s, ended: true }),
    }
    const t = renderComponent(Bin, { dom: 'real' })
    await t.ready()
    const s = sceneOf(t.container.querySelector('.viewport'))
    const box = t.container.querySelector('.box'), clicks = []
    box.addEventListener('click', () => clicks.push(1))
    s.drag(box, t.container.querySelector('.bin'), { steps: 5 })
    await t.settle()
    expect(t.state.started).toBe(1)
    expect(t.state.allowed).toBe('move')
    expect(t.state.over).toBeGreaterThan(0)
    expect(t.state.boxes).toEqual([])
    expect(t.state.dropEffect).toBe('move')
    expect(t.state.at[0]).toBeGreaterThan(0.9)
    expect(t.state.ended).toBe(true)
    expect(clicks).toEqual([])
    t.dispose()
  })

  it('the host mode captures too (no DOM at all)', async () => {
    const host = createThreeHost({ width: 400, height: 300 })
    const app = run(Board, { DOM: host.driver })
    await new Promise((r) => setTimeout(r, 10))
    const piece = host.doc.querySelector('.piece')
    const [x, y] = host.pixelOf(piece)
    host.pointer('move', x, y)
    host.pointer('down', x, y)
    expect(host.router.captured()).toBe(piece)
    for (let i = 1; i <= 4; i++) host.pointer('move', x - i * 20, y)
    host.pointer('up', x - 80, y)
    await new Promise((r) => setTimeout(r, 10))
    expect(host.router.captured()).toBe(null)
    expect(host.target.objectOf(host.doc.querySelector('.piece')).position.x).toBeLessThan(-1)
    app.dispose()
  })
})
