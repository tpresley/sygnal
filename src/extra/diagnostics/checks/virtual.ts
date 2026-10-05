/**
 * PLAN-5 V-1: `<VirtualCollection>` diagnostics (dev entry; src/extra/virtual.ts carries no text).
 *
 * The VirtualCollection host calls `__SYGNAL_DIAGNOSTICS__.virtual(code, owner, extra)`:
 *   430  the container has no bounded height: `extra.reason` 'height' (laid out 0 px tall) or
 *        'grows' (as tall as all its rows and taller than the viewport, so it would render every
 *        row); the window is clamped to the viewport (once per host and reason)
 *   431  items without `id` (index keys; once per host)
 *   432  an item renders a fragment or text, not one element (once per host)
 *   433  scrollToIndex / scrollToId for an index or id not in the (filtered) list
 *   434  estimateSize / overscan not a positive number (or a function, for estimateSize)
 */
import {devReport, nameOf} from './shared'

const tag = (owner: any) => `<VirtualCollection> in ${nameOf(owner)}`

export function reportVirtual(code: number, owner: any, x: any = {}): any {
  const component = owner ? nameOf(owner) : 'VirtualCollection'
  if (code == 430) {
    const grows = x.reason == 'grows'
    return devReport('SYG430', {
      component,
      message: grows
        ? `${tag(owner)} grows with its rows (it is ${Math.round(x.height)} px tall, as tall as all of them), so it is not a scroll container; only the rows within the viewport's height render`
        : `${tag(owner)} is 0 px tall, so no row is in view`,
      fix: 'Give its className a bounded height (height or max-height, e.g. .rows { height: 400px }, or flex: 1 with min-height: 0 in a flex column); it scrolls itself (overflow-y: auto)',
      data: x,
    })
  }
  if (code == 431) {
    return devReport('SYG431', {
      component,
      message: `${tag(owner)} has items without an id (${x.count} items): they are keyed by their index, so a row's instance and measured height follow its position, not its item, when items are added, removed or reordered`,
      fix: "Give every item a unique id (e.g. rows: data.map((r, i) => ({ id: r.key ?? i, ...r })))",
      data: x,
    })
  }
  if (code == 432) {
    return devReport('SYG432', {
      component,
      message: `${tag(owner)}: its item component ${x.component} renders a fragment or text, so its rows can't be measured, positioned or given aria-posinset`,
      fix: `Make ${x.component}'s view return one element (wrap its content in a <div> or <li>)`,
      data: x,
    })
  }
  if (code == 433) {
    const what = 'id' in x ? `id ${JSON.stringify(x.id) ?? String(x.id)}` : `index ${x.index}`
    return devReport('SYG433', {
      component,
      message: `${tag(owner)}: ${'id' in x ? 'scrollToId' : 'scrollToIndex'} for ${what}, which is not in its list (${x.count} rows after filter); it didn't scroll`,
      fix: 'id' in x
        ? 'Send the id of an item in the array the filter keeps: { scrollToId: \'.rows\', id }'
        : `Send an integer index from 0 to ${Math.max(0, x.count - 1)} into the shown (filtered, sorted) rows: { scrollToIndex: '.rows', index }`,
      data: x,
    })
  }
  if (code == 434) {
    return devReport('SYG434', {
      component,
      message: `${tag(owner)}: ${x.prop}={${typeof x.value == 'string' ? JSON.stringify(x.value) : String(x.value)}} is not ${x.prop == 'overscan' ? 'a number ≥ 0; 5 is used' : 'a positive number or a function; 32 is used'}`,
      fix: x.prop == 'overscan' ? 'Pass overscan={5} (rows rendered beyond each edge)' : 'Pass estimateSize={32} (about a row\'s height in px), or (item, index) => px',
      data: x,
    })
  }
}

/** Publish the VirtualCollection hook on the core bridge. Returns an uninstall function. */
export function installVirtualHooks(): () => void {
  const c = (globalThis as any).__SYGNAL_DIAGNOSTICS__
  if (!c) return () => {}
  c.virtual = reportVirtual
  return () => { if (c.virtual === reportVirtual) c.virtual = undefined }
}
