// @vitest-environment jsdom
// sygnal/three (research: dev-plans/research/canvas-three): the three target, raycast events,
// disposal, the controlled camera, `animate` per frame without app work, and the host mode.
// jsdom has no WebGL: the Scene runs headless (the scene graph and the raycaster are plain math).
import { describe, it, expect, afterEach } from 'vitest'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/collection.ts'
import { renderComponent } from '../src/extra/testing.js'
import run from '../src/extra/run.ts'
import { Scene, sceneOf, createThreeHost, createThreeTarget, extend } from '../src/three.ts'

afterEach(() => { document.body.innerHTML = '' })

const HOME = { position: [0, 1.5, 6], target: [0, 0, 0] }

function Cube({ state, context }) {
  return h('mesh', {
    className: 'cube', role: 'button', tabIndex: 0, 'aria-label': `cube ${state.id}`,
    position: [state.x, 0, 0], scale: state.selected ? 1.3 : 1,
    animate: context.spin ? { rotation: (t) => [0, t, 0] } : undefined,
  },
  h('boxGeometry', { args: [1, 1, 1] }),
  h('meshStandardMaterial', { color: state.hover ? '#ffffff' : '#4f8cff' }))
}
Cube.intent = ({ DOM }) => ({
  SELECT: DOM.click('.cube'),
  OVER: DOM.select('.cube').events('pointerover'),
  OUT: DOM.select('.cube').events('pointerout'),
  REMOVE: DOM.select('.cube').events('dblclick'),
})
Cube.model = {
  SELECT: (s, e) => ({ ...s, selected: !s.selected, hitAt: e.point || null }),
  OVER: (s) => ({ ...s, hover: true }),
  OUT: (s) => ({ ...s, hover: false }),
  REMOVE: () => undefined,
}

function App({ state }) {
  return h('main', null,
    h('p', { className: 'status' }, `${state.cubes.filter((c) => c.selected).length} selected`),
    h('button', { className: 'reset-view' }, 'Reset view'),
    h(Scene, { className: 'viewport', width: 640, height: 400, frameloop: 'never', Orbit: OrbitControls, camera: state.camera },
      h('ambientLight', { intensity: 0.5 }),
      h('perspectiveCamera', { makeDefault: true, fov: 50 }),
      h('group', { className: 'world' }, h(Collection, { of: Cube, from: 'cubes' }))))
}
App.initialState = { spin: false, camera: HOME, cubes: [0, 1, 2].map((i) => ({ id: i, x: (i - 1) * 1.8, selected: false, hover: false, hitAt: null })) }
App.context = { spin: (s) => s.spin }
App.intent = ({ DOM }) => ({
  CAMERA: DOM.select('.viewport').events('camerachange').detail(),
  RESET_VIEW: DOM.click('.reset-view'),
})
App.model = {
  CAMERA: (s, camera) => ({ ...s, camera }),
  RESET_VIEW: (s) => ({ ...s, camera: HOME }),
}

const setup = async () => {
  const t = renderComponent(App, { dom: 'real' })
  await t.ready()
  return { t, s: sceneOf(t.container.querySelector('.viewport')), meshes: [...t.container.querySelectorAll('mesh.cube')] }
}
const near = (a, b) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 6))

describe('<Scene> (jsdom, headless)', () => {
  it('builds the scene graph: tags, args, attach, makeDefault', async () => {
    const { t, s, meshes } = await setup()
    expect(s.headless).toBe(true)
    // light + camera + group + 3 × (mesh, geometry, material)
    expect(s.target.size()).toBe(12)
    const m = s.target.objectOf(meshes[0])
    expect([m.type, m.geometry.type, m.material.type, m.parent.type]).toEqual(['Mesh', 'BoxGeometry', 'MeshStandardMaterial', 'Group'])
    expect(m.position.toArray()).toEqual([-1.8, 0, 0])
    expect(s.target.camera().aspect).toBeCloseTo(640 / 400)
    t.dispose()
  })

  it("a click is a raycast that reaches the cube's own intent, with the point", async () => {
    const { t, s, meshes } = await setup()
    expect(s.click(meshes[1]).el).toBe(meshes[1])
    await t.waitForState((st) => st.cubes[1].selected)
    expect(t.state.cubes.map((c) => c.selected)).toEqual([false, true, false])
    expect(t.state.cubes[1].hitAt).toHaveLength(3)
    await t.settle()
    expect(s.target.objectOf(meshes[1]).scale.x).toBeCloseTo(1.3)
    expect(s.pointer('down', 3, 3)).toBe(null)
    t.dispose()
  })

  it('hover: pointerover / pointerout per item', async () => {
    const { t, s, meshes } = await setup()
    s.pointer('move', ...s.pixelOf(meshes[0]))
    await t.waitForState((st) => st.cubes[0].hover)
    await t.settle()
    expect(s.target.objectOf(meshes[0]).material.color.getHexString()).toBe('ffffff')
    s.pointer('move', ...s.pixelOf(meshes[2]))
    await t.waitForState((st) => !st.cubes[0].hover && st.cubes[2].hover)
    s.pointer('leave', 0, 0)
    await t.waitForState((st) => !st.cubes.some((c) => c.hover))
    t.dispose()
  })

  it('removing an element disposes what the target made', async () => {
    const { t, s, meshes } = await setup()
    const geo = s.target.objectOf(meshes[0]).geometry
    let disposed = 0
    geo.addEventListener('dispose', () => disposed++)
    meshes[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await t.waitForState((st) => st.cubes.length == 2)
    await t.settle()
    expect(disposed).toBe(1)
    expect(s.target.size()).toBe(9)
    t.dispose()
  })

  it('keyboard: Enter on a focused cube clicks it (no point), and the ring follows focus', async () => {
    const { t, meshes } = await setup()
    meshes[2].focus()
    meshes[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await t.waitForState((st) => st.cubes[2].selected)
    expect(t.state.cubes[2].hitAt).toBe(null)
    t.dispose()
  })

  it('the camera is a controlled value: an orbit is not written back, Reset view is', async () => {
    const { t, s } = await setup()
    const cam = s.target.camera()
    near(cam.position.toArray(), HOME.position)
    cam.position.set(4, 2, 3)
    s.orbit().dispatchEvent({ type: 'end' })
    await t.waitForState((st) => st.camera.position[0] == 4)
    await t.settle()
    near(cam.position.toArray(), [4, 2, 3])
    expect(s.cam().st).toEqual({ writes: 0, echoes: 1, reverts: 0 })
    t.simulateEvent('.reset-view', 'click')
    await t.waitForState((st) => st.camera.position[0] == 0)
    await t.settle()
    near(cam.position.toArray(), HOME.position)
    expect(s.cam().st.writes).toBe(1)
    t.dispose()
  })
})

describe('the frame loop', () => {
  it('animate runs per frame with no patch, render or sync; stopping restores the static prop', async () => {
    const counts = { patches: 0, renders: 0 }
    document.body.innerHTML = '<div id="root"></div>'
    const app = run(App, {}, { mountPoint: '#root', __hooks: { onPatch: () => counts.patches++, onRender: () => counts.renders++ } })
    await new Promise((r) => setTimeout(r, 0))
    const s = sceneOf(document.querySelector('.viewport'))
    const obj = s.target.objectOf(document.querySelector('mesh.cube'))
    const still = obj.rotation.toArray().slice(0, 3)
    app.__runtime.setState('root', { ...app.__runtime.getState(), spin: true })
    await new Promise((r) => setTimeout(r, 0))
    expect(s.target.animated.size).toBe(3)
    const before = { ...counts, syncs: s.target.stats.syncs }
    for (let i = 1; i <= 60; i++) s.tick(i * 1000 / 60)
    expect(obj.rotation.y).toBeCloseTo(1)
    expect({ ...counts, syncs: s.target.stats.syncs }).toEqual(before)
    expect(s.target.stats.animatedWrites).toBeGreaterThanOrEqual(180)
    app.__runtime.setState('root', { ...app.__runtime.getState(), spin: false })
    await new Promise((r) => setTimeout(r, 0))
    expect(obj.rotation.toArray().slice(0, 3)).toEqual(still)
    app.dispose()
  })
})

describe('the target alone', () => {
  it('args recreate the object and keep its children; extend adds tags; hit={false} passes through', () => {
    class Marker { constructor() { this.isMarker = true; this.label = '' } }
    extend({ Marker })
    const tgt = createThreeTarget()
    const el = (n) => ({ n })
    const g = el('g'), box = el('box'), a = el('a'), m = el('m')
    const tree = (args, hit) => ({ children: [
      { sel: 'perspectiveCamera', data: { props: { position: [0, 0, 5] } }, elm: el('cam'), children: [] },
      { sel: 'group', data: { props: {} }, elm: g, children: [
        { sel: 'mesh', data: { props: { hit } }, elm: a, children: [{ sel: 'boxGeometry', data: { props: { args } }, elm: box, children: [] }, { sel: 'meshBasicMaterial', data: { props: {} }, elm: el('mat'), children: [] }] },
      ] },
      { sel: 'marker', data: { props: { label: 'x' } }, elm: m, children: [] },
    ] })
    tgt.sync(tree([1, 1, 1], true))
    const first = tgt.objectOf(box)
    expect(tgt.objectOf(a).geometry).toBe(first)
    expect(tgt.objectOf(m)).toMatchObject({ isMarker: true, label: 'x' })
    expect(tgt.pick(0, 0).el).toBe(a)
    tgt.sync(tree([2, 2, 2], false))
    expect(tgt.objectOf(box)).not.toBe(first)
    expect(tgt.objectOf(a).geometry).toBe(tgt.objectOf(box))
    expect(tgt.objectOf(box).parameters.width).toBe(2)
    expect(tgt.pick(0, 0)).toBe(null)
  })
})

describe('createThreeHost: a whole app as a scene on sygnal/host (no DOM)', () => {
  it('raycast clicks drive intents and bubble up the scene graph', async () => {
    let hits = 0
    function Game({ state }) {
      return h('group', { className: 'world', role: 'group', 'aria-label': 'world' },
        h('perspectiveCamera', { makeDefault: true, position: [0, 1.5, 6], lookAt: [0, 0, 0] }),
        h(Collection, { of: Cube, from: 'cubes' }))
    }
    Game.initialState = { cubes: [{ id: 0, x: -1, selected: false, hover: false, hitAt: null }, { id: 1, x: 1, selected: false, hover: false, hitAt: null }] }
    Game.context = { spin: () => false }
    Game.intent = ({ DOM }) => ({ HIT: DOM.click('.world') })
    Game.model = { HIT: (s) => { hits++; return s } }
    const host = createThreeHost({ width: 640, height: 400 })
    const app = run(Game, { DOM: host.driver })
    await new Promise((r) => setTimeout(r, 0))
    const cubes = host.doc.querySelectorAll('mesh.cube')
    expect(host.click(cubes[1]).el).toBe(cubes[1])
    await new Promise((r) => setTimeout(r, 0))
    expect(app.__runtime.getState().cubes[1].selected).toBe(true)
    expect(hits).toBe(1)
    app.dispose()
  })
})
