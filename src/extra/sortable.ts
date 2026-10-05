/*
 * PLAN-5 B-1 (3-D): the `sortable` behavior, drag-and-drop reordering of a host's list by pointer
 * (mouse, pen, touch) and keyboard. Spike 0-S5, rebuilt on D197 (HOST reducers, the key in the
 * handlers) and D194 (focusWithin).
 *
 *   List.uses = { sort: sortable({ from: 'tasks', item: '.task', handle: '.grip' }) }
 *   List.context = { sort: (state) => state.sort }        // items read the drag state
 *   List.model = { 'sort.DROPPED': { EFFECT: … } }          // save the order
 *   <ul><Collection of={Task} from="tasks" /></ul>
 *   <p role="status" aria-live="assertive">{state.sort.message}</p>
 *   // Task: <li className="task" data-id={state.id}>
 *   //   <button className="grip" aria-label={…} aria-describedby={context.sort.helpId}>⠿</button>…
 *
 * Slice (state.sort): { dragging, over, after, list, mode, press, origin, message, helpId }
 *   dragging  the id (a string) of the item being moved, or null
 *   over      the id the pointer is over (pointer mode; null over a gap or outside the list)
 *   after     true: the item lands after `over`, false: before it
 *   list      the `from` key the item would land in (pointer: `over`'s list, or a `data-list`
 *             container; keyboard: unused)
 *   mode      'pointer' | 'keyboard' | null
 *   message   the text for an ARIA live region (lift / move / drop / cancel)
 *   helpId    a uid() id for the instructions element the handles' aria-describedby names:
 *             unique per host instance, null until the first focus, press or key inside the
 *             host (G-448: nothing is written at startup). The server renders none, nor does
 *             the client's first render, so hydration matches (G-453); a focused handle has it
 *   press, origin: internal (the pointer press before the threshold; where the item started)
 * Actions: sort.PRESS, MOVE, UP, CANCEL (pointer), KEY (keyboard), INIT (the start), HELP, and
 * sort.DROPPED ({ id, list, index, fromList, fromIndex }) once per completed move: the host adds
 * an entry for it to save the order.
 *
 * Pointer feedback is an indicator (over / after) while the pointer moves; the list is reordered
 * on the drop. Keyboard moves reorder live (the arrow keys), and Escape puts the item back.
 *
 * Collection items are isolated, so the behavior listens on the host's ROOT (`DOM.events`), which
 * hears the events that bubble out of the items (G-145), and reads the item from
 * `target.closest(item)` and its id from `attr`. Pointer moves, the release, Escape, `selectstart`
 * and `dragstart` (no text selection, no native drag while pressed) are document listeners, subscribed only while
 * a press or a drag is active. The item under the pointer comes from `elementFromPoint` (a touch
 * pointer is implicitly captured by the pressed element, so its events keep that target); no
 * pointer capture.
 *
 * Nested sortables: an event is claimed by the first (innermost) sortable host it bubbles
 * through, so an outer sortable ignores the items of an inner one. A host's own items are the
 * item elements below its root that aren't inside another item below it (an item inside an item
 * belongs to a nested list, whose ids may repeat this host's: G-444/G-445): the press, key, the
 * item under the pointer (the outermost one there) and the focus target are resolved among them.
 *
 * Focus: each keyboard step (but Tab) sends `{ focus: focusWithin('<item>[<attr>="<id>"] <handle>') }`
 * (D194): the keyed Collection may move the focused node when the list reorders. A keyboard
 * drag drops at its current position when focus moves to another element (Tab, a click
 * elsewhere: focusout with a relatedTarget) or on any pointer press (a press on a handle then
 * starts a pointer press at once, G-451); focus lost to nothing (the window, a node move) keeps
 * the drag.
 *
 * Dev diagnostics through the core bridge's `sortable` hook (checks/sortable.ts): SYG145 an item
 * without `attr`, SYG146 `item` / `handle` matching nothing under the host at the first
 * interaction, SYG147 a `from` key that isn't an array in the host state.
 */
import {defineBehavior} from './behaviors'
import {focusWithin} from './focusWithin'
import {ABORT} from '../shared'
import xs from './xstreamCompat'
import {dropRepeats} from './xstreamExtras'

const dev = (...a: any[]): any => (globalThis as any).__SYGNAL_DIAGNOSTICS__?.sortable?.(...a)
const LIFT = /^( |Enter|Spacebar)$/
const KEYS = /^(Arrow(Up|Down|Left|Right)|Home|End|Escape|Tab)$/
const S = String
const FIELDS = 'button,a,input,select,textarea,label,[contenteditable]'
// the events a sortable host has taken: an outer (nested) sortable leaves them alone
const claimed = new WeakSet<any>()
// a selector usable as one compound (`.task`, `li[data-x]`), else wrapped in :is()
const one = (s: string) => /^[\w.#\-[\]="']+$/.test(s) ? s : `:is(${s})`

const defaults = {
  lift: (l: string, n: number, m: number, kb: boolean) => `Picked up ${l}, position ${n} of ${m}.` +
    (kb ? ' Use the arrow keys to move, Space to drop, Escape to cancel.' : ''),
  move: (l: string, n: number, m: number, list?: string) => `${l}: ${list ? list + ', ' : ''}position ${n} of ${m}.`,
  drop: (l: string, n: number, m: number, list?: string) => `Dropped ${l} at ${list ? list + ', ' : ''}position ${n} of ${m}.`,
  cancel: (l: string, n: number, m: number) => `Reorder cancelled. ${l} is back at position ${n} of ${m}.`,
}

const idle = {dragging: null, over: null, after: false, list: null, mode: null, press: null, origin: null, message: ''}

/**
 * Drag-and-drop reordering of `state[from]` (GS-1 behavior). Options: `from` (required: the host
 * state key of the list, or an array of keys for moves between lists, each container marked
 * `data-list="<key>"`), `item` (each item's element, carrying its id in `attr`; default
 * `[data-id]`), `handle` (the part that starts a drag and takes keyboard focus; default: the
 * item), `axis` ('y' | 'x': the arrow keys that move), `threshold` (px a pointer moves before a
 * drag starts, 4), `attr` ('data-id'), `idField` ('id'), `label` (item → its name in
 * announcements), `messages` ({ lift, move, drop, cancel }: (label, position, count, extra) => text).
 */
export const sortable = (options: any = {}): any => {
  const {from, handle, axis = 'y', threshold = 4, attr = 'data-id', idField = 'id'} = options
  const item = options.item || `[${attr}]`, lists: string[] = [].concat(from), grip = handle || item
  const label = options.label || ((i: any) => S(i?.title ?? i?.name ?? i?.label ?? i?.[idField]))
  const msg = {...defaults, ...options.messages}
  const [prevKey, nextKey] = axis == 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
  // an element's id attribute (dataset: the event targets of renderComponent's mock DOM)
  const idOf = (el: any) => el?.getAttribute?.(attr) ?? el?.dataset?.[attr.slice(5).replace(/-(\w)/g, (_: any, c: string) => c.toUpperCase())] ?? null

  // where an id is: { list, index, item, size }
  const find = (st: any, id: any) => {
    for (const l of lists) {
      const a = st?.[l], i = id != null && Array.isArray(a) ? a.findIndex((x: any) => S(x?.[idField]) === S(id)) : -1
      if (i >= 0) return {list: l, index: i, item: a[i], size: a.length}
    }
    return null
  }
  // move the item at `f` to list `l` at index `to` (the index it ends at)
  const move = (st: any, f: any, l: string, to: number) => {
    const out = {...st}, src = [...st[f.list]]
    src.splice(f.index, 1)
    const dst = l == f.list ? src : [...(st[l] || [])]
    dst.splice(Math.max(0, Math.min(to, dst.length)), 0, f.item)
    out[f.list] = src
    out[l] = dst
    return out
  }
  const put = (st: any, k: string, s: any) => ({...st, [k]: {...st[k], ...s}})
  // where a pointer drop would land: over an item (in its own list: before it, after it when
  // moving down; from another list: before or after it by the pointer's half, `low`: G-454), or
  // at the end of another list's container
  const landing = (st: any, f: any, o: any, list: any, low?: any) =>
    o ? o.list == f.list ? {list: o.list, to: o.index, after: f.index < o.index} : {list: o.list, to: o.index + (low ? 1 : 0), after: !!low}
    : list && lists.includes(list) && list != f.list ? {list, to: (st[list] || []).length, after: true}
    : null
  const where = (f: any, n: any) => n.list != f.list ? n.list : undefined
  // a keyboard drag ends where the item is (DROPPED when it moved)
  const drop = (st: any, k: string, next: any) => {
    const s = st[k], f = find(st, s.dragging), o = s.origin
    if (!f) return put(st, k, idle)
    if (o.list != f.list || o.index != f.index) next('DROPPED', {id: s.dragging, list: f.list, index: f.index, fromList: o.list, fromIndex: o.index}, 0)
    return put(st, k, {...idle, message: msg.drop(label(f.item), f.index + 1, f.size, where(o, f))})
  }
  // an element below the host's root `r` (the root is an item of an outer sortable; in
  // renderComponent's mock DOM, where the event's target is the root, it counts)
  const inside = (el: any, r: any) => el !== r ? !r?.contains || r.contains(el) : !r.nodeType
  // one of this host's own items: below the root and not inside another item below it (that one
  // is a nested list's, whose ids may repeat this host's: G-444)
  const own = (it: any, r: any) => {
    if (!it || !inside(it, r)) return false
    const up = it.parentElement?.closest?.(item)
    return !(up && inside(up, r))
  }
  // focus the moved item's handle: D194's focusWithin, keeping to this host's own items (G-445)
  const focus = (_s: any, d: any) => {
    if (d.key == 'Tab' || d.id == null) return ABORT
    const sel = ':scope ' + one(item) + `[${attr}="${S(d.id).replace(/["\\]/g, '\\$&')}"]` + (handle ? ' ' + one(handle) : '')
    return {focus: {...focusWithin(sel), spec: {commands: {focus: (root: any, o: any) => {
      for (const el of root.querySelectorAll?.(sel) || []) if (own(handle ? el.closest(item) : el, root)) return el.focus(o)
    }}}}}
  }

  const def = {
    initialState: {...idle, helpId: null},
    intent: ({DOM, STATE}: any) => {
      const doc = DOM.select('document'), slice$ = STATE.stream
      let root: any, checked: any // this host's root element (from its last press); SYG146 done
      const on = (f: (s: any) => any, s$: () => any) =>
        slice$.map(f).compose(dropRepeats()).map((a: any) => a ? s$() : xs.empty()).flatten()
      // the pointer's position and what it is over: the id of this host's item around the
      // element there (the outermost item below the root: G-444), and the data-list container
      const pt = (e: any) => {
        const x = e.clientX, y = e.clientY, d = typeof document != 'undefined' ? document : null
        const el = (typeof x == 'number' && d?.elementFromPoint?.(x, y)) || e.target
        let o: any
        for (let it = el?.closest?.(item); it && inside(it, root); it = it.parentElement?.closest?.(item)) o = it
        // over the item's second half (along the axis): an item from another list lands after it
        const box = lists.length > 1 && el?.closest?.('[data-list]'), b = o?.getBoundingClientRect?.()
        return {x: x || 0, y: y || 0, over: o ? idOf(o) : null, list: box && inside(box, root) ? box.getAttribute?.('data-list') : null,
          low: !!b?.height && (axis == 'x' ? x > b.left + b.width / 2 : y > b.top + b.height / 2)}
      }
      // the id of the item whose handle (or the item itself) the event happened on; `self`: the
      // handle must be the event's own target (keys)
      const gripOf = (e: any, self?: boolean) => {
        const t = e.target, r = e.ownerTarget || e.currentTarget
        if (!checked) checked = dev(146, r, item, handle, attr)
        const g = !claimed.has(e) && t?.closest?.(grip)
        if (!g || self && g !== t) return null
        // no handle: a press or key on a button, link or field inside the item is its own
        const inner = !handle && t !== g && t.closest?.(FIELDS)
        if (inner && inner !== g && (!g.contains || g.contains(inner))) return null
        // one of this host's own items (not its root, not a nested list's item)
        const it = handle ? g.closest?.(item) : g
        if (!own(it, r)) return null
        const id = idOf(it)
        if (id == null) dev(145, it, item, attr)
        return id
      }
      const keyed = (keys: RegExp, kb?: any) => (e: any) => keys.test(e.key) && (kb || e.key != 'Tab') && gripOf(e, true) != null
      const lift = keyed(LIFT), step = keyed(KEYS, 1)
      const take = (e: any) => {
        const id = gripOf(e, true)
        claimed.add(e)
        return {key: e.key == 'Spacebar' ? ' ' : e.key, id}
      }
      return {
        INIT: xs.of(0),
        // the first focus, press or key inside the host sets the instructions id (G-448: no
        // write at startup, so a Collection-item host's parent data stays clean until it is used)
        HELP: on((s: any) => !s.helpId, () => xs.merge(DOM.events('focusin'), DOM.events('pointerdown'), DOM.events('keydown')).mapTo(0)),
        PRESS: DOM.events('pointerdown')
          .filter((e: any) => e.isPrimary !== false && !e.button)
          .map((e: any) => {
            const id = gripOf(e)
            if (id == null) return null
            claimed.add(e)
            root = e.ownerTarget || e.currentTarget
            return {id, x: e.clientX || 0, y: e.clientY || 0}
          })
          .filter((d: any) => d != null),
        // no text selection and no native drag (an image or link in the item: its dragstart
        // would cancel the pointer, G-450) while a pointer is pressed (the listeners only filter)
        MOVE: on((s: any) => s.press, () => xs.merge(
          doc.events('pointermove').map(pt),
          xs.merge(doc.events('selectstart', {preventDefault: true}), doc.events('dragstart', {preventDefault: true})).filter(() => false))),
        UP: on((s: any) => s.press, () => doc.events('pointerup').map(pt)),
        CANCEL: on((s: any) => s.press, () => xs.merge(
          doc.events('pointercancel'),
          doc.events('keydown', {preventDefault: (e: any) => e.key == 'Escape'}).filter((e: any) => e.key == 'Escape'))),
        KEY: xs.merge(
          // a held Space / Enter (auto-repeat) neither drops nor lifts again (G-446)
          DOM.events('keydown', {preventDefault: lift}).filter((e: any) => !e.repeat && lift(e)).map(take),
          on((s: any) => s.mode == 'keyboard', () => xs.merge(
            DOM.events('keydown', {preventDefault: keyed(KEYS)}).filter(step).map(take),
            // focus moved to another element, or a pointer press anywhere: drop where it is
            DOM.events('focusout').filter((e: any) => e.relatedTarget),
            doc.events('pointerdown')).map((d: any) => d.key ? d : {key: 'Tab'}))),
      }
    },
    model: {
      // SYG147 (dev)
      INIT: {HOST: (st: any, _d: any, _n: any, _p: any, _o: any, k: string) => {
        for (const l of lists) Array.isArray(st?.[l]) || dev(147, l, st, k)
        return ABORT
      }},
      // the instructions id: a uid() of the host (unique per host instance)
      HELP: {HOST: (st: any, _d: any, _n: any, p: any, _o: any, k: string) =>
        st[k].helpId || !p?.uid ? ABORT : put(st, k, {helpId: p.uid(k + '-help')})},
      PRESS: {HOST: (st: any, d: any, next: any, _p: any, _o: any, k: string) => {
        const s = st[k]
        if (s.mode == 'pointer' || !find(st, d.id)) return ABORT
        // during a keyboard drag: it drops where it is, and the press starts (G-451)
        return put(s.mode == 'keyboard' ? drop(st, k, next) : st, k, {press: d})
      }},
      MOVE: {HOST: (st: any, d: any, _n: any, _p: any, _o: any, k: string) => {
        const s = st[k], p = s.press, f = p && find(st, p.id)
        if (!f) return ABORT
        // past the threshold: the drag starts
        const start = !s.dragging && {dragging: S(p.id), mode: 'pointer', origin: {list: f.list, index: f.index}, message: msg.lift(label(f.item), f.index + 1, f.size, false)}
        if (!s.dragging && Math.hypot(d.x - p.x, d.y - p.y) < threshold) return ABORT
        const o = find(st, d.over), L = landing(st, f, o, d.list, d.low)
        const next = {...start, over: o ? S(o.item[idField]) : null, list: L?.list ?? null, after: !!L?.after}
        return !start && next.over === s.over && next.list === s.list && next.after === s.after ? ABORT : put(st, k, next)
      }},
      UP: {HOST: (st: any, d: any, next: any, _p: any, _o: any, k: string) => {
        const s = st[k]
        if (!s.dragging) return s.press ? put(st, k, idle) : ABORT
        const f = find(st, s.dragging)
        // the release point decides (a last move may not have been rendered)
        const L = f && landing(st, f, find(st, d.over), d.list, d.low)
        if (!f || !L || L.list == f.list && L.to == f.index) return put(st, k, {...idle, message: f ? msg.cancel(label(f.item), f.index + 1, f.size) : ''})
        const out = move(st, f, L.list, L.to), n = find(out, s.dragging)!
        next('DROPPED', {id: s.dragging, list: n.list, index: n.index, fromList: f.list, fromIndex: f.index}, 0)
        return put(out, k, {...idle, message: msg.drop(label(f.item), n.index + 1, n.size, where(f, n))})
      }},
      CANCEL: {HOST: (st: any, _d: any, _n: any, _p: any, _o: any, k: string) => {
        const s = st[k], f = s.dragging && find(st, s.dragging)
        return s.press ? put(st, k, {...idle, message: f ? msg.cancel(label(f.item), f.index + 1, f.size) : ''}) : ABORT
      }},
      KEY: {
        HOST: (st: any, {key, id}: any, next: any, _p: any, _o: any, k: string) => {
          const s = st[k], f = find(st, s.dragging ?? id)
          if (s.mode == 'pointer' || s.press) return ABORT
          // the lifted item left the list (removed by another action): the drag ends
          if (!f) return s.dragging ? put(st, k, idle) : ABORT
          const l = label(f.item), o = s.origin
          if (!s.dragging) return LIFT.test(key)
            ? put(st, k, {...idle, dragging: S(id), mode: 'keyboard', origin: {list: f.list, index: f.index}, message: msg.lift(l, f.index + 1, f.size, true)})
            : ABORT
          if (LIFT.test(key) || key == 'Tab') return drop(st, k, next)
          if (key == 'Escape') {
            const back = move(st, f, o.list, o.index)
            return put(back, k, {...idle, message: msg.cancel(l, o.index + 1, back[o.list].length)})
          }
          // the cross axis moves between lists (from: [a, b]): to the same index, clamped
          const side = ({ArrowUp: -1, ArrowDown: 1, ArrowLeft: -1, ArrowRight: 1} as any)[key]
          if (side && key != prevKey && key != nextKey) {
            const to = lists[lists.indexOf(f.list) + side]
            if (!to) return ABORT
            const out = move(st, f, to, f.index), n = find(out, s.dragging)!
            return put(out, k, {message: msg.move(l, n.index + 1, n.size, to)})
          }
          const to = key == prevKey ? f.index - 1 : key == nextKey ? f.index + 1 : key == 'Home' ? 0 : key == 'End' ? f.size - 1 : -1
          return to < 0 || to >= f.size || to == f.index ? ABORT : put(move(st, f, f.list, to), k, {message: msg.move(l, to + 1, f.size)})
        },
        // keep focus on the moved item's handle (its node may move or be re-created)
        ELEMENT: focus,
      },
      DROPPED: ABORT,
    },
  }
  return defineBehavior(def)(options)
}
