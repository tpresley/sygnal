// @vitest-environment jsdom
// jsdom has no WebGL: the Scene runs headless, and the raycaster is plain math, so the tests click
// through the real input path (sceneOf(el).click(mesh): pointer down + up where the cube is drawn)
// The trees are public/models/tree.glb through three's GLTFLoader: fetch reads the file
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { renderComponent } from 'sygnal'
import { sceneOf } from 'sygnal/three'
import Cubes from './Cubes.jsx'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '../public')
const realFetch = globalThis.fetch
beforeAll(() => {
  // Node's fetch takes absolute URLs: the app's '/models/tree.glb' as the dev server would serve it
  THREE.DefaultLoadingManager.setURLModifier((url) => new URL(url, 'http://localhost/').href)
  globalThis.fetch = async (req) => {
    const { pathname } = new URL(req.url ?? req)
    return new Response(readFileSync(join(PUBLIC, pathname)))
  }
})
afterAll(() => {
  globalThis.fetch = realFetch
  THREE.DefaultLoadingManager.setURLModifier(undefined)
})

const setup = async () => {
  const t = renderComponent(Cubes, { dom: 'real' })
  await t.ready()
  return { t, scene: sceneOf(t.container.querySelector('.viewport')), cubes: () => [...t.container.querySelectorAll('mesh.cube')] }
}

describe('Cubes', () => {
  it('a click in the canvas selects the cube under it', async () => {
    const { t, scene, cubes } = await setup()
    scene.click(cubes()[2])
    await t.waitForState((s) => s.cubes[2].selected)
    await t.settle()
    expect(t.container.querySelector('.status').textContent).toBe('1 of 3 selected')
    expect(t.container.querySelector('.hit').textContent).toMatch(/^hit at /)
    expect(scene.target.objectOf(cubes()[2]).scale.x).toBeCloseTo(1.3)
    t.dispose()
  })

  it('hover, double-click to remove, add', async () => {
    const { t, scene, cubes } = await setup()
    scene.pointer('move', ...scene.pixelOf(cubes()[0]))
    await t.waitForState((s) => s.cubes[0].hover)
    cubes()[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await t.waitForState((s) => s.cubes.length == 2)
    t.simulateEvent('.add', 'click')
    await t.waitForState((s) => s.cubes.length == 3)
    await t.settle()
    // the new cube in the front row; the others stay where they were
    expect(cubes().map((el) => scene.target.objectOf(el).position.toArray())).toEqual([[0, 0, 0], [1.8, 0, 0], [1.2, 0, 2]])
    t.dispose()
  })

  it('a drag moves a cube along the floor, past its own edge, and selects nothing', async () => {
    const { t, scene, cubes } = await setup()
    const [x, y] = scene.pixelOf(cubes()[0])
    // 150 px left and 40 px down: off the cube after a few steps; the pointer stays captured
    scene.drag(cubes()[0], [x - 150, y + 40], { steps: 8 })
    await t.waitForState((s) => !s.cubes[0].from)
    await t.settle()
    const cube = t.state.cubes[0]
    expect(cube.x).toBeLessThan(-3)
    expect(cube.z).toBeGreaterThan(0.3)
    expect(cube.selected).toBe(false)
    expect(scene.target.objectOf(cubes()[0]).position.toArray()).toEqual([cube.x, 0, cube.z])
    expect(t.container.querySelector('.list li').textContent).toBe(`cube 0 at ${cube.x}, ${cube.z}`)
    t.dispose()
  })

  it('the trees: the loaded GLTF, one clone per tree, after a wireframe fallback in the scene', async () => {
    const { t, scene } = await setup()
    const trees = () => [...t.container.querySelectorAll('primitive.tree')]
    // the first test may have loaded it already (the cache is per page): either way it arrives
    await t.waitForState(() => trees().length == 3, 3000)
    const objs = trees().map((el) => scene.target.objectOf(el))
    expect(objs.map((o) => o.name)).toEqual(['Scene', 'Scene', 'Scene'].map(() => objs[0].name))
    const names = []
    objs[0].traverse((o) => names.push(o.name))
    expect(names).toEqual(expect.arrayContaining(['trunk', 'leaves']))
    expect(objs[0]).not.toBe(objs[1])
    expect(objs[2].position.toArray()).toEqual([-2.6, -0.5, 1.8])
    expect(t.container.querySelector('[data-sygnal-suspense="pending"]')).toBe(null)
    t.dispose()
  })

  it('the keyboard: Tab-focusable cubes, Enter selects', async () => {
    const { t, cubes } = await setup()
    cubes()[1].focus()
    cubes()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await t.waitForState((s) => s.cubes[1].selected)
    expect(t.state.cubes[1].hitAt).toBe(null)
    t.dispose()
  })

  it('the intents and models alone, without a scene (the mock DOM)', async () => {
    const t = renderComponent(Cubes)
    await t.ready()
    t.simulateEvent('.cube', 'click', { point: [0, 0.5, 0.5] })
    await t.waitForState((s) => s.cubes[0].selected)
    expect(t.state.cubes[0].hitAt).toEqual([0, 0.5, 0.5])
  })
})
