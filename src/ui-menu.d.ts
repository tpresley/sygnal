// 'sygnal/ui/menu' (PLAN-5 U-1, D202/D203/D211): Menu on Zag.js's menu machine.
// Needs @zag-js/vanilla and @zag-js/menu (optional peer dependencies, ~1.45.0).
import type { Widget } from 'sygnal'
import type { ZagInstance } from 'sygnal/zag'
import type { UiItem, UiPositioning, UiNaming } from './ui-zag-types'
export type { UiItem, UiPositioning, UiNaming } from './ui-zag-types'

/** A Menu item: an action (UiItem), a separator, a checkbox / radio item, a link, or a submenu */
export type MenuItem =
  | UiItem
  | { separator: true }
  /** role menuitemcheckbox / menuitemradio; a click reports `checked-change` ({ value, checked, type }); keep `checked` in state */
  | { type: 'checkbox' | 'radio'; value: string | number; label?: string; checked?: boolean; disabled?: boolean }
  /** An <a href> item: activating it follows the link (and reports `select`) */
  | { href: string; value: string | number; label?: string; target?: string; rel?: string; disabled?: boolean }
  /** A submenu: ArrowRight / Enter / hover opens it, ArrowLeft / Escape closes it; a pick in it is the Menu's `select` */
  | { value: string | number; label?: string; items: MenuItem[]; disabled?: boolean }

/** `checked-change`'s detail */
export interface MenuCheckedChange { value: string; checked: boolean; type: 'checkbox' | 'radio' }

export interface MenuProps extends UiNaming {
  /** The trigger button's content and accessible name; without it (an icon trigger), name it with `aria-label` */
  label?: any
  /** The items: actions, `{ separator: true }`, checkbox / radio items, links, submenus */
  items: MenuItem[]
  /** Controlled open state (follow `open-change`) */
  open?: boolean
  defaultOpen?: boolean
  /** Close when an item is selected (default true) */
  closeOnSelect?: boolean
  /** The arrow keys wrap (default false) */
  loopFocus?: boolean
  /** Typing jumps to an item (default true) */
  typeahead?: boolean
  positioning?: UiPositioning
  dir?: 'ltr' | 'rtl'
  id?: string
}
/**
 * A menu button (Zag menu). Events: `select` (detail: the item's value), `checked-change`
 * (MenuCheckedChange), `open-change` (boolean). Commands: `open`, `close`.
 * `DOM.select('.actions').events('select').detail()`
 */
export const Menu: Widget<MenuProps, ZagInstance, 'select' | 'checked-change' | 'open-change'>
