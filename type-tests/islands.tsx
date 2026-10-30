/**
 * canvas-three: widgets with children (islands), the controlled `value` (experimental), `tags`,
 * and the browser static's `frame` kind.
 */
import { defineWidget, frameSource, makeBrowserDriverWith, renderComponent } from 'sygnal'
import type { BrowserFrame, BrowserSpec, Component, VNode } from 'sygnal'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
function expectType<T extends true>(): void {}

type Painter = { items: number; ring: Element | null }

const Scene = defineWidget({
  name: 'Scene',
  children: true,
  tags: ['line'],
  mount: (el, props: { width: number }) => ({ items: props.width, ring: null } as Painter),
  sync: (inst, children, el) => {
    expectType<Equal<typeof inst, Painter>>()
    expectType<Equal<typeof children, VNode>>()
    expectType<Equal<typeof el, HTMLDivElement>>()
    inst.items = children.children?.length ?? 0
  },
  focus: (inst, child) => { inst.ring = child },
})
const scene = <Scene className="scene" width={300}><mesh /></Scene>

const Hidden = defineWidget({ children: 'hidden', mount: () => 0 })
// @ts-expect-error children is true | 'hidden'
defineWidget({ children: 'visible', mount: () => 0 })

type Doc = { text: string }
const Editor = defineWidget({
  tag: 'section',
  events: ['change'],
  mount: (el, props: { value: string; strict?: boolean }, dispatch): Doc => {
    dispatch('change', props.value)
    return { text: props.value }
  },
  // (after mount: the instance type is inferred from it, left to right)
  value: {
    write: (doc, v: string, el) => { doc.text = v; expectType<Equal<typeof el, HTMLElement>>() },
    read: (doc) => doc.text,
    equals: (a, b) => a === b,
    event: 'change',
    strict: true,
  },
})
const editor = <Editor className="code" value="hi" strict />

defineWidget({
  events: ['moved'],
  // @ts-expect-error the value event is one of the declared events
  value: { write: () => {}, event: 'nope' },
  mount: () => 0,
})

// the frame kind
const tick: BrowserSpec<'TICK'> = { frame: true, every: 2, action: 'TICK' }
// @ts-expect-error frame is `true`
const bad: BrowserSpec<'TICK'> = { frame: 2, action: 'TICK' }
const driver = makeBrowserDriverWith(frameSource)

type S = { t: number }
const Clock: Component<S> = ({ state }) => <p>{state.t}</p>
Clock.browser = (s) => ({ tick: s.t < 10 && { frame: true, action: 'TICK' } })
Clock.model = { TICK: (s, f: BrowserFrame) => ({ t: s.t + f.dt }) }

async function t() {
  const r = renderComponent(Clock, { initialState: { t: 0 } })
  await r.browser.frame(3, 16)
  await r.browser.frame()
}

export { scene, Hidden, editor, tick, bad, driver, t }
