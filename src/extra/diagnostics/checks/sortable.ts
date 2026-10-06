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
 *   435  (3-H G-449) (fn, uses key, from keys, idOf): the host's own items' ids as shown, per
 *        container (fn() returns [the item elements, the root]; the behavior only asks in dev), or nothing when
 *        every list has been reported (3-L G-478: no scan). A row's place is its `data-index`
 *        when it has one (VirtualCollection's pinned focused row is out of DOM order). (shown
 *        groups, host state, from keys, idField, uses key) at a keyboard pick-up or a pointer
 *        press: SYG435 (warn, once per uses key and list) when a list's shown items (those in
 *        the container holding most of them: an element elsewhere with a matching id is no list
 *        item; a row's container is its nearest ancestor holding another row, 3-O G-505) aren't
 *        one run of the array in its order (a Collection's sort, or a filter hiding entries
 *        between shown ones)
 */
import {devReport, once, onced, suggest} from './shared'

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
    // (fn, uses key, from keys, idOf) the shown ids per container: computed only here (dev)
    if (typeof a == 'function') {
      if ((c || []).every((l: string) => onced(`SYG435:${b}:${l}`))) return
      try {
        const by = new Map<any, any[]>(), [els, root] = a(), n = new Map<any, number>()
        // a row's place: its data-index (a VirtualCollection row below the host's root; its
        // pinned row isn't in DOM order)
        const rows = els.map((el: any) => {
          const r0 = el.closest?.('[data-index]'), row = r0 && r0 !== root && root.contains?.(r0) ? r0 : el
          return [el, row, Number(row === el && !r0 ? NaN : row.getAttribute('data-index'))]
        })
        // 3-O G-505: a row's container is its nearest ancestor holding another row (items each in
        // their own wrapper, <li><div data-id>, a table cell, a Collection item's root, are still
        // one list); `n` counts the rows below each ancestor
        const up = (row: any, f: (p: any) => any) => { for (let p = row.parentElement; p; p = p === root ? null : p.parentElement) if (f(p)) return p }
        for (const [, row] of rows) up(row, p => void n.set(p, (n.get(p) || 0) + 1))
        for (const [el, row, at] of rows) {
          const p = up(row, p => n.get(p)! > 1) || row.parentElement
          by.has(p) || by.set(p, [])
          by.get(p)!.push([isNaN(at) ? by.get(p)!.length : at, String(d(el))])
        }
        return [...by.values()].map(g => g.sort((x, y) => x[0] - y[0]).map(x => x[1]))
      } catch (_) { return }
    }
    // (shown groups, host state, from keys, idField, uses key) at a keyboard pick-up or a press
    const groups: string[][] = Array.isArray(a?.[0]) ? a : [a || []]
    for (const l of c || []) {
      if (onced(`SYG435:${e}:${l}`)) continue
      const at = new Map<string, number>()
      if (Array.isArray(b?.[l])) b[l].forEach((x: any, i: number) => at.set(String(x?.[d]), i))
      // the list's container: the one holding most of its entries (others: stray matches)
      let dom: number[] = []
      for (const g of groups) {
        const ix = g.filter(i => at.has(i)).map(i => at.get(i)!)
        if (ix.length > dom.length) dom = ix
      }
      // a contiguous run in the array's order is fine (all of it, or a window of it)
      if (!dom.some((v, j) => v !== dom[0] + j)) continue
      if (once(`SYG435:${e}:${l}`)) devReport('SYG435', {
        component: 'sortable',
        message: `sortable '${e}': state.${l} is shown ${dom.length < at.size ? 'with entries hidden between the shown ones' : 'in another order'} (a Collection with ${dom.length < at.size ? 'filter' : 'sort'}?), but moves and the announced positions follow the array: a keyboard step can pass entries nobody sees, or change nothing visible`,
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
