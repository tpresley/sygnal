// Types the Zag-based UI parts share (sygnal/ui/menu, sygnal/ui/select, sygnal/ui/combobox;
// PLAN-5 U-1, D211). Not an entry of its own: each part's types re-export what they use.
/** An item: its value as a string, or { value, label?, disabled? } */
export type UiItem = string | number | { value: string | number; label?: string; disabled?: boolean }

/** A labelled group of items (Select, Combobox): rendered as a role="group" named by `group` */
export interface UiGroup { group: string; items: UiItem[] }

/**
 * Zag's positioning options (placement, gutter, sameWidth, …). `strategy` is 'fixed' by default
 * (as Radix's Popper): an ancestor with a `transform`, `filter` or `contain` then becomes the
 * list's containing block; `strategy: 'absolute'` goes back
 */
export type UiPositioning = { strategy?: 'fixed' | 'absolute'; placement?: string; [option: string]: any }


/** G-413: naming props; they go on the part's control (trigger / input), not the host */
export interface UiNaming {
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
}

export interface ListboxProps extends UiNaming {
  /** The visible label (the control's accessible name) */
  label?: any
  /** Items, or groups of them: `{ group: 'Fruit', items: [...] }` */
  items: Array<UiItem | UiGroup>
  /** Controlled value: a string (an array when `multiple`); null for none. Values are strings: a numeric item value comes back as a string in `value-change` */
  value?: string | string[] | null
  defaultValue?: string | string[] | null
  placeholder?: string
  multiple?: boolean
  /** The form field name: a hidden native select (Select) or hidden inputs (Combobox) carry the value, and a pick is their `input` event (the form behavior, processForm) */
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

