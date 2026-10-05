// 'sygnal/ui/zag' (PLAN-5 U-1, D202/D203): Menu, Select and Combobox on Zag.js machines.
// Types for the entry. Needs @zag-js/vanilla, @zag-js/menu, @zag-js/select and @zag-js/combobox.
import type { Widget } from 'sygnal'
import type { ZagInstance } from 'sygnal/zag'

/** An item: its value as a string, or { value, label?, disabled? } */
export type UiItem = string | number | { value: string | number; label?: string; disabled?: boolean }

/** Zag's positioning options (placement, gutter, sameWidth, …) */
export type UiPositioning = Record<string, any>

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

interface ListboxProps {
  /** The visible label (the control's accessible name) */
  label?: any
  items: UiItem[]
  /** Controlled value: a string (an array when `multiple`); null for none */
  value?: string | string[] | null
  defaultValue?: string | string[] | null
  placeholder?: string
  multiple?: boolean
  /** The form field name (a hidden native select for Select, the input for Combobox) */
  name?: string
  form?: string
  disabled?: boolean
  readOnly?: boolean
  required?: boolean
  invalid?: boolean
  closeOnSelect?: boolean
  loopFocus?: boolean
  positioning?: UiPositioning
  /** Controlled open state (follow `open-change`) */
  open?: boolean
  defaultOpen?: boolean
  dir?: 'ltr' | 'rtl'
  id?: string
}

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

export interface ComboboxProps extends ListboxProps {
  /** The items shown for the typed text: default, labels containing it (case-insensitive); false: none (the app filters `items` from `input-change`) */
  filter?: false | ((item: { value: string; label: string; disabled?: boolean }, text: string) => boolean)
  allowCustomValue?: boolean
  openOnClick?: boolean
  inputBehavior?: 'autohighlight' | 'autocomplete' | 'none'
  selectionBehavior?: 'clear' | 'replace' | 'preserve'
}
/**
 * An editable combobox (Zag combobox). Events: `value-change`, `input-change` (the typed text),
 * `open-change`. Commands: `open`, `close`, `clear`, `focus`.
 */
export const Combobox: Widget<ComboboxProps, ZagInstance, 'value-change' | 'input-change' | 'open-change'>
