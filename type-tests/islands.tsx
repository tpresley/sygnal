/**
 * canvas-three: widgets with children (islands), the controlled `value` (experimental) and `tags`

 */
import { defineWidget } from 'sygnal'
import type { VNode } from 'sygnal'

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

export { scene, Hidden, editor }
