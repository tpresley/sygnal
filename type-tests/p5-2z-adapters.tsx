/**
 * PLAN-5 2-Z: types for the adapter entries: fromZag (sygnal/zag), Menu / Select / Combobox
 * (sygnal/ui/menu, sygnal/ui/select, sygnal/ui/combobox), fromReact (sygnal/react). Their results are widget tags (Widget), so they
 * render as JSX tags with their props plus the host props, and work as controls.
 */
import { controls, defineWidget } from 'sygnal'
import type { Widget } from 'sygnal'
import { fromZag, zagProps } from 'sygnal/zag'
import type { ZagInstance, ZagElementProps } from 'sygnal/zag'
import { Menu } from 'sygnal/ui/menu'
import { Select } from 'sygnal/ui/select'
import { Combobox } from 'sygnal/ui/combobox'
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
// UI sweep (dev-plans/research/ui-sweep/zag.md): an icon trigger named by aria-label, no label
const mi = <Menu className="more" aria-label="More" items={['edit']} />
// UI sweep round 2: Menu item kinds, groups, chips, empty, fixed positioning
const mk = <Menu className="view" label="View" items={[{ type: 'checkbox', value: 'grid', label: 'Grid', checked: true }, { type: 'radio', value: 's', checked: false }, { href: '/help', value: 'help' }, { value: 'share', label: 'Share', items: ['mail', { value: 'link', label: 'Copy link' }] }]} />
const sg = <Select className="food" label="Food" items={[{ group: 'Fruit', items: ['Apple'] }, 'Bread']} positioning={{ strategy: 'absolute' }} />
const cc = <Combobox className="tags" label="Tags" items={['a']} multiple chips removeLabel={(l) => `Remove ${l}`} empty="No results" />
// round 3: the chips' announcement and description
const cr = <Combobox className="tags" label="Tags" items={['a']} multiple removedMessage={(l) => `${l} entfernt`} removeHint={false} />
const cl = <Combobox className="city" label="City" items={[]} value="par" allowCustomValue loading />
// @ts-expect-error loading is a boolean
const cl2 = <Combobox className="city" label="City" items={[]} loading="yes" />
// @ts-expect-error a string removedMessage (a function or false)
const cs = <Combobox className="tags" label="Tags" items={['a']} multiple removedMessage="removed" />
// @ts-expect-error: not a strategy
const bad3 = <Select className="s" items={['a']} positioning={{ strategy: 'sticky' }} />
void mk; void sg; void cc; void cr; void cs; void bad3; void cl; void cl2
const sm = <Select className="tags" label="Tags" items={['a']} multiple value={['a']} />
const c = <Combobox className="city" label="City" items={['Paris']} filter={(item, text) => item.label.startsWith(text)} />
const c2 = <Combobox className="city" label="City" items={['Paris']} filter={false} inputBehavior="autohighlight" />
// @ts-expect-error: items are required
const bad = <Select className="size" label="Size" />
// @ts-expect-error: not an inputBehavior
const bad2 = <Combobox className="c" items={[]} inputBehavior="nope" />
void m; void mi; void s; void sm; void c; void c2; void bad; void bad2
expectType<Equal<typeof Menu, Widget<import('sygnal/ui/menu').MenuProps, ZagInstance, 'select' | 'checked-change' | 'open-change'>>>()
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

// UI sweep round 2: the widget field contract
const DueField = defineWidget({ events: ['pick'], field: { event: 'pick', read: (x: { v: string }) => x.v }, mount: () => ({ v: '' }) })
const df = <DueField className="due" name="due" />
// @ts-expect-error: not a declared event
defineWidget({ events: ['pick'], field: { event: 'pikc' }, mount: () => 1 })
void df
