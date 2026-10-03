/*
 * PLAN-4 GS-1: the first-party `selection` behavior.
 *
 *   const { Pick, All } = controls({ Pick: 'input', All: 'input' })
 *   Mailbox.uses = { sel: selection({ multi: true, item: Pick, all: All, from: 'mails' }) }
 *   <Pick type="checkbox" data-id={mail.id} checked={isSelected(state.sel, mail.id)} aria-label={mail.subject} />
 *
 * Slice: { selected } (ids as strings, in selection order) plus the calculated `count`.
 * Actions: sel.SELECT (an id, or a click on the `item` control: its `attr`, default data-id;
 * single mode replaces the selection, multi mode toggles the id), sel.SELECT_ALL (an id array,
 * or every `idField` of the host's `state[from]` list), sel.TOGGLE_ALL (the `all` control: all
 * selected → none, else all), sel.CLEAR. Each is ABORT when nothing changes.
 *
 * `from` is read from the host state, which a behavior's own reducers don't see, so this
 * factory wraps the merged SELECT_ALL / TOGGLE_ALL entries to pass the host list's ids.
 */
import { defineBehavior } from './behaviors'

const ABORT = Symbol.for('sygnal.ABORT')
const ids = (d: any) => Array.isArray(d) ? d.map(String) : null
const set = (s: any, selected: string[]) =>
  selected.join('\0') === s.selected.join('\0') ? ABORT : {...s, selected}
// an id, or a click event: the item element's attribute (target.closest: a click on an icon inside)
const idOf = (d: any, attr: string, item: any): any => {
  if (!d || typeof d != 'object') return d
  const el = d.target?.closest?.(String(item)) || d.ownerTarget || d.target
  return el?.getAttribute?.(attr) ?? el?.dataset?.[attr.slice(5).replace(/-(\w)/g, (_: any, c: string) => c.toUpperCase())]
}

/** Is `id` selected in a `selection` slice (`isSelected(state.sel, item.id)`)? Ids compare as strings. */
export const isSelected = (slice: any, id: any): boolean => !!slice?.selected?.includes(String(id))

const def = (multi: boolean, attr: string, item: any) => ({
  initialState: {selected: [] as string[]},
  intent: ({DOM}: any, {item, all, clear}: any) => ({
    ...(item && {SELECT: DOM.click(item)}),
    ...(all && {TOGGLE_ALL: DOM.click(all)}),
    ...(clear && {CLEAR: DOM.click(clear)}),
  }),
  model: {
    SELECT: (s: any, d: any) => {
      const id = idOf(d, attr, item)
      if (id == null) return ABORT
      const k = String(id), has = s.selected.includes(k)
      return set(s, !multi ? [k] : has ? s.selected.filter((x: string) => x !== k) : [...s.selected, k])
    },
    SELECT_ALL: (s: any, d: any) => ids(d) ? set(s, ids(d)!) : ABORT,
    TOGGLE_ALL: (s: any, d: any) => {
      const all = ids(d)
      return !all ? ABORT : set(s, all.every(k => s.selected.includes(k)) ? [] : all)
    },
    CLEAR: (s: any) => set(s, []),
  },
  calculated: {count: (s: any) => s.selected.length},
})

/**
 * Single or multiple selection over a list (GS-1 behavior). Options: `multi` (false), the
 * controls `item` (on each row, with the id in `attr`, default 'data-id'), `all` (select-all
 * toggle; needs `from`) and `clear`, `from` (the host state key of the list) and `idField`
 * ('id', the id field of its items). Read it with `state.sel.selected`, `state.sel.count` and
 * `isSelected(state.sel, id)`.
 */
export const selection = (options: any = {}): any => {
  const {multi = false, attr = 'data-id', from, idField = 'id'} = options
  const b = defineBehavior(def(multi, attr, options.item))(options), merge = b.merge
  b.merge = (c: any, k: string) => {
    merge(c, k)
    if (from) for (const a of ['SELECT_ALL', 'TOGGLE_ALL']) {
      const e = c.model[k + '.' + a], S = c.stateSourceName, f = e?.[S]
      if (f) c.model[k + '.' + a] = {...e, [S]: (st: any, d: any, ...x: any[]) =>
        f(st, Array.isArray(d) ? d : (st?.[from] || []).map((i: any) => i?.[idField]), ...x)}
    }
  }
  return b
}
