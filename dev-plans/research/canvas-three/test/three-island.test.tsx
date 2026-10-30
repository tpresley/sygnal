// @vitest-environment jsdom
import {describe, it, expect} from 'vitest'
import {renderComponent} from 'sygnal'
import {CubesApp} from '../app/Cubes'
import {islandOf} from '../lib/island'

const scene = (t: any) => islandOf(t.container.querySelector('.viewport'))
const meshes = (t: any) => [...t.container.querySelectorAll('mesh.cube')]

describe('a three.js scene inside a DOM app (jsdom, no WebGL)', () => {
  it('builds the scene graph from the island children', async () => {
    const t = renderComponent(CubesApp, {dom: 'real'})
    await t.ready()
    const s = scene(t)
    expect(s.headless).toBe(true)
    const tgt = s.target
    // 2 lights + camera + group + 3 × (mesh, geometry, material)
    expect(tgt.size()).toBe(13)
    const m = tgt.objectOf(meshes(t)[0])
    expect(m.type).toBe('Mesh')
    expect(m.geometry.type).toBe('BoxGeometry')
    expect(m.material.type).toBe('MeshStandardMaterial')
    expect(m.position.toArray()).toEqual([-1.8, 0, 0])
    expect(m.parent.type).toBe('Group')
    expect(tgt.camera().type).toBe('PerspectiveCamera')
    expect(tgt.camera().aspect).toBeCloseTo(640 / 400)
    t.dispose()
  })

  it('a click in the canvas is a raycast that reaches the cube\'s own intent', async () => {
    const t = renderComponent(CubesApp, {dom: 'real'})
    await t.ready()
    const s = scene(t), [, second] = meshes(t)
    const hit = s.click(second)
    expect(hit.el).toBe(second)
    await t.waitForState((st: any) => st.cubes[1].selected)
    expect(t.state.cubes.map((c: any) => c.selected)).toEqual([false, true, false])
    // the intersection travels on the event: a point on the cube's surface
    expect(t.state.cubes[1].hitAt).toHaveLength(3)
    await t.settle()
    expect(t.container.querySelector('.status').textContent).toBe('1 of 3 selected')
    // the model's scale reached the object
    expect(s.target.objectOf(second).scale.x).toBeCloseTo(1.3)
    // a click on empty space hits nothing
    expect(s.pointer('down', 5, 5)).toBe(null)
    t.dispose()
  })

  it('hover: pointerover / pointerout from raycasts, per item', async () => {
    const t = renderComponent(CubesApp, {dom: 'real'})
    await t.ready()
    const s = scene(t), [first, second] = meshes(t)
    const [x, y] = s.pixelOf(first)
    s.pointer('move', x, y)
    await t.waitForState((st: any) => st.cubes[0].hover)
    await t.settle()
    expect(s.target.objectOf(first).material.color.getHexString()).toBe('ffffff')
    const [x2, y2] = s.pixelOf(second)
    s.pointer('move', x2, y2)
    await t.waitForState((st: any) => !st.cubes[0].hover && st.cubes[1].hover)
    s.pointer('leave', 0, 0)
    await t.waitForState((st: any) => !st.cubes.some((c: any) => c.hover))
    t.dispose()
  })

  it('removal disposes what the target made; adding creates', async () => {
    const t = renderComponent(CubesApp, {dom: 'real'})
    await t.ready()
    const s = scene(t), tgt = s.target, [first] = meshes(t)
    const geo = tgt.objectOf(first).geometry
    let disposed = 0
    geo.addEventListener('dispose', () => disposed++)
    first.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))
    await t.waitForState((st: any) => st.cubes.length == 2)
    await t.settle()
    expect(disposed).toBe(1)
    expect(tgt.size()).toBe(10)
    t.simulateEvent('.add', 'click')
    await t.waitForState((st: any) => st.cubes.length == 3)
    await t.settle()
    expect(tgt.size()).toBe(13)
    expect(meshes(t).map(m => tgt.objectOf(m).position.x)).toEqual([-1.8, 0, 1.8])
    t.dispose()
  })
})

describe('the same component under the mock DOM (no target at all)', () => {
  it('intent and model, by selector', async () => {
    const t = renderComponent(CubesApp)
    await t.ready()
    t.simulateEvent('.cube', 'click', {point: [0, 0.5, 0.5]})
    await t.waitForState((st: any) => st.cubes[0].selected)
    expect(t.state.cubes[0].hitAt).toEqual([0, 0.5, 0.5])
  })
})
