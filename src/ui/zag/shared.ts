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

/**
 * The items as the parts take them: a string, or { value, label?, disabled? } (Menu also
 * { separator: true } and its item kinds); a group (UI sweep round 2) { group, items } is its
 * items, each with `group` (its label)
 */
export const norm = (items: any): any[] =>
  (items || []).flatMap((i: any) => (i && typeof i == 'object'
    ? i.group != null && Array.isArray(i.items) ? norm(i.items).map((j: any) => ({...j, group: String(i.group)}))
    : {...i, value: String(i.value ?? ''), label: i.label ?? String(i.value ?? '')}
    : {value: String(i), label: String(i)}))

/** A Select / Combobox value prop as Zag's string[] (undefined: uncontrolled; null or '': none) */
export const arr = (v: any): any =>
  v === undefined ? undefined : v == null || v === '' ? [] : Array.isArray(v) ? v.map(String) : [String(v)]

/** The listbox collection options for Zag's collection() */
export const collectionOf = (z: any, items: any[]) =>
  z.collection({items, itemToValue: (i: any) => i.value, itemToString: (i: any) => i.label, isItemDisabled: (i: any) => !!i.disabled,
    // round 2: groups (Zag orders the items by group, as they are shown)
    ...(items.some((i) => i.group != null) && {groupBy: (i: any) => i.group ?? ''})})

/** value-change's detail: the value (single) or the values (multiple) */
export const valueOut = (d: any, x: any) => (x.multiple ? d.value : d.value[0] ?? null)

/**
 * Item rows of a listbox (Select, Combobox): text + a ✓ indicator Zag hides when unselected;
 * grouped items (round 2) in a role="group" named by its label (items without a group first)
 */
export const options = (h: any, api: any) => {
  const c = api.collection
  const row = (item: any) =>
    h('div', {key: item.value, ...api.getItemProps({item})},
      h('span', api.getItemTextProps({item}), item.label),
      h('span', api.getItemIndicatorProps({item}), '✓'))
  if (!c.items.some((i: any) => i.group != null)) return c.items.map(row)
  return c.group().flatMap(([g, items]: any, k: number) => {
    if (!g) return items.map(row)
    const id = 'g' + k + '-' + g.replace(/[^\w-]/g, '_')
    return h('div', {key: 'group:' + g, ...api.getItemGroupProps({id})}, h('div', api.getItemGroupLabelProps({htmlFor: id}), g), items.map(row))
  })
}

/**
 * The parts are form fields (the widget field contract, extra/field.ts): `value-change`'s detail
 * is the field's value, and between picks the machine's value
 */
export const field = {event: 'value-change', read: (x: any) => valueOut({value: x.api().value}, x)}

/**
 * Round 2 (Radix's Popper): the positioner is `position: fixed` by default, so a clipping
 * container (`overflow: hidden` / `auto`: a card, a scrolling panel, a <dialog>) doesn't cut the
 * list off or flip it off-screen. An ancestor with a `transform`, `filter` or `contain` is then
 * its containing block; `positioning={{ strategy: 'absolute' }}` (merged over the default) goes back
 */
export const placed = (p: any) => ({...p, positioning: {strategy: 'fixed', ...p.positioning}})
