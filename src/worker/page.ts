/**
 * sygnal/worker/page: the page half (research: dev-plans/research/web-worker). Applies the worker's
 * patch ops to the real DOM, forwards the events the app listens for (with the target's form
 * state), makes the decisions that can't wait for the worker (preventDefault), and hosts the
 * drivers that need the page (localStorage, the router, DOM-only browser APIs). No Sygnal core:
 * xstream for the page drivers' sinks, and sygnal/host's selector matching for declared
 * preventDefaults.
 *
 *   startBridge(new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }), root, {
 *     drivers: { STORE: localStorageDriver, ROUTER: routerDriver },
 *   })
 *
 * Fields: while the user edits a field, the page owns its value. A value the page sent is never
 * echoed back; a worker value about older text is rebased onto what the user typed since (and the
 * caret kept); a submit waits until the worker has acknowledged the form's last edit.
 */
import xs from 'xstream'
import {matches} from '../host/selector'
import {matchPattern} from '../host/delegation'
import {OP} from './protocol'
import type {PageEvent, Prevent} from './protocol'

/** the page side of the channel: a Worker, or a MessagePort */
export interface BridgePort {
  postMessage(message: any): void
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void
  removeEventListener(type: 'message', listener: (e: MessageEvent) => void): void
  start?(): void
}

export interface BridgeOptions {
  /** drivers that run on the page; the worker reaches each with target.remote(name) */
  drivers?: Record<string, (sink$: any) => any>
  /**
   * Default actions the page cancels synchronously beyond the intents' declarations
   * (`events(type, { preventDefault })`): [type, selector] pairs, the selector matched with
   * closest() from the target ('*': any target in the mount). Default [['submit', '*']]: a Sygnal
   * form never wants the browser's submit.
   */
  preventDefault?: [string, string][]
  /** event types sent at most once a frame, the latest (wheel: deltas summed). Default: pointermove, mousemove, scroll, wheel */
  coalesce?: string[]
  /** after each batch of ops is applied (tests, measurement) */
  onApply?: (ops: number) => void
}

export interface Bridge {
  /** resolves when the first batch of ops is on the page */
  ready: Promise<void>
  /** stop listening (the worker keeps running: terminate it yourself) */
  stop(): void
  stats: {received: number, sent: number, ops: number, held: number}
}

const INIT_KEYS = ['key', 'code', 'keyCode', 'which', 'charCode', 'location', 'shiftKey', 'ctrlKey', 'altKey', 'metaKey', 'repeat',
  'button', 'buttons', 'clientX', 'clientY', 'pageX', 'pageY', 'offsetX', 'offsetY', 'screenX', 'screenY', 'movementX', 'movementY',
  'deltaX', 'deltaY', 'deltaZ', 'deltaMode', 'detail', 'inputType', 'data', 'isComposing', 'pointerId', 'pointerType', 'pressure',
  'width', 'height', 'isPrimary']
// always forwarded: the host tree's copy of field values and focus must follow the page even when
// no intent listens (processForm reads the worker's form on submit)
const ALWAYS = ['input', 'change', 'focus', 'blur']
const FIELD = /^(INPUT|TEXTAREA|SELECT)$/
// text fields whose caret the page can read and set (setSelectionRange throws on the others)
const CARET = /^(text|search|url|tel|password)$/

export function startBridge(worker: BridgePort, mount: Element, options: BridgeOptions = {}): Bridge {
  const nodes = new Map<number, Node>()
  const idOf = new WeakMap<Node, number>()
  const scopes = new WeakMap<Node, string>()
  // per field: what the worker had, in order (see prop), and the seq of its last edit the page sent
  const sent = new WeakMap<Node, [number, string][]>()
  const lastEdit = new WeakMap<Node, number>()
  const composing = new WeakSet<Node>()
  const pd = options.preventDefault || [['submit', '*']]
  const coalesce = new Set(options.coalesce || ['pointermove', 'mousemove', 'scroll', 'wheel'])
  const listening = new Set<string>()
  const declared = new Map<string, Prevent[]>()
  const stats = {received: 0, sent: 0, ops: 0, held: 0}
  let seq = 0
  let ack = 0
  let applying = false
  let resolveReady!: () => void
  const ready = new Promise<void>((ok) => { resolveReady = ok })

  const post = (m: any) => { stats.sent++; worker.postMessage(m) }

  // ---- ops → DOM ----------------------------------------------------------------------------

  function apply(ops: any[]) {
    applying = true
    let n = 0
    try {
      for (let i = 0; i < ops.length; n++) {
        switch (ops[i]) {
          case OP.EL: { const el = document.createElement(ops[i + 2]); nodes.set(ops[i + 1], el); idOf.set(el, ops[i + 1]); i += 3; break }
          case OP.TEXT: { const t = document.createTextNode(ops[i + 2]); nodes.set(ops[i + 1], t); i += 3; break }
          case OP.KIDS: { kids(nodes.get(ops[i + 1]) as Element, ops[i + 2]); i += 3; break }
          case OP.ATTR: { const el = nodes.get(ops[i + 1]) as Element, v = ops[i + 3]; v == null ? el.removeAttribute(ops[i + 2]) : el.setAttribute(ops[i + 2], v); i += 4; break }
          case OP.PROP: { prop(nodes.get(ops[i + 1]) as any, ops[i + 2], ops[i + 3]); i += 4; break }
          case OP.DATA: { (nodes.get(ops[i + 1]) as Text).data = ops[i + 2]; i += 3; break }
          case OP.STYLE: {
            const s = (nodes.get(ops[i + 1]) as HTMLElement).style, k: string = ops[i + 2], v = ops[i + 3]
            if (k.startsWith('--') || k.includes('-')) v == null ? s.removeProperty(k) : s.setProperty(k, v)
            else (s as any)[k] = v == null ? '' : v
            i += 4; break
          }
          case OP.FOCUS: {
            const el = nodes.get(ops[i + 1]) as HTMLElement | undefined
            el ? el.focus() : mount.contains(document.activeElement) && (document.activeElement as HTMLElement).blur()
            i += 2; break
          }
          case OP.FREE: { for (const id of ops[i + 1]) nodes.delete(id); i += 2; break }
          case OP.SCOPE: { const el = nodes.get(ops[i + 1])!; ops[i + 2] == null ? scopes.delete(el) : scopes.set(el, ops[i + 2]); i += 3; break }
          default: throw new Error('sygnal/worker/page: unknown op ' + ops[i])
        }
      }
    } finally { applying = false }
    return n
  }

  /** a parent's children become exactly `ids`: removals first, then one pass of moves/inserts */
  function kids(parent: Element, ids: number[]) {
    const want = ids.map((id) => nodes.get(id)!)
    const keep = new Set(want)
    for (let c = parent.firstChild; c;) { const next = c.nextSibling; if (!keep.has(c)) parent.removeChild(c); c = next }
    let cur = parent.firstChild
    for (const n of want) {
      if (n === cur) cur = cur.nextSibling
      else parent.insertBefore(n, cur)
    }
  }

  /**
   * A field's value / checked from the worker. When the user has edited the field since the last
   * event the worker had handled (`ack`), the worker's value is a decision about older text: it is
   * rebased (the user's edits since then, applied to the worker's value) instead of dropped
   * (React Native's event-count rule keeps the stale text: "Buy milk" + Enter + "W" would stay
   * "Buy milkW" when the worker's clear arrives) or applied as is (the "W" would be lost).
   * Deferred while an IME composes. The caret follows the text it was in.
   *
   * A field's log holds what the worker had, in order: [seq, value] for each value the page sent,
   * [ack, value] for each value the worker wrote. The base of a rebase is the last entry at `ack`.
   */
  function prop(el: any, k: string, v: any) {
    if (composing.has(el)) return
    if (k !== 'value') { if (el[k] !== v) el[k] = v; return }
    let log = sent.get(el)
    if (!log) sent.set(el, log = [])
    let b = -1
    for (let i = 0; i < log.length; i++) if (log[i][0] <= ack) b = i
    const base = b >= 0 ? log[b][1] : ''
    const later = log.slice(b + 1)
    const heldEdits = held ? held.filter((ev) => fieldOf.get(ev) === el) : []
    log.length = 0
    log.push([ack, v], ...later)
    if (!later.length && !heldEdits.length) { if (el.value !== v) setValue(el, v); return }
    // the events still held back, the screen, and what the worker was last sent follow too
    for (const ev of heldEdits) ev.state!.value = rebase(base, ev.state!.value!, v)
    const next = rebase(base, el.value, v)
    if (next !== el.value) setValue(el, next)
    if (later.length) {
      const known = later[later.length - 1][1], synced = rebase(base, known, v)
      // the worker's copy and the app's state follow as an input event (its events carried the
      // pre-rebase text), ahead of anything held
      if (synced !== known) post_({seq: 0, type: 'input', id: idOf.get(el)!, init: {inputType: 'insertReplacementText'}, state: {value: synced}}, el)
    }
  }

  /** a value write that keeps the caret where it was relative to the text around it (Q-WW-4) */
  function setValue(el: any, next: string) {
    const old: string = el.value
    const keep = el === document.activeElement && (el.tagName === 'TEXTAREA' || CARET.test(el.type))
    const s = keep ? el.selectionStart : null, e = keep ? el.selectionEnd : null
    el.value = next
    if (keep && s != null) try { el.setSelectionRange(caret(old, next, s), caret(old, next, e ?? s)) } catch { /* not a text field after all */ }
  }

  // ---- DOM events → worker ------------------------------------------------------------------

  /** the element carrying `el`'s innermost isolation scope (null: the root component's) */
  const scopeRoot = (el: Node | null): Node | null => {
    for (let e = el; e && e !== mount; e = e.parentNode) if (scopes.has(e)) return e
    return null
  }
  /** does an intent's declared preventDefault apply: as sygnal/host's delegation decides, on the page's elements */
  function declaredPrevent(e: Event) {
    const list = declared.get(e.type)
    if (!list) return false
    let sr = scopeRoot(e.target as Node)
    for (let el = e.target as Node | null; el && el !== mount.parentNode; el = el.parentNode) {
      if (el.nodeType === 1) {
        const key = sr ? scopes.get(sr)! : ''
        for (const [, sel, global, scope, pattern] of list) {
          let at = false
          try {
            at = global ? !sel || matches(el, sel)
              : scope === key && (sel ? matches(el, sel, sr ? sr.parentNode : mount.parentNode) : el === (sr || mount))
          } catch { /* a selector sygnal/host doesn't support: the worker reported it */ }
          if (at && (pattern === true || matchPattern(pattern, e))) return true
        }
      }
      if (!e.bubbles || el === mount) break
      if (el === sr) sr = scopeRoot(el.parentNode)
    }
    return false
  }

  // Q-WW-7: per frame, the latest event of a high-frequency type (pending, posted with the next frame or the next other event)
  const pending = new Map<string, PageEvent>()
  let frame = 0
  function flushPending() {
    if (frame) { cancelAnimationFrame(frame); frame = 0 }
    for (const ev of pending.values()) send(ev)
    pending.clear()
  }

  // Q-WW-3: a submit waits until the worker has acknowledged the form's last edit, and what follows
  // a submit waits until the worker has handled it (its reaction, a cleared field, rebases what the
  // user typed meanwhile). Sequence numbers are given when an event is posted: the acks only grow
  let held: PageEvent[] | null = null
  let holdUntil = 0
  let holdTimer: any = 0
  // a field event's field (its value is logged when it's posted), a submit's form
  const fieldOf = new WeakMap<PageEvent, Node>()
  const formOf = new WeakMap<PageEvent, any>()
  function hold(until: number) {
    held = []
    holdUntil = until
    post({ping: true})
    // a worker that never answers mustn't swallow the events
    holdTimer = setTimeout(release, 1000)
  }
  function send(ev: PageEvent) {
    if (held) { held.push(ev); return }
    const form = formOf.get(ev)
    if (form) {
      let until = 0
      for (const f of Array.from(form.elements || []) as Node[]) until = Math.max(until, lastEdit.get(f) ?? 0)
      if (until > ack) { stats.held++; hold(until); held!.push(ev); return }
      post_(ev)
      hold(ev.seq)
      return
    }
    post_(ev, fieldOf.get(ev))
  }
  function post_(ev: PageEvent, field?: Node) {
    ev.seq = ++seq
    if (field && ev.state && 'value' in ev.state) {
      let log = sent.get(field)
      if (!log) sent.set(field, log = [])
      log.push([ev.seq, ev.state.value!])
      lastEdit.set(field, ev.seq)
      // only the last entry the worker has acknowledged is still a possible base
      if (log.length > 32) { let b = 0; for (let i = 0; i < log.length; i++) if (log[i][0] <= ack) b = i; log.splice(0, b) }
    }
    post({ev: [ev]})
  }
  function release() {
    clearTimeout(holdTimer)
    const q = held!
    held = null
    // one message each: the worker reacts to each before it takes the next; a submit holds again
    for (const ev of q) send(ev)
  }

  function onEvent(e: Event) {
    // focus moves the bridge itself made (autoFocus in the worker) aren't news to the worker
    if (applying && (e.type === 'focus' || e.type === 'blur')) return
    let el = e.target as Node | null
    while (el && !idOf.has(el)) el = el.parentNode
    if (!el) return
    const t = e.target as any
    if (!e.defaultPrevented) {
      for (const [type, sel] of pd) if (type === e.type && (sel === '*' || t.closest?.(sel))) { e.preventDefault(); break }
      if (!e.defaultPrevented && declaredPrevent(e)) e.preventDefault()
    }
    if (!listening.has(e.type) && !ALWAYS.includes(e.type)) return
    const init: Record<string, any> = {}
    for (const k of INIT_KEYS) { const v = (e as any)[k]; if (v !== undefined && typeof v != 'object' && typeof v != 'function') init[k] = v }
    const ev: PageEvent = {seq: 0, type: e.type, id: idOf.get(el)!, init}
    if (FIELD.test(t.tagName) && 'value' in t) {
      ev.state = t.type === 'checkbox' || t.type === 'radio' ? {value: t.value, checked: t.checked} : {value: t.value}
      if (e.type === 'input' || e.type === 'change') fieldOf.set(ev, t)
    } else if (e.type === 'scroll' && t.nodeType === 1) ev.state = {scrollTop: t.scrollTop, scrollLeft: t.scrollLeft}

    if (coalesce.has(e.type)) {
      const prev = pending.get(e.type)
      if (prev && prev.id !== ev.id) { pending.delete(e.type); send(prev) }
      else if (prev && e.type === 'wheel') for (const k of ['deltaX', 'deltaY', 'deltaZ']) ev.init[k] = (ev.init[k] || 0) + (prev.init[k] || 0)
      pending.set(e.type, ev)
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; flushPending() })
      return
    }
    flushPending()
    if (e.type === 'submit') formOf.set(ev, t)
    send(ev)
  }

  // one capture listener per type: the always-forwarded ones, the bridge's own preventDefaults,
  // then what the worker's intents listen for or declare
  const attached = new Set<string>()
  const attach = (type: string) => {
    if (attached.has(type)) return
    attached.add(type)
    mount.addEventListener(type, onEvent, {capture: true, passive: false})
  }
  for (const t of ALWAYS) attach(t)
  for (const [t] of pd) attach(t)
  const compStart = (e: Event) => composing.add(e.target as Node)
  const compEnd = (e: Event) => composing.delete(e.target as Node)
  mount.addEventListener('compositionstart', compStart, true)
  mount.addEventListener('compositionend', compEnd, true)

  // ---- drivers on the page ------------------------------------------------------------------

  const sinks: Record<string, any> = {}
  const sources: Record<string, any> = {}
  for (const [name, driver] of Object.entries(options.drivers || {})) {
    sinks[name] = xs.create()
    sources[name] = driver(sinks[name])
  }
  const subs = new Map<number, {stream: any, listener: any}>()

  function onMessage(m: MessageEvent) {
    const d = m.data
    if (!d || typeof d != 'object') return
    stats.received++
    if (d.ops) {
      ack = d.ack
      if (d.listen) for (const t of d.listen) { listening.add(t); attach(t) }
      if (d.prevent) {
        declared.clear()
        for (const p of d.prevent as Prevent[]) {
          const l = declared.get(p[0])
          l ? l.push(p) : declared.set(p[0], [p])
          attach(p[0])
        }
      }
      const n = apply(d.ops)
      stats.ops += n
      options.onApply?.(n)
      if (held && ack >= holdUntil) release()
      resolveReady()
    } else if (d.root) { nodes.set(d.root, mount); idOf.set(mount, d.root) }
    else if (d.sink !== undefined) sinks[d.drv]?.shamefullySendNext(d.sink)
    else if (d.sub) {
      const src = sources[d.drv]
      if (!src) return console.error(`sygnal/worker/page: no page driver named '${d.drv}' (startBridge's drivers)`)
      const stream = d.method ? src[d.method](...d.args) : src
      const listener = {next: (v: any) => post({emit: d.sub, v}), error: (e: any) => console.error(e), complete: () => {}}
      subs.set(d.sub, {stream, listener})
      stream.addListener(listener)
    } else if (d.unsub) { const s = subs.get(d.unsub); s?.stream.removeListener(s.listener); subs.delete(d.unsub) }
  }
  worker.addEventListener('message', onMessage)
  worker.start?.()

  return {
    ready,
    stats,
    stop() {
      worker.removeEventListener('message', onMessage)
      for (const t of attached) mount.removeEventListener(t, onEvent, true)
      mount.removeEventListener('compositionstart', compStart, true)
      mount.removeEventListener('compositionend', compEnd, true)
      for (const s of subs.values()) s.stream.removeListener(s.listener)
      subs.clear()
      if (frame) cancelAnimationFrame(frame)
      clearTimeout(holdTimer)
    },
  }
}

/** the user's edit of `base` (now `mine`) applied to `theirs`: at the end when typed at the end */
export function rebase(base: string, mine: string, theirs: string): string {
  if (theirs === base) return mine
  if (mine === base) return theirs
  let p = 0, s = 0
  while (p < base.length && p < mine.length && base[p] === mine[p]) p++
  while (s < base.length - p && s < mine.length - p && base[base.length - 1 - s] === mine[mine.length - 1 - s]) s++
  const removed = base.length - p - s, inserted = mine.slice(p, mine.length - s)
  if (s === 0) return theirs.slice(0, Math.max(0, theirs.length - removed)) + inserted
  const at = Math.min(p, theirs.length)
  return theirs.slice(0, at) + inserted + theirs.slice(at + removed)
}

/** a caret at `c` in `old`, in `next`: before the changed part it stays, after it keeps its distance from the end */
export function caret(old: string, next: string, c: number): number {
  if (old.length === next.length) return c
  let p = 0, s = 0
  while (p < old.length && p < next.length && old[p] === next[p]) p++
  while (s < old.length - p && s < next.length - p && old[old.length - 1 - s] === next[next.length - 1 - s]) s++
  if (c <= p) return c
  if (c >= old.length - s) return next.length - (old.length - c)
  return next.length - s
}
