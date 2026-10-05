// 'sygnal/ui/select' (PLAN-5 U-1, D202/D203/D211): Select on Zag.js's select machine.
// Needs @zag-js/vanilla and @zag-js/select (optional peer dependencies, ~1.45.0).
import type { Widget } from 'sygnal'
import type { ZagInstance } from 'sygnal/zag'
import type { UiItem, UiPositioning, ListboxProps } from './ui-zag-types'
export type { UiItem, UiPositioning, ListboxProps } from './ui-zag-types'

export interface SelectProps extends ListboxProps {
  /** A click on the selected item of a single select clears it */
  deselectable?: boolean
}
/**
 * A select (Zag select): a trigger button + listbox + a hidden native select for forms. Events:
 * `value-change` (the value, or the values when multiple), `open-change`. Commands: `open`,
 * `close`, `clear`, `focus`.
 */
export const Select: Widget<SelectProps, ZagInstance, 'value-change' | 'open-change'>
