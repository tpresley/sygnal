/**
 * PLAN-5 W-1: types for defineWidget and `.detail()` (W-3); from spike 0-S1.
 * - the host element type from `tag` ('input' → HTMLInputElement)
 * - the tag form: props from mount's annotation, plus the host props (className, aria-*, ...)
 * - emit() names from `events`
 * - the control form: controls({ Due: DatePicker }) takes the widget's props through `__props`
 * - t.widget(selector | control)
 */
import { controls, defineWidget, renderComponent } from 'sygnal'
import type { Component, Widget } from 'sygnal'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
function expectType<T extends true>(): void {}

interface Picker { open(): void; setDate(d: Date | undefined): void; destroy(): void }
declare function picker(el: HTMLElement, opts: { onChange(d: Date): void }): Picker

const DatePicker = defineWidget({
  tag: 'input',
  mount: (el, props: { value?: Date; min?: Date }, emit) => {
    expectType<Equal<typeof el, HTMLInputElement>>()
    emit('change', new Date())
    // @ts-expect-error: not a declared event
    emit('chnage', 1)
    return picker(el, { onChange: (d) => emit('change', d) })
  },
  update: (fp, props) => { fp.setDate(props.value) },
  unmount: (fp) => fp.destroy(),
  events: ['change'],
  commands: { open: (fp) => fp.open() },
})

expectType<Equal<typeof DatePicker.kind, 'widget'>>()
const w: Widget<{ value?: Date; min?: Date }, Picker, 'change', 'input'> = DatePicker
void w
expectType<Equal<typeof DatePicker, Widget<{ value?: Date; min?: Date }, Picker, 'change', 'input'>>>()

// no tag: a div host; update/unmount/commands get the instance and the element
const Chart = defineWidget({
  name: 'Chart',
  mount: (el, props: { series: number[] }) => {
    expectType<Equal<typeof el, HTMLDivElement>>()
    return { el, series: props.series }
  },
  update: (inst, props, el) => { inst.series = props.series; expectType<Equal<typeof el, HTMLDivElement>>() },
  commands: { refresh: (inst, options) => { void inst.series; void options.animate } },
  fallback: (props, h) => h('span', null, `${props.series.length} points`),
  hostProps: ['title'],
})
const chart = <Chart className="chart" series={[1, 2]} aria-label="Sales" data-kind="bar" id="c" style={{ height: '20px' }} />
// @ts-expect-error series is required
const noSeries = <Chart className="chart" />
// @ts-expect-error a host takes no ref
const withRef = <Chart series={[]} ref={{ current: null }} />
void chart; void noSeries; void withRef

type State = { due?: Date }
const Form: Component<State> = ({ state }) => (
  <label>
    Due <DatePicker className="due" value={state.due} aria-describedby="due-help" />
  </label>
)
// @ts-expect-error: value is a Date
const bad = <DatePicker className="due" value="2026-10-05" />
void bad

Form.intent = ({ DOM }) => ({
  DUE: DOM.select('.due').events('change').detail<Date>(),
  DAY: DOM.select('.due').events('change').detail((d: Date) => d.getDate()),
})

// the control form: props through __props
const { Due } = controls({ Due: DatePicker })
const ok = <Due value={new Date()} className="x" />
// @ts-expect-error: not a prop of the widget or the host
const nope = <Due valu={new Date()} />
void ok; void nope

async function tests() {
  const t = renderComponent(Form)
  await t.ready()
  const p = t.widget<{ value?: Date }>('.due').props.value
  const q: Date | undefined = p
  t.widget(Due).emit('change', new Date())
  const viaControl = t.widget(Due).props.value
  void q; void viaControl
}
void tests
