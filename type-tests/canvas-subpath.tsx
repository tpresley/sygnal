/** sygnal/canvas: the Canvas widget's props and events, <shapes>, the kit, keymap on the main entry */
import { ABORT, keymap as mainKeymap, xs } from 'sygnal'
import type { Component } from 'sygnal'
import {
  Canvas, canvasOf, canvas2d, pointer, keymap, history, handles, selectionBox, resize, rotation, turn, scaleInto,
  gesture, snap, snapTargets, fit, union, zoomAt, toScreen, toWorld, exportSVG, CAMERA, aabb, positionsOf,
} from 'sygnal/canvas'
import type { Camera, Node, Pointer, Gesture, Box, CanvasEventFields, History } from 'sygnal/canvas'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
function expectType<T extends true>(): void {}

type Shape = Node & { id: string; x: number; y: number; width: number; height: number }
type S = { shapes: Shape[]; selection: string[]; camera: Camera; past: Shape[][]; future: Shape[][]; gesture: Gesture<{ before: Shape[] }> | null }

const h: History<S> = history<S>('shapes', { after: (s) => ({ ...s, selection: [] }) })
// @ts-expect-error: not a field of S
history<S>('nope')

const App: Component<S> = ({ state }) => {
  const box = selectionBox(state.shapes, state.selection)
  return (
    <Canvas className="board" camera={state.camera} grid repaint="layers" capture="all" backend={canvas2d()} follow={null}>
      <shapes className="doc" items={state.shapes} active={state.gesture ? state.selection : null} aria-label="Document" />
      <shapes className="sel" items={state.shapes.filter((x) => state.selection.includes(x.id))} outline="#0d99ff" a11y={0} />
      <ellipse className="pin" x={10} y={10} width={12} height={12} fill="#f24822" />
      {box ? handles(box, state.camera, { grips: true }) : null}
    </Canvas>
  )
}
// @ts-expect-error: a <shapes> layer needs items
const bad = <shapes className="doc" />

App.intent = ({ DOM }) => ({
  ...keymap(DOM, { 'mod+z': 'UNDO', 'shift+mod+z': 'REDO', left: ['NUDGE', { dx: -1 }] }),
  DOWN: DOM.select('.board').events('pointerdown').map(pointer),
  CAMERA: DOM.select('.board').events('camerachange').detail(),
})
App.model = {
  DOWN: (s, p) => {
    const q: Pointer = p as Pointer
    return q.hit ? { ...s, selection: [String(p.hit)], gesture: gesture.start('move', p, { before: s.shapes }) } : ABORT
  },
  UNDO: h.undo,
  REDO: h.redo,
  CAMERA: (s, camera) => ({ ...s, camera: camera as Camera }),
}

// keymap is the main entry's: the stream names come from the table
const keys = mainKeymap({ select: (_: string) => null as any }, { 'mod+c': 'COPY', delete: 'DELETE', v: ['TOOL', 'select'] })
expectType<Equal<keyof typeof keys, 'COPY' | 'DELETE' | 'TOOL'>>()
xs.merge(keys.COPY, keys.DELETE)

// the kit
const b: Box = resize({ x: 0, y: 0, width: 10, height: 10 }, 'se', { x: 20, y: 20 }, true)
const deg: number = rotation(b, { x: 0, y: 0 }, { x: 1, y: 1 }, 15)
const t: Box = turn(b, { x: 0, y: 0 }, deg)
scaleInto(t, b, b)
const cam: Camera = fit(union([b]), 800, 600, 40, 1)
zoomAt(cam, 2, 400, 300)
toWorld(CAMERA, 1, 2).x satisfies number
toScreen(cam, 1, 2).y satisfies number
const { dx, guides } = snap(aabb(b), 1, 2, snapTargets([aabb(b)]), 6)
expectType<Equal<typeof dx, number>>()
guides[0]?.x1 satisfies number | undefined
const svg: string = exportSVG([{ id: 'a', type: 'rect', x: 0, y: 0, width: 1, height: 1 }])
const c = canvasOf(document.body)
c?.pointer('down', 1, 2, { pointerId: 1 })
const f: Partial<CanvasEventFields> = { hit: 'a', world: { x: 0, y: 0 } }
const pos = positionsOf([{ id: 'a' }], [{ id: 'a' }])
expectType<Equal<typeof pos, Map<any, number>>>()
void [bad, svg, f]
