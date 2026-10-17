/**
 * "Live data" (PLAN-10 P-2, D544): runtime data from the open app tabs over the static graph, on the
 * page sygnal/vite serves at `/__sygnal/graph` (W-2). html.js inlines it only when `meta.appData` is
 * set (see model.js for the inlining rules: top-level `export` declarations, no imports).
 *
 *   overlayRuntime(graph, runtime) → the static graph with runtime data on its cards (pure)
 *     A runtime instance (inspect(): `source: 'runtime'`) joins the static component with the same
 *     `key` (sygnal/vite stamps the static 'file#name' key on component functions in dev, so the
 *     runtime has it); an instance without a key joins by name when exactly one static component
 *     has that name (else it is `ambiguous`). Each joined card gets runtime.js's `rt`
 *     ({ count, instances, recent, raw }: ×N, recent action counts, instances with state in the
 *     detail panel) and `shown: false` when every instance is hidden; a static card with no
 *     instance gets `mounted: false` (drawn faded). The graph gets `rtCardOf` (instance id → card
 *     id: flashes, state) and `liveData: { instances, matched, unmatched, ambiguous }` (names).
 *   mountLiveData(V, api, graph, META)
 *     META.appData = { channel }: the BroadcastChannel the app tabs answer on (sygnal's
 *     installGraphBridge, 'sygnal/devtools'; same origin only, so only this dev server's tabs).
 *     Adds a "Live data" toggle to the header: disabled while no app tab is connected (or the one
 *     connected has no runtime diagnostics), on by default once one is. It follows the most recently
 *     loaded or focused app tab, overlays its inspect() graph, flashes a card when one of its
 *     actions runs and fetches an instance's state for the detail panel (`api.host`). It wraps
 *     `api.setGraph`, so a new static graph (live mode's SSE) keeps the overlay.
 *
 * Protocol (every message has `v: 1`): the page sends { type: 'who', watch } every 2 s and
 * { type: 'get-state', tab, req, id }; an app tab sends 'here' { tab, url, title, at, ok },
 * 'graph' { tab, graph }, 'action' { tab, record }, 'state' { tab, req, id, value?, error? } and
 * 'bye' { tab }. A tab not heard from for 5 s is gone.
 */

const RT_KEEP = ['id', 'stateKeys', 'app', 'shown', 'resources']

export function overlayRuntime(graph, runtime) {
  const comps = graph?.components || []
  const byKey = new Map(), byName = new Map()
  for (const c of comps) {
    if (c.key != null && !byKey.has(c.key)) byKey.set(c.key, c)
    if (!byName.has(c.name)) byName.set(c.name, [])
    byName.get(c.name).push(c)
  }
  const joined = new Map() // static id → runtime instances
  const cardOf = {}
  const unmatched = [], ambiguous = []
  const note = (list, name) => { if (!list.includes(name)) list.push(name) }
  const insts = runtime?.components || []
  for (const i of insts) {
    let c = null
    if (i.key != null) c = byKey.get(i.key) || null
    else {
      const same = byName.get(i.name) || []
      if (same.length === 1) c = same[0]
      else if (same.length > 1) { note(ambiguous, i.name); continue }
    }
    if (!c) { note(unmatched, i.name); continue }
    if (!joined.has(c.id)) joined.set(c.id, [])
    joined.get(c.id).push(i)
    cardOf[String(i.id)] = c.id
  }
  const recent = new Map()
  for (const a of runtime?.recentActions || []) {
    const id = cardOf[String(a.instance)]
    if (id == null) continue
    const r = recent.get(id) || {}
    r[a.type] = (r[a.type] || 0) + 1
    recent.set(id, r)
  }
  const out = comps.map(c => {
    const list = joined.get(c.id)
    if (!list) return { ...c, mounted: false }
    const instances = list.map(i => {
      const o = {}
      for (const k of RT_KEEP) if (i[k] !== undefined) o[k] = k === 'id' ? String(i[k]) : i[k]
      if (!o.stateKeys) o.stateKeys = []
      return o
    })
    const card = { ...c, rt: { count: list.length, instances, recent: recent.get(c.id) || {}, raw: list } }
    if (instances.every(i => i.shown === false)) card.shown = false
    return card
  })
  return {
    ...graph, components: out, rtCardOf: cardOf,
    liveData: { instances: insts.length, matched: Object.keys(cardOf).length, unmatched, ambiguous },
  }
}

const LIVE_DATA_CSS = `
.node.unmounted { opacity: .38; }
.node.unmounted:hover, .node.unmounted.sel, .node.unmounted:focus { opacity: .8; }
#t-livedata .sw { background: var(--muted); }
#t-livedata[aria-pressed="true"] .sw { background: var(--ok); }
#t-livedata:disabled { opacity: .55; cursor: default; }
`

export function mountLiveData(V, api, graph, META) {
  const doc = document
  const cfg = META.appData || {}
  if (typeof BroadcastChannel !== 'function' || !cfg.channel) return null
  const style = doc.createElement('style')
  style.textContent = LIVE_DATA_CSS
  doc.head.appendChild(style)
  const btn = doc.createElement('button')
  btn.type = 'button'
  btn.className = 'toggle'
  btn.id = 't-livedata'
  btn.innerHTML = '<span class="sw"></span><span class="lbl">Live data</span>'
  const group = doc.querySelector('header .toggles')
  if (group) group.prepend(btn); else (doc.querySelector('header') || doc.body).appendChild(btn)

  const bc = new BroadcastChannel(cfg.channel)
  const tabs = new Map() // tab → { url, title, at, ok, seen }
  let base = graph, rt = null, on = true, current = null, req = 0, overlay = null
  const pending = new Map()
  const raw = api.setGraph
  const active = () => on && current != null && rt != null
  const draw = () => { overlay = active() ? V.overlayRuntime(base, rt) : null; raw(overlay || base) }
  api.setGraph = (g) => { base = g; draw() }
  const post = (m) => { try { bc.postMessage({ v: 1, ...m }) } catch (_) { /* closed */ } }
  const say = (text) => { const s = doc.getElementById('status'); if (s) s.textContent = text }

  const host = {
    getState(id) {
      if (current == null) return undefined
      const n = ++req
      post({ type: 'get-state', tab: current, req: n, id: String(id) })
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => { pending.delete(n); reject(new Error('no answer')) }, 3000)
        pending.set(n, (m) => { clearTimeout(t); pending.delete(n); m.error ? reject(new Error(m.error)) : resolve(m.value) })
      })
    },
  }

  function show() {
    const tab = current != null ? tabs.get(current) : null
    const any = [...tabs.values()]
    btn.disabled = !tab || !tab.ok
    btn.setAttribute('aria-pressed', String(!btn.disabled && on))
    const sum = overlay?.liveData
    btn.title = !any.length ? 'Live data: no app tab is connected (open the app from this dev server in another tab)'
      : !tab || !tab.ok ? "Live data: the app tab has no runtime diagnostics (sygnal({ diagnostics: 'off' }))"
      : `Live data from ${tab.title || tab.url}${any.length > 1 ? ` (the most recently focused of ${any.length} tabs)` : ''}` +
        (sum ? `: ${sum.instances} instances${sum.unmatched.length ? `; not in the scanned files: ${sum.unmatched.join(', ')}` : ''}${sum.ambiguous.length ? `; ambiguous names: ${sum.ambiguous.join(', ')}` : ''}` : '')
    api.host = active() ? host : null
  }

  function pick() {
    let best = null
    for (const [id, t] of tabs) {
      const b = best && tabs.get(best)
      if (!b || (t.ok && !b.ok) || (t.ok === b.ok && t.at > b.at)) best = id
    }
    if (best !== current) {
      const was = current
      current = best
      rt = null
      if (current != null) post({ type: 'who', watch: current })
      if (was != null || current == null) draw()
      say(current != null ? `Live data: connected to ${tabs.get(current).title || tabs.get(current).url}` : 'Live data: no app tab connected')
    }
    show()
  }

  bc.onmessage = (e) => {
    const m = e && e.data
    if (!m || m.v !== 1 || typeof m.type !== 'string' || m.tab == null) return
    if (m.type === 'here') {
      tabs.set(m.tab, { url: String(m.url || ''), title: String(m.title || ''), at: Number(m.at) || 0, ok: m.ok === true, seen: Date.now() })
      pick()
    } else if (m.type === 'bye') {
      tabs.delete(m.tab)
      pick()
    } else if (m.tab !== current) {
      // another tab's data: not shown
    } else if (m.type === 'graph') {
      if (m.graph && Array.isArray(m.graph.components)) { rt = m.graph; if (on) draw(); show() }
    } else if (m.type === 'action') {
      if (active() && m.record) api.action(m.record)
    } else if (m.type === 'state') {
      pending.get(m.req)?.(m)
    }
  }

  btn.addEventListener('click', () => {
    if (btn.disabled) return
    on = !on
    draw()
    show()
    say(on ? 'Live data on' : 'Live data off: the static graph only')
  })

  const tick = () => {
    const now = Date.now()
    let gone = false
    for (const [id, t] of tabs) if (now - t.seen > 5000) { tabs.delete(id); gone = true }
    if (gone) pick()
    post({ type: 'who', ...(current != null ? { watch: current } : {}) })
  }
  const timer = setInterval(tick, 2000)
  show()
  post({ type: 'who' })

  const handle = {
    get connected() { return current != null },
    get on() { return active() },
    get tab() { return current != null ? { id: current, ...tabs.get(current) } : null },
    get tabs() { return tabs.size },
    get summary() { return overlay?.liveData || null },
    set(value) { if (!!value !== on) btn.click() },
    close() { clearInterval(timer); bc.close() },
  }
  window.__sygnalLiveData = handle
  return handle
}
