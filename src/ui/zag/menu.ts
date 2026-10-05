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
 * content, item, separator), `data-state`, `data-highlighted`, `data-disabled`.
 *
 * Props: `label`, `items` (strings, or { value, label?, disabled? }, or { separator: true }), and
 * Zag's menu props (`open` controlled, `defaultOpen`, `closeOnSelect`, `loopFocus`, `typeahead`,
 * `positioning`, `dir`, `id`). Events: `select` (the item's value), `open-change` (boolean).
 * Commands: `open`, `close`.
 */
import * as menu from '@zag-js/menu'
import {fromZag} from '../../zag'
import {createElement as h} from '../../index'
import {norm} from './shared'

export const Menu: any = /*#__PURE__*/ fromZag(menu, (api: any, p: any) => [
  h('button', api.getTriggerProps(), p.label),
  h('div', api.getPositionerProps(),
    h('div', api.getContentProps(),
      norm(p.items).map((i: any) => (i.separator
        ? h('hr', api.getSeparatorProps())
        : h('div', {key: i.value, ...api.getItemProps({value: i.value, disabled: !!i.disabled})}, i.label))))),
], {
  name: 'Menu',
  props: ({items, label, ...p}: any) => p,
  events: {select: ['onSelect', (d: any) => d.value], 'open-change': ['onOpenChange', (d: any) => d.open]},
  commands: {open: (api: any) => api.setOpen(true), close: (api: any) => api.setOpen(false)},
  fallback: (p: any, hh: any) => hh('button', {type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': false}, p.label),
})
