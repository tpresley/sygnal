/*
 * PLAN-5 2-Z (U-1): Menu, a Zag menu machine (WAI-ARIA menu button) as a widget tag.
 *
 *   <Menu className="actions" label="Actions" items={[{ value: 'edit', label: 'Edit' }, { value: 'delete', label: 'Delete', disabled: true }]} />
 *   intent: PICK: DOM.select('.actions').events('select').detail()     // 'edit'
 *   model:  OPEN_ACTIONS: { ELEMENT: { open: '.actions' } }
 *
 * Renders a trigger button (its text: `label`) and the menu (role="menu", items role="menuitem")
 * in a positioner. Keyboard, focus and typeahead are Zag's: Enter / Space / ArrowDown open it on
 * the first item (ArrowUp on the last), the arrows move, Home / End, typing jumps to an item,
 * Enter / click selects and closes, Escape / Tab / a click outside closes; the focus returns to
 * the trigger. Styling hooks: Zag's `data-scope="menu"` + `data-part` (trigger, positioner,
 * content, item, item-text, item-indicator, separator, trigger-item), `data-state`,
 * `data-highlighted`, `data-disabled`, `data-type`.
 *
 * Props: `label`, `items`, and Zag's menu props (`open` controlled, `defaultOpen`,
 * `closeOnSelect`, `loopFocus`, `typeahead`, `positioning`, `dir`, `id`). Events: `select` (the
 * item's value), `checked-change` ({ value, checked, type }), `open-change` (boolean). Commands:
 * `open`, `close`.
 *
 * Items (UI sweep round 2, as Radix's DropdownMenu): strings, or { value, label?, disabled? };
 * { separator: true }; { type: 'checkbox' | 'radio', value, label, checked } (role
 * menuitemcheckbox / menuitemradio, a ✓ indicator; a click reports `checked-change`, the app
 * keeps `checked` in state); { href, value, label, target? } (an <a>: activating it follows the
 * link); { value, label, items } (a submenu: a trigger item that ArrowRight / Enter / hover opens,
 * ArrowLeft / Escape closes, its own Zag machine linked to its parent's; a pick in it is the
 * Menu's `select`).
 */
import * as menu from '@zag-js/menu'
import {VanillaMachine} from '@zag-js/vanilla'
import {fromZag, zagProps} from '../../zag'
import {createElement as h} from '../../index'
import {NAMING, layered, named, norm, placed} from './shared'

// a submenu's machine (one per submenu item, kept on the instance by path) and its api: started
// with the parent's props (dir, loopFocus, typeahead, closeOnSelect), placed beside its trigger
// item, linked to the parent's machine once that one runs
const sub = (x: any, path: string, parent: any): any => {
  const subs = x.subs ||= new Map()
  let s = subs.get(path)
  if (!s) {
    const id = parent.prop('id') + '-' + path.replace(/[^\w-]/g, '_')
    const m: any = new VanillaMachine(menu.machine, (): any => {
      const {dir, loopFocus, typeahead, closeOnSelect, positioning} = x.mp || {}
      return {
        id, dir, loopFocus, typeahead, closeOnSelect,
        positioning: {placement: dir == 'rtl' ? 'left-start' : 'right-start', gutter: 0, strategy: positioning?.strategy ?? 'fixed'},
        getRootNode: () => (x.el.isConnected ? x.el.getRootNode() : x.el.ownerDocument),
        onSelect: (d: any) => x.dispatch('select', d.value),
      }
    })
    m.subscribe(() => x.draw())
    m.start()
    subs.set(path, s = {m, api: () => menu.connect(m.service, x.normalize)})
    // linked once both run (the parent starts after its first render)
    queueMicrotask(() => {
      if (!x.subs?.has(path)) return
      menu.connect(parent, x.normalize).setChild(m.service)
      s.api().setParent(parent)
    })
    x.off ||= () => { for (const t of x.subs.values()) try { t.m.stop() } catch (_) {} x.subs.clear() }
  }
  return s
}

// Zag's own prop shape (flat, React-style): its connect spreads one getter's props over another's
// (getOptionItemProps over getItemProps, getTriggerItemProps' mergeProps), which our snabbdom
// bags don't survive; the item rows use it and convert at the end (zagProps)
const FLAT: any = new Proxy({}, {get: (_, k) => (k == 'style' ? (s: any) => ({...s}) : (p: any) => p)})
const flat = (service: any) => menu.connect(service, FLAT)

// the items of one menu (the Menu's, or a submenu's): plus the positioners of its submenus, which
// render next to the Menu's own positioner (outside its role="menu" content)
const items = (service: any, list: any, x: any, path: string, out: any[]): any[] => {
  const api = flat(service), z = zagProps
  return norm(list).map((i: any) => {
    if (i.separator) return h('hr', z(api.getSeparatorProps()))
    const v = i.value, d = !!i.disabled
    if (i.items) {
      const s = sub(x, path + v, service), c = s.api()
      out.push(h('div', {key: 'sub:' + path + v, ...c.getPositionerProps()},
        h('div', c.getContentProps(), items(s.m.service, i.items, x, path + v + '/', out))))
      const t = api.getTriggerItemProps(flat(s.m.service))
      return h('div', {key: v, ...z(t)},
        h('span', z(api.getItemTextProps({value: t.id})), i.label),
        h('span', {attrs: {'aria-hidden': 'true', 'data-scope': 'menu', 'data-part': 'submenu-indicator'}}, '›'))
    }
    if (i.type == 'checkbox' || i.type == 'radio') {
      const o = {type: i.type, value: v, checked: !!i.checked, disabled: d, valueText: i.label,
        onCheckedChange: (checked: boolean) => x.dispatch('checked-change', {value: v, checked, type: i.type})}
      // the indicator is decoration: not part of the item's name ("✓ Grid"; Zag's has no aria-hidden)
      const ind = z(api.getItemIndicatorProps(o))
      ind.attrs['aria-hidden'] = 'true'
      return h('div', {key: v, ...z(api.getOptionItemProps(o))},
        h('span', ind, '✓'),
        h('span', z(api.getItemTextProps(o)), i.label))
    }
    const b = z(api.getItemProps({value: v, disabled: d}))
    if (i.href != null) return h('a', {key: v, ...b, attrs: {...b.attrs, href: i.href, target: i.target, rel: i.rel}}, i.label)
    return h('div', {key: v, ...b}, i.label)
  })
}

export const Menu: any = /*#__PURE__*/ fromZag(menu, (api: any, p: any, x: any) => {
  const subs: any[] = [], content = items(x.machine.service, p.items, x, '', subs)
  layered(x, api.open)
  return [
    h('button', named(api.getTriggerProps(), {...p, label: 1}, 1), p.label),
    h('div', api.getPositionerProps(), h('div', api.getContentProps(), content)),
    ...subs,
  ]
}, {
  name: 'Menu',
  $own: 1,
  ownProps: NAMING,
  props: ({items, label, 'aria-label': _l, 'aria-labelledby': _b, 'aria-describedby': _d, ...p}: any, x: any) => (x.mp = placed(p)),
  events: {select: ['onSelect', (d: any) => d.value], 'checked-change': null, 'open-change': ['onOpenChange', (d: any) => d.open]},
  commands: {open: (api: any) => api.setOpen(true), close: (api: any) => api.setOpen(false)},
  fallback: (p: any, hh: any) => hh('button', {type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': false}, p.label),
})
