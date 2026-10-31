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

/**
 * UI sweep ZS-1 (dev-plans/research/ui-sweep/zag.md): a pick is heard as a form field's `input`
 * event, which the `form` behavior and processForm listen for (Zag changes the part's hidden
 * fields without one, and Select's `change` comes only once a controlled value has changed). A
 * stand-in field with the part's `name` and the picked value(s) (a <select multiple> when
 * `multiple`) is in the host while the event is dispatched; the part's own fields lose the name
 * meanwhile, so FormData has the pick once. They keep what the value prop says: the app may
 * refuse the pick.
 */
export const announce = (x: any, p: any, values: string[], type = 'input') => {
  const el = x.el, n = p.name
  if (n == null || !el.isConnected) return
  const d = el.ownerDocument, own = [...el.querySelectorAll('[name]')].filter((e: any) => e.name === n)
  const f = d.createElement(x.multiple ? 'select' : 'input')
  if (x.multiple) {
    f.multiple = true
    for (const v of values) { const o = d.createElement('option'); o.value = v; o.selected = true; f.appendChild(o) }
  } else f.type = 'hidden', f.value = values[0] ?? ''
  f.name = n
  f.hidden = true
  if (p.form != null) f.setAttribute('form', p.form)
  own.forEach((e: any) => e.removeAttribute('name'))
  el.appendChild(f)
  try { f.dispatchEvent(new Event(type, {bubbles: true})) } finally { f.remove(); own.forEach((e: any) => e.setAttribute('name', n)) }
}

/**
 * ZS-5: the focus leaving the part is a `focusout` of its named field (the form behavior marks the
 * field touched, so `show: 'blur'` errors appear): the root's focusout, when the focus goes
 * outside the host (not into the listbox)
 */
export const leaving = (bag: any, x: any, p: any) => {
  const own = bag.on.focusout
  bag.on.focusout = (e: any) => {
    own?.(e)
    x.el.contains(e.relatedTarget) || announce(x, p, x.api().value, 'focusout')
  }
  return bag
}

/**
 * ZS-6: inside a <dialog>, whose UA style is `overflow: auto`, an absolute positioner is clipped,
 * and Firefox and WebKit flip it off-screen: there the positioning strategy is 'fixed' unless the
 * `positioning` prop says otherwise
 */
export const placed = (p: any, x: any) => (x.el.closest('dialog') ? {...p, positioning: {strategy: 'fixed', ...p.positioning}} : p)
