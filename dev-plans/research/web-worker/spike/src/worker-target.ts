/**
 * The worker half of the spike: a Sygnal app renders into a sygnal/host tree inside a Web Worker,
 * and this module turns that tree's changes into one message of patch ops per flush, takes the
 * page's events back, and stands in for drivers that have to live on the page.
 *
 *   const target = createWorkerTarget(self)
 *   run(App, { DOM: target.driver, STORE: target.remote('STORE', ['get']), ROUTER: target.remote('ROUTER') })
 *
 * Wire format (worker → page), one message per flush: { ops, ack, listen? }
 *   ops    flat tuples, ids are nodeId()s (the body is the page's mount element)
 *   ack    the last page event sequence number handled before these ops were made (the page drops
 *          a stale value write to a field the user has typed into since: see bridge.ts)
 *   listen the event types the app's intents listen for, when that set changed
 */
import {xs} from 'sygnal'
import {HostDocument, HostEvent, makeHostDriver, nodeId} from 'sygnal/host'
import type {HostElement, HostNode} from 'sygnal/host'

export const OP = {
  EL: 0,       // [0, id, tag]
  TEXT: 1,     // [1, id, data]
  KIDS: 2,     // [2, parentId, childIds]
  ATTR: 3,     // [3, id, name, value | null]
  PROP: 4,     // [4, id, 'value' | 'checked' | 'selected', value]
  DATA: 5,     // [5, id, data]
  STYLE: 6,    // [6, id, key, value | null]
  FOCUS: 7,    // [7, id | 0]
  FREE: 8,     // [8, ids]
} as const

type Rec = {rev: number, arev: number, attrs?: Map<string, string>, style?: Record<string, any>, value?: string, checked?: boolean, selected?: boolean, kids?: number[], data?: string}

export interface PageEvent {
  seq: number
  type: string
  id: number
  init: Record<string, any>
  /** the target's form state on the page when the event fired (value, checked) */
  state?: {value?: string, checked?: boolean}
}

export interface WorkerTargetOptions {
  /** count posted messages and their JSON size (for measurement) */
  stats?: boolean
}

export function createWorkerTarget(port: {postMessage(m: any): void, addEventListener(t: 'message', f: (e: MessageEvent) => void): void}, options: WorkerTargetOptions = {}) {
  const doc = new HostDocument()
  const recs = new WeakMap<HostNode, Rec>()
  const byId = new Map<number, HostNode>()
  const bodyId = nodeId(doc.body)
  byId.set(bodyId, doc.body)
  recs.set(doc.body, {rev: -1, arev: -1, attrs: new Map(), style: {}, kids: []})
  // the page maps this id to its mount element
  port.postMessage({root: bodyId})

  let ops: any[] = []
  let ack = 0
  let lastActive: HostElement | null = null
  let lastListen = ''
  const detached = new Set<HostNode>()
  const stats = {messages: 0, bytes: 0, ops: 0, flushMs: 0}

  // ---- tree → ops ---------------------------------------------------------------------------

  const snapshotAttrs = (el: HostElement) => new Map(el.attributes)
  const snapshotStyle = (el: HostElement) => ({...el.style})

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
    const style = snapshotStyle(el)
    for (const k in style) ops.push(OP.STYLE, id, k, style[k])
    if (el.value !== '') ops.push(OP.PROP, id, 'value', el.value)
    if (el.checked) ops.push(OP.PROP, id, 'checked', true)
    if (el.selected) ops.push(OP.PROP, id, 'selected', true)
    const kids = el.childNodes.map(create)
    if (kids.length) ops.push(OP.KIDS, id, kids)
    recs.set(el, {rev: el.revision, arev: el.attrRevision, attrs: snapshotAttrs(el), style, value: el.value, checked: el.checked, selected: el.selected, kids})
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
      r.attrs = snapshotAttrs(el)
      const s = snapshotStyle(el), os = r.style!
      for (const k in s) if (os[k] !== s[k]) ops.push(OP.STYLE, id, k, s[k])
      for (const k in os) if (!(k in s)) ops.push(OP.STYLE, id, k, null)
      r.style = s
    }
    if (el.value !== r.value) { ops.push(OP.PROP, id, 'value', el.value); r.value = el.value }
    if (el.checked !== r.checked) { ops.push(OP.PROP, id, 'checked', el.checked); r.checked = el.checked }
    if (el.selected !== r.selected) { ops.push(OP.PROP, id, 'selected', el.selected); r.selected = el.selected }
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

  function flush() {
    scheduled = false
    const t0 = performance.now()
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
    const types = [...new Set([...doc.delegates].map((d) => d.type))].sort().join(' ')
    const msg: any = {ops, ack}
    if (types !== lastListen) { lastListen = types; msg.listen = types.split(' ').filter(Boolean) }
    if (!ops.length && !msg.listen) return
    ops = []
    if (options.stats) {
      stats.messages++; stats.ops += countOps(msg.ops); stats.bytes += JSON.stringify(msg).length
      stats.flushMs += performance.now() - t0
    }
    port.postMessage(msg)
  }

  // one message per flush: Sygnal's flush (and an EFFECT's writes, autoFocus) run in microtasks
  // and frames; a macrotask after the change collects all of them
  let scheduled = false
  const mc = new MessageChannel()
  mc.port1.onmessage = flush
  doc.onChange = () => { if (!scheduled) { scheduled = true; mc.port2.postMessage(0) } }

  // ---- page events → host events ------------------------------------------------------------

  function receiveEvent(e: PageEvent) {
    // changes the app made before this event go out first, stamped with the previous ack: the
    // page's form state below would otherwise overwrite a write not yet sent (an EFFECT's clear
    // of a field the user is already typing into again), and the page could never rebase it
    if (scheduled) flush()
    ack = e.seq
    const el = byId.get(e.id) as HostElement | undefined
    if (!el || el.nodeType !== 1) return
    const r = recs.get(el)
    // the page's form state first, recorded as already sent: no echo back to the page
    if (e.state) {
      if ('value' in e.state) { el.value = e.state.value; if (r) r.value = el.value }
      if ('checked' in e.state) { el.checked = !!e.state.checked; if (r) r.checked = el.checked }
    }
    // focus moved on the page: the host follows without its own focus/blur events (the page's
    // come next, as events), and the page isn't told to focus what it focused
    if (e.type === 'focus' || e.type === 'focusin') { doc.activeElement = lastActive = el }
    if ((e.type === 'blur' || e.type === 'focusout') && doc.activeElement === el) { doc.activeElement = lastActive = null }
    // the page already ran the default action (typed, toggled, submitted): a plain event, never
    // activate() / pressKey(), which would do it again
    const bubbles = !(e.type === 'focus' || e.type === 'blur' || e.type === 'mouseenter' || e.type === 'mouseleave')
    el.dispatchEvent(new HostEvent(e.type, {...e.init, bubbles}))
  }

  // ---- drivers on the page ------------------------------------------------------------------

  let nextSub = 0
  const subs = new Map<number, any>()
  const calls = new Map<number, {resolve: (v: any) => void, reject: (e: any) => void}>()

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
   * values are posted to the page's driver of the same name; the source is a stream (no
   * `methods`) or an object whose methods return streams (`methods: ['get']`). Arguments and
   * values must be structured-cloneable.
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

  /** an element command or measurement on the page's element (async: a promise of the result) */
  function call(el: HostElement, method: string, ...args: any[]): Promise<any> {
    flush() // the element must exist on the page first
    const cid = ++nextSub
    return new Promise((resolve, reject) => {
      calls.set(cid, {resolve, reject})
      port.postMessage({call: cid, id: nodeId(el), method, args})
    })
  }

  port.addEventListener('message', (m: MessageEvent) => {
    const d = m.data
    if (d.ev) for (const e of d.ev) receiveEvent(e)
    else if (d.sync) for (const [id, value] of d.sync) {
      // a rebased field value: the page's text, already on screen
      const el = byId.get(id) as HostElement | undefined, r = el && recs.get(el)
      if (el) { el.value = value; if (r) r.value = el.value }
    }
    else if (d.emit) subs.get(d.emit)?.next(d.v)
    else if (d.ret) { const c = calls.get(d.ret); calls.delete(d.ret); d.error ? c?.reject(new Error(d.error)) : c?.resolve(d.v) }
    else if (d.stats) port.postMessage({stats: {...stats}})
  })

  return {doc, driver: makeHostDriver(doc), remote, call, flush, stats}
}

function countOps(ops: any[]) {
  // tuple widths per opcode
  const w = [3, 3, 3, 4, 4, 3, 4, 2, 2]
  let n = 0
  for (let i = 0; i < ops.length; i += w[ops[i]]) n++
  return n
}
