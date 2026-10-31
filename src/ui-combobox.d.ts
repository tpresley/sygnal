// 'sygnal/ui/combobox' (PLAN-5 U-1, D202/D203/D211): Combobox on Zag.js's combobox machine.
// Needs @zag-js/vanilla and @zag-js/combobox (optional peer dependencies, ~1.45.0).
import type { Widget } from 'sygnal'
import type { ZagInstance } from 'sygnal/zag'
import type { UiItem, UiPositioning, ListboxProps } from './ui-zag-types'
export type { UiItem, UiPositioning, ListboxProps } from './ui-zag-types'

export interface ComboboxProps extends ListboxProps {
  /** The items shown for the typed text: default, labels containing it (case-insensitive); false: none (the app filters `items` from `input-change`) */
  filter?: false | ((item: { value: string; label: string; disabled?: boolean }, text: string) => boolean)
  allowCustomValue?: boolean
  openOnClick?: boolean
  inputBehavior?: 'autohighlight' | 'autocomplete' | 'none'
  selectionBehavior?: 'clear' | 'replace' | 'preserve'
  /** With `multiple`: the values as chips with remove buttons before the input (default true) */
  chips?: boolean
  /** A chip's remove button's name: a prefix ('Remove' → "Remove Paris") or (label) => name */
  removeLabel?: string | ((label: string) => string)
  /** The chips list's name (default: the label) */
  chipsLabel?: string
  /** Shown (a `data-part="empty"` row, and announced in a status region) while the list is open with no items */
  empty?: any
}
/**
 * An editable combobox (Zag combobox). Events: `value-change`, `input-change` (the typed text),
 * `open-change`. Commands: `open`, `close`, `clear`, `focus`, `remove` (`{ remove: '.c', value }`:
 * one value of a multiple combobox; without `value`, the last).
 */
export const Combobox: Widget<ComboboxProps, ZagInstance, 'value-change' | 'input-change' | 'open-change'>
