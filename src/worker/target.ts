/**
 * sygnal/worker: the worker half (research: dev-plans/research/web-worker). The app renders into a
 * sygnal/host tree inside a Web Worker; this module turns the tree's changes into one message of
 * patch ops per flush (src/worker/protocol.ts), takes the page's events back, and stands in for
 * drivers that have to live on the page.
 *
 *   const target = createWorkerTarget(self)
 *   run(App, { DOM: target.driver, STORE: target.remote('STORE', ['get']), ROUTER: target.remote('ROUTER') })
 *
 * The diff reads the host tree's change tracking: every mutation moves `revision` on the node and
 * its ancestors (`attrRevision` for its own attributes, classes, style), and the walk skips every
 * subtree whose revision didn't move.
 */
import {xs} from '../index'
import {HostDocument, HostEvent, makeHostDriver, nodeId} from '../host'
import type {HostElement, HostNode, HostDriverOptions} from '../host'
import {scopeKey} from '../host/delegation'
import {OP, WIDTH} from './protocol'
import type {PageEvent, Prevent} from './protocol'

type Rec = {rev: number, arev: number, attrs?: Map<string, string>, style?: Record<string, any>, value?: string, checked?: boolean, selected?: boolean, kids?: number[], data?: string, scope?: string | null}

/** the worker side of a channel: `self` in a dedicated worker, or a MessagePort */
export interface WorkerPort {
  postMessage(message: any): void
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void
  start?(): void
}

export interface WorkerTargetOptions {
  /** the shortest gap between two messages while the app is busy, in ms (default 16: a frame) */
  frame?: number
  /** the host driver's options (extra snabbdom modules, onPatch, onError) */
  driver?: HostDriverOptions
}

export interface WorkerTargetStats {
  messages: number
  ops: number
  events: number
}

export function createWorkerTarget(port: WorkerPort, options: WorkerTargetOptions = {}) {
  const FRAME = options.frame ?? 16
  const doc = new HostDocument()
  const recs = new WeakMap<HostNode, Rec>()
  const byId = new Map<number, HostNode>()
  const bodyId = nodeId(doc.body)
  byId.set(bodyId, doc.body)
  recs.set(doc.body, {rev: -1, arev: -1, attrs: new Map(), style: {}, kids: []})
  port.postMessage({root: bodyId})

  let ops: any[] = []
  let ack = 0
  let pong = false
  let lastActive: HostElement | null = null
  let lastListen = ''
  let lastPrevent = ''
  let warned = false
  const detached = new Set<HostNode>()
  const stats: WorkerTargetStats = {messages: 0, ops: 0, events: 0}

  // ---- tree → ops ---------------------------------------------------------------------------

  const scopeOf = (el: HostElement) => el.__isolate ? scopeKey(el.__isolate) : null

  /** a node the page hasn't seen: create it, its state and its subtree (pre-order) */
  function create(n: HostNode): number {
    const id = nodeId(n)
    byId.set(id, n)
    detached.delete(n)
    if (n.nodeType === 3) {
      const data = (n as any).data
      ops.push(OP.TEXT, id, data)
      recs.set(n, {rev: n.revision, arev: n.attrRevision, data})
      return id
    }
    const el = n as HostElement
    ops.push(OP.EL, id, el.localName)
    for (const [k, v] of el.attributes) ops.push(OP.ATTR, id, k, v)
    const style = {...el.style}
    for (const k in style) ops.push(OP.STYLE, id, k, style[k])
    if (el.value !== '') ops.push(OP.PROP, id, 'value', el.value)
    if (el.checked) ops.push(OP.PROP, id, 'checked', true)
    if (el.selected) ops.push(OP.PROP, id, 'selected', true)
    const scope = scopeOf(el)
    if (scope !== null) ops.push(OP.SCOPE, id, scope)
    const kids = el.childNodes.map(create)
    if (kids.length) ops.push(OP.KIDS, id, kids)
    recs.set(el, {rev: el.revision, arev: el.attrRevision, attrs: new Map(el.attributes), style, value: el.value, checked: el.checked, selected: el.selected, kids, scope})
    return id
  }

  /** a node the page has: send what moved since (only subtrees whose revision moved) */
  function update(n: HostNode) {
    const r = recs.get(n)!
    if (r.rev === n.revision) return
    r.rev = n.revision
    const id = nodeId(n)
    if (n.nodeType === 3) {
      const data = (n as any).data
      if (data !== r.data) { ops.push(OP.DATA, id, data); r.data = data }
      return
    }
    const el = n as HostElement
    if (r.arev !== el.attrRevision) {
      r.arev = el.attrRevision
      const old = r.attrs!
      for (const [k, v] of el.attributes) if (old.get(k) !== v) ops.push(OP.ATTR, id, k, v)
      for (const k of old.keys()) if (!el.attributes.has(k)) ops.push(OP.ATTR, id, k, null)
      r.attrs = new Map(el.attributes)
      const s = {...el.style}, os = r.style!
      for (const k in s) if (os[k] !== s[k]) ops.push(OP.STYLE, id, k, s[k])
      for (const k in os) if (!(k in s)) ops.push(OP.STYLE, id, k, null)
      r.style = s
    }
    if (el.value !== r.value) { ops.push(OP.PROP, id, 'value', el.value); r.value = el.value }
    if (el.checked !== r.checked) { ops.push(OP.PROP, id, 'checked', el.checked); r.checked = el.checked }
    if (el.selected !== r.selected) { ops.push(OP.PROP, id, 'selected', el.selected); r.selected = el.selected }
    const scope = scopeOf(el)
    if (scope !== (r.scope ?? null)) { ops.push(OP.SCOPE, id, scope); r.scope = scope }
    const old = r.kids!
    const kids: number[] = new Array(el.childNodes.length)
    let same = old.length === kids.length
    for (let i = 0; i < kids.length; i++) {
      const c = el.childNodes[i]
      // a known node (also one that moved here from a parent visited earlier this flush)
      if (recs.has(c)) { detached.delete(c); kids[i] = nodeId(c); update(c) }
      else kids[i] = create(c)
      if (same && kids[i] !== old[i]) same = false
    }
    if (!same) {
      ops.push(OP.KIDS, id, kids)
      const now = new Set(kids)
      for (const k of old) if (!now.has(k)) detached.add(byId.get(k)!)
      r.kids = kids
    }
  }

  /** the intents' declared preventDefaults (a predicate can't cross: the page never sees it) */
  function prevents(): Prevent[] {
    const out: Prevent[] = []
    for (const d of doc.delegates) {
      const pd = d.preventDefault
      if (!pd) continue
      if (typeof pd == 'function') {
        if (!warned) { warned = true; console.warn(`sygnal/worker: events('${d.type}', { preventDefault }) with a function runs in the worker, after the page's default action; use true or a pattern of event fields ({ key: 'Tab' })`) }
        continue
      }
      out.push([d.type, d.selector || '', !!d.global, d.scope || '', pd === true ? true : pd])
    }
    return out
  }

  function flush() {
    scheduled = false
    update(doc.body)
    // nodes that left a parent and didn't come back anywhere this flush: the page drops them
    if (detached.size) {
      const free: number[] = []
      const drop = (n: HostNode) => {
        byId.delete(nodeId(n)); recs.delete(n)
        if (n.nodeType === 1) for (const c of (n as HostElement).childNodes) drop(c)
      }
      for (const n of detached) if (!n.isConnected) { free.push(nodeId(n)); drop(n) }
      detached.clear()
      if (free.length) ops.push(OP.FREE, free)
    }
    if (doc.activeElement !== lastActive) {
      lastActive = doc.activeElement
      ops.push(OP.FOCUS, lastActive ? nodeId(lastActive) : 0)
    }
    const msg: any = {ops, ack}
    const types = [...new Set([...doc.delegates].map((d) => d.type))].sort().join(' ')
    if (types !== lastListen) { lastListen = types; msg.listen = types.split(' ').filter(Boolean) }
    const pd = prevents(), pdKey = JSON.stringify(pd)
    if (pdKey !== lastPrevent) { lastPrevent = pdKey; msg.prevent = pd }
    if (!ops.length && !msg.listen && !msg.prevent && !pong) return
    pong = false
    for (let i = 0; i < ops.length; i += WIDTH[ops[i]]) stats.ops++
    stats.messages++
    ops = []
    lastPost = performance.now()
    port.postMessage(msg)
  }

  // one message per flush: Sygnal's flush (and an EFFECT's writes, autoFocus) run in microtasks
  // and frames; a macrotask after the change collects all of them. Busy (a message went out less
  // than a frame ago), wait for the rest of that frame: 10k <Transition> timers firing one by one
  // made 1,160 messages of 3 ops each (research §2.1)
  let scheduled = false
  let lastPost = -Infinity
  const mc = new MessageChannel()
  mc.port1.onmessage = () => { if (scheduled) flush() }
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    const wait = lastPost + FRAME - performance.now()
    wait > 0 ? setTimeout(() => { if (scheduled) flush() }, wait) : mc.port2.postMessage(0)
  }
  doc.onChange = schedule

  // ---- page events → host events ------------------------------------------------------------

  function receiveEvent(e: PageEvent) {
    // changes the app made before this event go out first, stamped with the previous ack: the
    // page's form state below would otherwise overwrite a write not yet sent (an EFFECT's clear
    // of a field the user is already typing into again), and the page could never rebase it
    if (scheduled) flush()
    ack = e.seq
    stats.events++
    const el = byId.get(e.id) as HostElement | undefined
    if (!el || el.nodeType !== 1) return
    const r = recs.get(el)
    // the page's state first, recorded as already sent: no echo back to the page
    const st = e.state
    if (st) {
      if ('value' in st) { el.value = st.value; if (r) r.value = el.value }
      if ('checked' in st) { el.checked = !!st.checked; if (r) r.checked = el.checked }
      // (the host tree has no layout: a scroll position is the page's, readable as on the DOM)
      if ('scrollTop' in st) Object.assign(el, {scrollTop: st.scrollTop, scrollLeft: st.scrollLeft})
    }
    // focus moved on the page: the host follows without its own focus/blur events (the page's
    // come next, as events), and the page isn't told to focus what it focused
    if (e.type === 'focus' || e.type === 'focusin') { doc.activeElement = lastActive = el }
    if ((e.type === 'blur' || e.type === 'focusout') && doc.activeElement === el) { doc.activeElement = lastActive = null }
    // the page already ran the default action (typed, toggled, submitted): a plain event, never
    // activate() / pressKey(), which would do it again
    const bubbles = !/^(focus|blur|mouseenter|mouseleave|pointerenter|pointerleave|scroll|load|error)$/.test(e.type)
    el.dispatchEvent(new HostEvent(e.type, {...e.init, bubbles}))
  }

  // ---- drivers on the page ------------------------------------------------------------------

  let nextSub = 0
  const subs = new Map<number, any>()

  /** a stream the page feeds: the page subscribes to `drv` (its source, or source[method](...args)) */
  const pageStream = (drv: string, method?: string, args: any[] = []) => {
    let sid = 0
    return xs.create<any>({
      start(l) { sid = ++nextSub; subs.set(sid, l); port.postMessage({sub: sid, drv, method, args}) },
      stop() { subs.delete(sid); port.postMessage({unsub: sid}) },
    })
  }

  /**
   * A driver that stays on the page (DOM-only browser APIs, localStorage, the router). The sink's
   * values are posted to the page's driver of the same name (startBridge's `drivers`); the source
   * is a stream (no `methods`) or an object whose methods return streams (`methods: ['get']`).
   * Arguments and values must be structured-cloneable.
   */
  function remote(drv: string, methods?: string[]) {
    return (sink$: any) => {
      sink$.addListener({next: (v: any) => port.postMessage({drv, sink: v}), error: () => {}, complete: () => {}})
      if (!methods) return pageStream(drv)
      const src: any = {}
      for (const m of methods) src[m] = (...args: any[]) => pageStream(drv, m, args)
      return src
    }
  }

  port.addEventListener('message', (m: MessageEvent) => {
    const d = m.data
    if (!d || typeof d != 'object') return
    if (d.ev) for (const e of d.ev) receiveEvent(e)
    else if (d.ping) { pong = true; schedule() }
    else if (d.emit) subs.get(d.emit)?.next(d.v)
  })
  port.start?.()

  return {
    /** the DOM driver: pass it as `DOM` to run() */
    driver: makeHostDriver(doc, options.driver),
    remote,
    /** send the pending changes now (they otherwise go out after the current task) */
    flush: () => { if (scheduled) flush() },
    /** the host tree the app renders into */
    doc,
    stats,
  }
}
