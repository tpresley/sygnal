// @vitest-environment jsdom
/**
 * The whole editor in jsdom: the Canvas runs headless (no 2D context: no pixels, but the display
 * list, hit testing and the pointer router are the same), driven by raw pointer input at canvas
 * pixels through `canvasOf(el).pointer(kind, x, y, init)`, as a real pointer would be.
 */
import {describe, it, expect} from 'vitest'
import {renderComponent} from 'sygnal'
import {App as Built} from '../app/App'
import {App as Proposed} from '../app-proposed/App'
import {initialState} from '../app/model'
import {make} from '../app/doc'
import {canvasOf} from '../lib/canvas'

const doc = () => [
  make('frame', 'f1', 1, {x: 0, y: 0, width: 400, height: 300}),
  make('rect', 'r1', 1, {x: 20, y: 20, width: 100, height: 80}, 'f1'),
  make('ellipse', 'e1', 1, {x: 500, y: 40, width: 100, height: 100}),
  make('text', 't1', 1, {x: 500, y: 200, text: 'Hi', fontSize: 20}),
]

let App: any = Built
async function open(shapes = doc()) {
  const t = renderComponent(App, {dom: 'real', initialState: initialState(shapes)})
  await t.ready()
  const c = canvasOf(t.container.querySelector('.board'))
  const p = async (kind: string, x: number, y: number, init: any = {}) => { c.pointer(kind, x, y, {pointerId: 1, ...init}); await t.settle() }
  const drag = async (from: number[], to: number[], init: any = {}, steps = 4) => {
    await p('move', from[0], from[1], init); await p('down', from[0], from[1], init)
    for (let i = 1; i <= steps; i++) await p('move', from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps, init)
    await p('up', to[0], to[1], init)
  }
  const key = async (key: string, init: any = {}) => { t.container.ownerDocument.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true, ...init})); await t.settle() }
  const shape = (id: string) => t.state.shapes.find((s: any) => s.id === id)
  return {t, c, p, drag, key, shape}
}

// the same suite for the version built (app/) and the rewrite on the proposed API (app-proposed/)
for (const [label, Impl] of [['built', Built], ['proposed API', Proposed]] as const) describe(`Figma-lite in jsdom (headless canvas): ${label}`, () => {
  it('mounts', () => { App = Impl })
  it('click selects, shift-click adds, a press on the background clears; handles become JSX nodes', async () => {
    const {t, c, p} = await open()
    await p('down', 50, 50); await p('up', 50, 50)
    expect(t.state.selection).toEqual(['r1'])
    // 8 resize handles + the rotate handle, painted from JSX nodes in screen space
    expect(t.container.querySelectorAll('.handle').length).toBe(9)
    expect(c.live.filter((l: any) => l.screen).length).toBeGreaterThan(9)
    await p('down', 550, 90, {shiftKey: true}); await p('up', 550, 90, {shiftKey: true})
    expect(t.state.selection).toEqual(['r1', 'e1'])
    await p('down', 700, 500); await p('up', 700, 500)
    expect(t.state.selection).toEqual([])
    t.dispose()
  })

  it('drag moves with snapping guides, one undo step for the whole drag', async () => {
    const {t, drag, key, shape} = await open()
    // r1's left edge (20) dragged by 478 lands at 498, 2 px from e1's left edge (500): snapped
    await drag([50, 50], [528, 52])
    expect(shape('r1').x).toBe(500)
    // dropped outside the frame: it left the frame
    expect(shape('r1').parent).toBe(null)
    expect(t.state.guides).toEqual([])
    expect(t.state.past.length).toBe(1)
    await key('z', {metaKey: true})
    expect(shape('r1')).toMatchObject({x: 20, y: 20, parent: 'f1'})
    await key('z', {metaKey: true, shiftKey: true})
    expect(shape('r1').x).toBe(500)
    t.dispose()
  })

  it('a frame moves its children; marquee selects what it touches', async () => {
    const {t, p, drag, shape} = await open()
    // the frame's own area (not on r1)
    await drag([300, 250], [350, 260])
    expect(t.state.selection).toEqual(['f1'])
    expect(shape('f1')).toMatchObject({x: 50, y: 10})
    expect(shape('r1')).toMatchObject({x: 70, y: 30})
    await p('down', 470, 20); await p('move', 560, 160); await p('move', 620, 170)
    expect(t.state.selection).toEqual(['e1'])
    expect(t.container.querySelector('.marquee')).not.toBe(null)
    await p('up', 620, 170)
    t.dispose()
  })

  it('resize from a corner (shift keeps the aspect ratio) and rotate', async () => {
    const {t, p, drag, shape} = await open()
    await p('down', 50, 50); await p('up', 50, 50)
    // the se handle of r1 at (120, 100)
    await drag([120, 100], [220, 120], {shiftKey: true})
    expect(shape('r1')).toMatchObject({x: 20, y: 20, width: 200, height: 160})
    // the rotate handle: 24 px above the top centre (120, 20)
    await drag([120, -4], [400, 100], {shiftKey: true})
    expect(shape('r1').rotation % 15).toBe(0)
    expect(shape('r1').rotation).toBeGreaterThan(0)
    t.dispose()
  })

  it('tools: R draws a rectangle inside the frame it starts in, then the tool is Move again', async () => {
    const {t, drag, key} = await open()
    await key('r')
    expect(t.state.tool).toBe('rect')
    await drag([200, 150], [260, 200])
    const s = t.state.shapes.find((x: any) => x.name == 'Rectangle 2')
    expect(s).toMatchObject({x: 200, y: 150, width: 60, height: 50, parent: 'f1'})
    expect(t.state.tool).toBe('select')
    expect(t.state.selection).toEqual([s.id])
    t.dispose()
  })

  it('text: double-click edits in a textarea; the box follows the text', async () => {
    const {t, p, shape} = await open()
    const w0 = shape('t1').width
    await p('dblclick', 505, 210)
    expect(t.state.editing).toBe('t1')
    const ta = t.container.querySelector('.text-edit') as HTMLTextAreaElement
    expect(ta.value).toBe('Hi')
    ta.value = 'Hello there'
    ta.dispatchEvent(new Event('input', {bubbles: true}))
    await t.settle()
    expect(shape('t1').text).toBe('Hello there')
    expect(shape('t1').width).toBeGreaterThan(w0)
    ta.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}))
    await t.settle()
    expect(t.state.editing).toBe(null)
    expect(t.state.past.length).toBe(1)
    t.dispose()
  })

  it('keyboard: copy, paste, duplicate, nudge, delete', async () => {
    const {t, p, key} = await open()
    await p('down', 550, 90); await p('up', 550, 90)
    await key('c', {metaKey: true}); await key('v', {metaKey: true})
    expect(t.state.shapes.length).toBe(5)
    const pasted = t.state.selection[0]
    expect(t.state.shapes.find((s: any) => s.id === pasted)).toMatchObject({x: 510, y: 50, type: 'ellipse'})
    await key('d', {metaKey: true})
    expect(t.state.shapes.length).toBe(6)
    await key('ArrowRight', {shiftKey: true})
    expect(t.state.shapes.find((s: any) => s.id === t.state.selection[0]).x).toBe(530)
    await key('Backspace')
    expect(t.state.shapes.length).toBe(5)
    // the frame and its child are copied together
    await p('down', 300, 250); await p('up', 300, 250)
    await key('d', {metaKey: true})
    expect(t.state.shapes.length).toBe(7)
    t.dispose()
  })

  it('layers panel: rows in stack order, select, hide, lock, rename; properties two-way', async () => {
    const {t} = await open()
    const names = () => [...t.container.querySelectorAll('.layer .name')].map(e => e.textContent)
    expect(names()).toEqual(['Text 1', 'Ellipse 1', 'Frame 1', 'Rectangle 1'])
    ;(t.container.querySelector('[data-id="e1"] .name') as HTMLElement).click()
    await t.settle()
    expect(t.state.selection).toEqual(['e1'])
    const x = t.container.querySelector('.prop[data-key="x"]') as HTMLInputElement
    expect(x.value).toBe('500')
    x.value = '320'
    x.dispatchEvent(new Event('change', {bubbles: true}))
    await t.settle()
    expect(t.state.shapes.find((s: any) => s.id == 'e1').x).toBe(320)
    ;(t.container.querySelector('[data-id="e1"] .eye') as HTMLElement).click()
    await t.settle()
    expect(t.state.shapes.find((s: any) => s.id == 'e1').hidden).toBe(true)
    ;(t.container.querySelector('[data-id="r1"] .lock') as HTMLElement).click()
    await t.settle()
    expect(t.state.shapes.find((s: any) => s.id == 'r1').locked).toBe(true)
    const name = t.container.querySelector('[data-id="t1"] .name') as HTMLElement
    name.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))
    await t.settle()
    const input = t.container.querySelector('.rename') as HTMLInputElement
    input.value = 'Title'
    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}))
    await t.settle()
    expect(names()[0]).toBe('Title')
    t.dispose()
  })

  it('layers panel: drag a row into a frame', async () => {
    const {t, shape} = await open()
    const row = (id: string) => t.container.querySelector(`[data-id="${id}"]`) as HTMLElement
    row('e1').dispatchEvent(new Event('dragstart', {bubbles: true}))
    await t.settle()
    // jsdom has no layout: a drag over a row reads as "after" (below it); over the frame row → inside f1, below r1's position
    row('r1').dispatchEvent(new Event('dragover', {bubbles: true, cancelable: true}))
    await t.settle()
    row('r1').dispatchEvent(new Event('drop', {bubbles: true, cancelable: true}))
    await t.settle()
    expect(shape('e1').parent).toBe('f1')
    expect(t.state.shapes.map((s: any) => s.id)).toEqual(['f1', 'e1', 'r1', 't1'])
    t.dispose()
  })

  it('export: the page and the selection as SVG, frames clip their children', async () => {
    const {t, p} = await open()
    ;(t.container.querySelector('.toolbar .export') as HTMLElement).click()
    await t.settle()
    const svg = (globalThis as any).__lastExport as string
    expect(svg).toMatch(/^<svg xmlns/)
    expect(svg).toContain('<clipPath id="clip-f1">')
    expect(svg).toContain('<ellipse')
    expect(svg).toContain('>Hi</tspan>')
    await p('down', 550, 90); await p('up', 550, 90)
    ;(t.container.querySelector('.props .export') as HTMLElement).click()
    await t.settle()
    expect((globalThis as any).__lastExport).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="500 40 100 100"><ellipse cx="550" cy="90" rx="50" ry="50" fill="#d9d9d9"/></svg>')
    t.dispose()
  })

  it('stress: 10k shapes load; a drag through the action queue changes only the moved shapes', async () => {
    const {t, c, drag} = await open()
    ;(t.container.querySelectorAll('.stress')[2] as HTMLElement).click()
    await t.settle()
    expect(t.state.shapes.length).toBe(10000)
    // the layers panel renders a window, not 10k rows
    expect(t.container.querySelectorAll('.layer').length).toBeLessThan(40)
    const before = t.state.shapes
    // shape s0 at world (0, 0)–(40, 40): its screen point under the fitted camera
    const cam = t.state.camera, sx = (20 - cam.x) * cam.zoom, sy = (20 - cam.y) * cam.zoom
    await drag([sx, sy], [sx + 30, sy + 30])
    expect(t.state.selection).toEqual(['s0'])
    const after = t.state.shapes
    expect(after.filter((s: any, i: number) => s !== before[i]).map((s: any) => s.id)).toEqual(['s0'])
    expect(c.layers[0].items).toBe(after)
    t.dispose()
  })
})

describe('one Collection item per shape (?render=collection)', () => {
  it('the same editor: shapes are elements with their own intents, hits target them', async () => {
    const s = {...initialState(doc()), render: 'collection' as const}
    const t = renderComponent(Built, {dom: 'real', initialState: s})
    await t.ready()
    const c = canvasOf(t.container.querySelector('.board'))
    expect(t.container.querySelectorAll('.shape').length).toBe(4)
    c.pointer('move', 550, 90, {pointerId: 1}); await t.settle()
    // the hit is the ellipse's own element (event.hit is its id; ShapeNode's pointerover intent reports it too)
    expect(t.state.hover).toBe('e1')
    expect(t.state.shapes.length).toBe(4)
    c.pointer('down', 550, 90, {pointerId: 1}); c.pointer('move', 600, 90, {pointerId: 1}); c.pointer('move', 650, 90, {pointerId: 1}); c.pointer('up', 650, 90, {pointerId: 1})
    await t.settle()
    expect(t.state.selection).toEqual(['e1'])
    expect(t.state.shapes.find((x: any) => x.id == 'e1').x).toBe(600)
    t.dispose()
  })
})

describe('pointer capture (lib/canvas/router.ts, as sygnal/three defines it)', () => {
  it('captured moves carry captured + delta; a drag sends no click; explicit mode captures on request', async () => {
    const {Canvas: C} = await import('../lib/canvas')
    const seen: any[] = []
    function Probe() {
      return <C className="pc" capture="explicit"><shapes className="doc" items={[{id: 'a', type: 'rect', x: 0, y: 0, width: 50, height: 50}]} /><rect className="grab" capture x={100} y={0} width={50} height={50} /></C>
    }
    Probe.intent = ({DOM}: any) => ({EV: DOM.select('.pc').events('pointermove').map((e: any) => ['move', e.target.getAttribute?.('class'), !!e.captured, e.delta?.x]),
      CL: DOM.select('.pc').events('click').map((e: any) => ['click', e.target.getAttribute?.('class')])})
    Probe.initialState = {}
    Probe.model = {EV: (s: any, d: any) => (seen.push(d), s), CL: (s: any, d: any) => (seen.push(d), s)}
    const t = renderComponent(Probe, {dom: 'real'})
    await t.ready()
    const c = canvasOf(t.container.querySelector('.pc'))
    // explicit mode: the data layer isn't captured (moves follow the pointer to the background)
    c.pointer('down', 10, 10); c.pointer('move', 200, 200); c.pointer('up', 200, 200)
    // the element with `capture` is: its moves stay on it, with deltas; no click after a 30 px drag
    c.pointer('down', 110, 10); c.pointer('move', 140, 10); c.pointer('up', 140, 10)
    // a press without a drag clicks
    c.pointer('down', 110, 10); c.pointer('up', 111, 10)
    await t.settle()
    expect(seen).toEqual([['move', null, false, undefined], ['move', 'grab', true, 30], ['click', 'grab']])
    t.dispose()
  })
})
