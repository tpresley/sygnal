/**
 * The page half of the spike: applies the worker's patch ops to the real DOM, forwards the events
 * the app listens for (with the target's form state), makes the decisions that can't wait for the
 * worker (preventDefault), and hosts the drivers that need the page (localStorage, the router,
 * DOM-only browser APIs). It imports no Sygnal: only xstream, for the page-side drivers' sinks.
 *
 *   startBridge(new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }), root, {
 *     drivers: { STORE: localStorageDriver, ROUTER: routerDriver },
 *   })
 */
import xs from 'xstream'

export interface BridgeOptions {
  /** drivers that run on the page; the worker uses target.remote(name) for each */
  drivers?: Record<string, (sink$: any) => any>
  /**
   * Events whose default action is cancelled on the page, synchronously: [type, selector] pairs
   * (selector matched with closest() from the target; '*' for any). Default: [['submit', '*']]:
   * a Sygnal form (processForm) never wants the browser's submit, and the worker's
   * e.preventDefault() comes too late.
   */
  preventDefault?: [string, string][]
  /** count messages and bytes on both sides (window.__bridge.stats; slows both down: measurement only) */
  stats?: boolean
  /** called after each batch of ops is applied (tests, measurement) */
  onApply?: (ops: number) => void
}

const INIT_KEYS = ['key', 'code', 'keyCode', 'which', 'charCode', 'shiftKey', 'ctrlKey', 'altKey', 'metaKey', 'repeat',
  'button', 'buttons', 'clientX', 'clientY', 'pageX', 'pageY', 'offsetX', 'offsetY', 'deltaX', 'deltaY', 'deltaMode',
  'detail', 'inputType', 'data', 'isComposing', 'pointerId', 'pointerType']
// always forwarded: the host tree's copy of field values and focus must follow the page even when
// no intent listens (processForm reads the worker's form on submit)
const ALWAYS = ['input', 'change', 'focus', 'blur']

export function startBridge(worker: Worker, mount: Element, options: BridgeOptions = {}) {
  const nodes = new Map<number, Node>()
  const idOf = new WeakMap<Node, number>()
  // per field: the values the page sent with its events since the worker's last ack ([seq, value]),
  // the base of a rebase when a worker value arrives that is older than the user's typing
  const sent = new WeakMap<Node, [number, string][]>()
  const composing = new WeakSet<Node>()
  const pd = options.preventDefault || [['submit', '*']]
  const listening = new Set<string>()
  const stats = {in: 0, inBytes: 0, out: 0, outBytes: 0, ops: 0, applyMs: 0}
  let seq = 0
  let applying = false

  const post = (m: any) => {
    if (options.stats) { stats.out++; stats.outBytes += JSON.stringify(m).length }
    worker.postMessage(m)
  }

  // ---- ops → DOM ----------------------------------------------------------------------------

  function apply(ops: any[], ack: number) {
    applying = true
    let n = 0
    try {
      for (let i = 0; i < ops.length; n++) {
        switch (ops[i]) {
          case 0: { const el = document.createElement(ops[i + 2]); nodes.set(ops[i + 1], el); idOf.set(el, ops[i + 1]); i += 3; break }
          case 1: { const t = document.createTextNode(ops[i + 2]); nodes.set(ops[i + 1], t); i += 3; break }
          case 2: { kids(nodes.get(ops[i + 1]) as Element, ops[i + 2]); i += 3; break }
          case 3: { const el = nodes.get(ops[i + 1]) as Element, v = ops[i + 3]; v == null ? el.removeAttribute(ops[i + 2]) : el.setAttribute(ops[i + 2], v); i += 4; break }
          case 4: { prop(nodes.get(ops[i + 1]) as any, ops[i + 2], ops[i + 3], ack); i += 4; break }
          case 5: { (nodes.get(ops[i + 1]) as Text).data = ops[i + 2]; i += 3; break }
          case 6: {
            const s = (nodes.get(ops[i + 1]) as HTMLElement).style, k: string = ops[i + 2], v = ops[i + 3]
            if (k.startsWith('--')) v == null ? s.removeProperty(k) : s.setProperty(k, v)
            else (s as any)[k] = v == null ? '' : v
            i += 4; break
          }
          case 7: {
            const el = nodes.get(ops[i + 1]) as HTMLElement | undefined
            el ? el.focus() : (document.activeElement as HTMLElement | null)?.blur()
            i += 2; break
          }
          case 8: { for (const id of ops[i + 1]) nodes.delete(id); i += 2; break }
          default: throw new Error('bridge: unknown op ' + ops[i])
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
   * Deferred while an IME composes.
   */
  function prop(el: any, k: string, v: any, ack: number) {
    if (composing.has(el)) return
    const log = sent.get(el)
    if (k === 'value' && log && log.length && log[log.length - 1][0] > ack) {
      let i = 0
      while (i + 1 < log.length && log[i + 1][0] <= ack) i++
      const base = log[i][0] <= ack ? log[i][1] : v
      log.splice(0, i)
      const next = rebase(base, el.value, v)
      if (next !== el.value) {
        el.value = next
        // the worker's copy follows (its events carried the pre-rebase text)
        post({sync: [[idOf.get(el), next]]})
      }
      return
    }
    if (log) log.length = 0
    if (el[k] !== v) el[k] = v
  }
  // ---- DOM events → worker ------------------------------------------------------------------

  function onEvent(e: Event) {
    // focus moves the bridge itself made (autoFocus in the worker) aren't news to the worker
    if (applying && (e.type === 'focus' || e.type === 'blur')) return
    let el = e.target as Node | null
    while (el && !idOf.has(el)) el = el.parentNode
    if (!el) return
    const t = e.target as any
    for (const [type, sel] of pd) if (type === e.type && (sel === '*' || t.closest?.(sel))) e.preventDefault()
    if (!listening.has(e.type) && !ALWAYS.includes(e.type)) return
    const s = ++seq
    const init: Record<string, any> = {}
    for (const k of INIT_KEYS) if ((e as any)[k] !== undefined) init[k] = (e as any)[k]
    const ev: any = {seq: s, type: e.type, id: idOf.get(el), init}
    if ('value' in t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) {
      ev.state = t.type === 'checkbox' || t.type === 'radio' ? {value: t.value, checked: t.checked} : {value: t.value}
      if (e.type === 'input' || e.type === 'change') {
        let log = sent.get(t)
        if (!log) sent.set(t, log = [])
        log.push([s, t.value])
      }
    }
    post({ev: [ev]})
  }
  /** the user's edit of `base` (now `mine`) applied to `theirs`: at the end when typed at the end */
  function rebase(base: string, mine: string, theirs: string) {
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

  const listen = (type: string) => {
    if (listening.has(type) || ALWAYS.includes(type)) return
    listening.add(type)
    mount.addEventListener(type, onEvent, true)
  }
  for (const t of ALWAYS) mount.addEventListener(t, onEvent, true)
  for (const [t] of pd) mount.addEventListener(t, onEvent, true)
  mount.addEventListener('compositionstart', (e) => composing.add(e.target as Node), true)
  mount.addEventListener('compositionend', (e) => composing.delete(e.target as Node), true)

  // ---- drivers on the page ------------------------------------------------------------------

  const sinks: Record<string, any> = {}
  const sources: Record<string, any> = {}
  for (const [name, driver] of Object.entries(options.drivers || {})) {
    sinks[name] = xs.create()
    sources[name] = driver(sinks[name])
  }
  const subs = new Map<number, {stream: any, listener: any}>()

  worker.addEventListener('message', (m: MessageEvent) => {
    const d = m.data
    if (options.stats) { stats.in++; stats.inBytes += JSON.stringify(d).length }
    if (d.ops) {
      const t0 = performance.now()
      if (d.listen) for (const t of d.listen) listen(t)
      const n = apply(d.ops, d.ack)
      stats.ops += n
      stats.applyMs += performance.now() - t0
      options.onApply?.(n)
    } else if (d.root) { nodes.set(d.root, mount); idOf.set(mount, d.root) }
    else if (d.sink !== undefined) sinks[d.drv].shamefullySendNext(d.sink)
    else if (d.sub) {
      const src = sources[d.drv]
      const stream = d.method ? src[d.method](...d.args) : src
      const listener = {next: (v: any) => post({emit: d.sub, v}), error: (e: any) => console.error(e), complete: () => {}}
      subs.set(d.sub, {stream, listener})
      stream.addListener(listener)
    } else if (d.unsub) { const s = subs.get(d.unsub); s?.stream.removeListener(s.listener); subs.delete(d.unsub) }
    else if (d.call) {
      const el: any = nodes.get(d.id)
      try {
        let v = el[d.method](...d.args)
        if (v && typeof v.toJSON == 'function') v = v.toJSON()
        post({ret: d.call, v: v === undefined ? null : v})
      } catch (e: any) { post({ret: d.call, error: String(e?.message || e)}) }
    } else if (d.stats) (window as any).__workerStats = d.stats
  })

  if (options.stats) worker.postMessage({stats: 'on'})
  const api = {stats, nodes, worker, reset() { Object.assign(stats, {in: 0, inBytes: 0, out: 0, outBytes: 0, ops: 0, applyMs: 0}) }}
  ;(window as any).__bridge = api
  return api
}
