// Types the Zag-based UI parts share (sygnal/ui/menu, sygnal/ui/select, sygnal/ui/combobox;
// PLAN-5 U-1, D211). Not an entry of its own: each part's types re-export what they use.
/** An item: its value as a string, or { value, label?, disabled? } */
export type UiItem = string | number | { value: string | number; label?: string; disabled?: boolean }

/** Zag's positioning options (placement, gutter, sameWidth, …) */
export type UiPositioning = Record<string, any>


/** G-413: naming props; they go on the part's control (trigger / input), not the host */
export interface UiNaming {
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
}

export interface ListboxProps extends UiNaming {
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

