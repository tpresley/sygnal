/**
 * PLAN-5 2-Z: types for the adapter entries: fromZag (sygnal/zag), Menu / Select / Combobox
 * (sygnal/ui/zag), fromReact (sygnal/react). Their results are widget tags (Widget), so they
 * render as JSX tags with their props plus the host props, and work as controls.
 */
import { controls } from 'sygnal'
import type { Widget } from 'sygnal'
import { fromZag, zagProps } from 'sygnal/zag'
import type { ZagInstance, ZagElementProps } from 'sygnal/zag'
import { Menu, Select, Combobox } from 'sygnal/ui/zag'
import { fromReact } from 'sygnal/react'
import type { ReactInstance } from 'sygnal/react'
import * as menu from '@zag-js/menu'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
function expectType<T extends true>(): void {}

// ── fromZag ──────────────────────────────────────────────────────────────────────────────────
const Actions = fromZag<{ label: string; items: string[] }>(menu, (api, props) => (
  <div>
    <button {...api.getTriggerProps()}>{props.label}</button>
    <div {...api.getPositionerProps()}>
      <ul {...api.getContentProps()}>{props.items.map((i) => <li {...api.getItemProps({ value: i })}>{i}</li>)}</ul>
    </div>
  </div>
), {
  events: { select: ['onSelect', (d) => d.value], 'open-change': 'onOpenChange', typed: null },
  commands: { open: (api, _o, x) => { x.el.focus(); api.setOpen(true) } },
  props: (p, x) => { x.items = p.items; return { loopFocus: true } },
})
expectType<Equal<typeof Actions, Widget<{ label: string; items: string[] }, ZagInstance>>>()
const a1 = <Actions className="actions" label="Edit" items={['cut']} aria-label="Edit menu" />
// @ts-expect-error: label is a string
const a2 = <Actions className="actions" label={1} items={[]} />
void a1; void a2

const data: ZagElementProps = zagProps({ onClick: () => {}, 'aria-expanded': false })
void data
// @ts-expect-error: not a render function
fromZag(menu, 'x')

// ── Menu / Select / Combobox ─────────────────────────────────────────────────────────────────
const m = <Menu className="actions" label="Actions" items={['edit', { value: 'del', label: 'Delete', disabled: true }, { separator: true }]} />
const s = <Select className="size" label="Size" items={['S', 'M']} value={null} placeholder="Pick" name="size" />
const sm = <Select className="tags" label="Tags" items={['a']} multiple value={['a']} />
const c = <Combobox className="city" label="City" items={['Paris']} filter={(item, text) => item.label.startsWith(text)} />
const c2 = <Combobox className="city" label="City" items={['Paris']} filter={false} inputBehavior="autohighlight" />
// @ts-expect-error: items are required
const bad = <Select className="size" label="Size" />
// @ts-expect-error: not an inputBehavior
const bad2 = <Combobox className="c" items={[]} inputBehavior="nope" />
void m; void s; void sm; void c; void c2; void bad; void bad2
expectType<Equal<typeof Menu, Widget<import('sygnal/ui/zag').MenuProps, ZagInstance, 'select' | 'open-change'>>>()
const { Size } = controls({ Size: Select })
void Size

// ── fromReact ────────────────────────────────────────────────────────────────────────────────
declare function StarRating(props: { value: number; onChange(v: number): void }): any
const Stars = fromReact<{ value: number }>(StarRating, { events: { rate: 'onChange' }, commands: { reset: (i) => { i.root.render(null) } } })
expectType<Equal<typeof Stars, Widget<{ value: number }, ReactInstance>>>()
const st = <Stars className="rating" value={3} />
// @ts-expect-error: value is a number
const st2 = <Stars className="rating" value="3" />
fromReact(StarRating, { events: ['onChange'] })
void st; void st2
