// @vitest-environment jsdom
// jsdom has no WebGL: the Scene runs headless, and the raycaster is plain math, so the tests click
// through the real input path (sceneOf(el).click(mesh): pointer down + up where the cube is drawn)
import { describe, it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { sceneOf } from 'sygnal/three'
import Cubes from './Cubes.jsx'

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
    expect(cubes().map((el) => scene.target.objectOf(el).position.x)).toEqual([-1.8, 0, 1.8])
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
