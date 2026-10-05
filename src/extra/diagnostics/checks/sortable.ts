/**
 * PLAN-5 B-1 (3-D): `sortable` behavior diagnostics (dev entry; src/extra/sortable.ts carries no
 * text). The behavior calls `__SYGNAL_DIAGNOSTICS__.sortable(code, ...args)`:
 *   145  (item element, item selector, attr) a press or key on an item whose element has no
 *        `attr`: SYG145 (warn, once per selector); the event is ignored
 *   146  (host root, item, handle, attr) the host's first pointerdown / keydown: SYG146 (warn,
 *        once per selector) when elements carry `attr` under the root but none matches `item`,
 *        or items exist but none contains `handle`. Returns true once it could decide (an empty
 *        list can't tell: the check runs again at the next interaction)
 *   147  (from key, host state, uses key) when the host starts: a `from` key whose value isn't
 *        an array: SYG147 (warn, once per key)
 *   435  (3-H G-449) (fn) returns fn(): the host's own items' ids in DOM order (the behavior
 *        only computes them in dev); (shown ids, host state, from keys, idField, uses key) at a
 *        keyboard pick-up or a pointer press: SYG435 (warn, once per uses key and list) when a
 *        list's shown items aren't one run of the array in its order (a Collection's sort, or a
 *        filter hiding entries between shown ones)
 */
import {devReport, once, suggest} from './shared'

const all = (root: any, sel: string): any[] => {
  try { return [...root.querySelectorAll(sel)] } catch (_) { return [] }
}

export function reportSortable(code: number, a?: any, b?: any, c?: any, d?: any, e?: any): any {
  if (code == 145) {
    if (once(`SYG145:${b}:${c}`)) devReport('SYG145', {
      component: 'sortable',
      message: `sortable: an item ('${b}') has no ${c} attribute, so it can't be moved (the behavior finds each item in the list by that id)`,
      fix: `Render the item's id on its element: <li className="${String(b).replace(/^\./, '')}" ${c}={item.id}>, or name the attribute: sortable({ ..., attr: 'data-key' })`,
      data: {item: b, attr: c},
    })
    return
  }
  if (code == 146) {
    const root = a, item = b, handle = c, attr = d
    if (!root?.querySelectorAll) return true
    const items = all(root, item).filter(el => el !== root)
    if (!items.length) {
      // nothing carries the id attribute either: an empty list (decide later)
      if (!all(root, `[${attr}]`).length) return false
      report146('item', item, `no element under the host matches it, though elements with ${attr} are rendered`, `Use the selector of the items' elements (the element with ${attr}), e.g. item: '.task'`)
      return true
    }
    if (handle && !items.some(el => all(el, handle).length)) {
      report146('handle', handle, `no item ('${item}') contains an element that matches it`, `Use the selector of the drag handle inside each item, e.g. handle: '.grip', or leave handle out to drag the whole item`)
    }
    return true
  }
  if (code == 435) {
    // (a function) the host's own items' ids in the order they're shown: computed only here (dev)
    if (typeof a == 'function') { try { return a() } catch (_) { return } }
    // (shown ids, host state, from keys, idField, uses key) at a keyboard pick-up or a press
    const shown: string[] = a || []
    for (const l of c || []) {
      const ids = Array.isArray(b?.[l]) ? b[l].map((x: any) => String(x?.[d])) : []
      const dom = shown.filter(i => ids.includes(i)), i0 = ids.indexOf(dom[0])
      // a contiguous run in the array's order is fine (all of it, or a window of it)
      if (!dom.some((v, j) => ids[i0 + j] !== v)) continue
      if (once(`SYG435:${e}:${l}`)) devReport('SYG435', {
        component: 'sortable',
        message: `sortable '${e}': state.${l} is shown ${dom.length < ids.length ? 'with entries hidden between the shown ones' : 'in another order'} (a Collection with ${dom.length < ids.length ? 'filter' : 'sort'}?), but moves and the announced positions follow the array: a keyboard step can pass entries nobody sees, or change nothing visible`,
        fix: `Reorder a list that is shown as it is stored: drop the Collection's sort (sort state.${l} itself), and hide the drag handles while a filter hides entries`,
        data: {from: l, key: e},
      })
    }
    return
  }
  if (code == 147) {
    const st = b || {}, arrays = Object.keys(st).filter(k => Array.isArray(st[k]))
    const near = suggest(a, arrays)
    if (once(`SYG147:${c}:${a}`)) devReport('SYG147', {
      component: 'sortable',
      message: `sortable '${c}': from names '${a}', but state.${a} is ${st[a] === undefined ? 'missing' : 'not an array'} when the host starts${near ? ` (did you mean '${near}'?)` : ''}; nothing in it can be moved`,
      fix: `Name the host state's list: sortable({ from: '${near || arrays[0] || 'items'}', ... })${arrays.length ? ` (arrays in the state: ${arrays.join(', ')})` : `, and start it as an array (initialState: { ${a}: [] })`}`,
      data: {from: a, key: c},
    })
  }
}

const report146 = (option: string, selector: string, why: string, fix: string) => {
  if (once(`SYG146:${option}:${selector}`)) devReport('SYG146', {
    component: 'sortable',
    message: `sortable: ${option} '${selector}' matches nothing: ${why}, so no item can be dragged`,
    fix,
    data: {option, selector},
  })
}

/** Install the `sortable` hook on the core bridge (sortable.ts calls it). */
export function installSortableHooks(): () => void {
  const c = (globalThis as any).__SYGNAL_DIAGNOSTICS__
  if (!c) return () => {}
  c.sortable = reportSortable
  return () => { if (c.sortable === reportSortable) c.sortable = undefined }
}
