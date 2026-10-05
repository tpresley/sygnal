/*
 * PLAN-5 2-Z: helpers the Zag-based parts (Menu, Select, Combobox) share. '../../zag' becomes the
 * external 'sygnal/zag' and '../../index' the external 'sygnal' in the 'sygnal/ui/menu', 'sygnal/ui/select' and 'sygnal/ui/combobox' builds.
 */

/** G-413: the naming props a part applies to its control (not the host) */
export const NAMING = ['aria-label', 'aria-labelledby', 'aria-describedby']

/**
 * A control's (or listbox's) Zag props named from the part's props: without a label element, no
 * aria-labelledby to it; the props' aria-label / aria-labelledby (/ aria-describedby) win
 */
export const named = (bag: any, p: any, describe?: any) => {
  const a = bag.attrs
  if (p.label == null) delete a['aria-labelledby']
  for (const k of NAMING) if (p[k] != null && (describe || k != 'aria-describedby')) a[k] = p[k]
  if (p['aria-labelledby'] != null) delete a['aria-label']
  return bag
}

/** An item as the parts take it: a string, or { value, label?, disabled? } (Menu also { separator: true }) */
export const norm = (items: any): any[] =>
  (items || []).map((i: any) => (i && typeof i == 'object'
    ? {...i, value: String(i.value ?? ''), label: i.label ?? String(i.value ?? '')}
    : {value: String(i), label: String(i)}))

/** A Select / Combobox value prop as Zag's string[] (undefined: uncontrolled; null or '': none) */
export const arr = (v: any): any =>
  v === undefined ? undefined : v == null || v === '' ? [] : Array.isArray(v) ? v.map(String) : [String(v)]

/** The listbox collection options for Zag's collection() */
export const collectionOf = (z: any, items: any[]) =>
  z.collection({items, itemToValue: (i: any) => i.value, itemToString: (i: any) => i.label, isItemDisabled: (i: any) => !!i.disabled})

/** value-change's detail: the value (single) or the values (multiple) */
export const valueOut = (d: any, x: any) => (x.multiple ? d.value : d.value[0] ?? null)

/** Item rows of a listbox (Select, Combobox): text + a ✓ indicator Zag hides when unselected */
export const options = (h: any, api: any) =>
  api.collection.items.map((item: any) =>
    h('div', {key: item.value, ...api.getItemProps({item})},
      h('span', api.getItemTextProps({item}), item.label),
      h('span', api.getItemIndicatorProps({item}), '✓')))
