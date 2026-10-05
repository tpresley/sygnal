// 'sygnal/ui/menu' (PLAN-5 U-1, D202/D203/D211): Menu on Zag.js's menu machine.
// Needs @zag-js/vanilla and @zag-js/menu (optional peer dependencies, ~1.45.0).
import type { Widget } from 'sygnal'
import type { ZagInstance } from 'sygnal/zag'
import type { UiItem, UiPositioning } from './ui-zag-types'
export type { UiItem, UiPositioning } from './ui-zag-types'

export interface MenuProps {
  /** The trigger button's text (its accessible name) */
  label: any
  /** The items; `{ separator: true }` renders a separator */
  items: Array<UiItem | { separator: true }>
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
 * A menu button (Zag menu). Events: `select` (detail: the item's value), `open-change` (boolean).
 * Commands: `open`, `close`. `DOM.select('.actions').events('select').detail()`
 */
export const Menu: Widget<MenuProps, ZagInstance, 'select' | 'open-change'>
