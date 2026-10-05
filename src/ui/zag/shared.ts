/*
 * PLAN-5 2-Z: helpers the Zag-based parts (Menu, Select, Combobox) share. '../../zag' becomes the
 * external 'sygnal/zag' and '../../index' the external 'sygnal' in the 'sygnal/ui/zag' build.
 */

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
