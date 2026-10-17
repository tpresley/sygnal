/**
 * The live host adapter (PLAN-10 W-1): what `sygnal-check --graph=html --watch` adds to the page.
 * html.js inlines it only when `meta.live` is set (see model.js for the inlining rules: top-level
 * `export` declarations, no imports).
 *
 *   graphChanges(prev, next) → { added, removed, changed }   component keys (pure, tested in Node)
 *   mountLive(V, api, graph, META)
 *     api    mountPage()'s API (setGraph keeps the view, selection, trace and search by key)
 *     graph  the graph the page was rendered with
 *     META   { live: { events: '/events', version } }: the SSE stream (the page's own query, which
 *            holds the token, is appended) and the version the page was rendered with
 *
 * The header gets "live · updated hh:mm:ss" ("reconnecting…" on a stream error, "disconnected ·
 * showing the last graph" after 5 s without the server: the page keeps working as a static one).
 * After an update, cards (and their sidebar entries) of components added or changed since the last
 * graph are marked for 4 s, and removed ones are named in a toast.
 */

/** A component's JSON without what moves when lines move (ids are 'file:line', locations). */
const MOVING = new Set(['id', 'parentId', 'componentId', 'line', 'column', 'endLine', 'endColumn', 'modelAt', 'emitterIds', 'selectorIds'])
function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (!value || typeof value !== 'object') return value
  const out = {}
  for (const k of Object.keys(value)) if (!MOVING.has(k)) out[k] = stable(value[k])
  return out
}

export function graphChanges(prev, next) {
  const index = (g) => {
    const m = new Map()
    for (const c of g?.components || []) if (c.key != null && !m.has(c.key)) m.set(c.key, c)
    return m
  }
  const a = index(prev), b = index(next)
  const added = [], removed = [], changed = []
  for (const [k, c] of b) {
    if (!a.has(k)) added.push(k)
    else if (JSON.stringify(stable(a.get(k))) !== JSON.stringify(stable(c))) changed.push(k)
  }
  for (const k of a.keys()) if (!b.has(k)) removed.push(k)
  return { added, removed, changed }
}

const LIVE_CSS = `
.live-ind { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); white-space: nowrap; }
.live-ind::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--ok); }
.live-ind[data-state="reconnecting"]::before { background: var(--warn); }
.live-ind[data-state="disconnected"]::before { background: var(--faint, var(--muted)); }
.live-ind .bad { color: var(--warn); }
.node.live-added .box { stroke: var(--ok); stroke-width: 3; }
.node.live-changed .box { stroke: var(--warn); stroke-width: 3; }
.tree-item.live-added { box-shadow: inset 3px 0 0 var(--ok); }
.tree-item.live-changed { box-shadow: inset 3px 0 0 var(--warn); }
@media (max-width: 720px) { .live-ind .when { display: none; } }
`

export function mountLive(V, api, graph, META) {
  const doc = document
  const live = META.live || {}
  const style = doc.createElement('style')
  style.textContent = LIVE_CSS
  doc.head.appendChild(style)
  const ind = doc.createElement('span')
  ind.className = 'live-ind'
  ind.id = 'live'
  ind.setAttribute('role', 'status')
  const brand = doc.querySelector('header .brand')
  brand ? brand.after(ind) : doc.body.prepend(ind)

  let prev = graph, version = live.version ?? null, updated = new Date(), state = 'live', lostTimer = 0, markTimer = 0
  const two = (n) => String(n).padStart(2, '0')
  const hms = (d) => `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
  const unparsed = (g) => (g?.diagnostics || []).filter(d => d.code === 'SYG900' && /^could not parse file/.test(d.message || '')).map(d => d.file)
  function show() {
    ind.dataset.state = state
    const bad = unparsed(prev)
    const text = state === 'live' ? `live <span class="when">· updated ${hms(updated)}</span>`
      : state === 'reconnecting' ? 'reconnecting…' : 'disconnected · showing the last graph'
    const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
    ind.innerHTML = text + (bad.length ? ` <span class="bad" title="${esc(bad.join(', '))}">· ${bad.length === 1 ? esc(bad[0].split('/').pop()) + ' doesn’t parse' : bad.length + ' files don’t parse'}: last good version shown</span>` : '')
    ind.title = state === 'live' ? `Updates when a file is saved (graph v${version ?? '?'})` : ''
  }
  show()

  function mark(changes) {
    clearTimeout(markTimer)
    doc.querySelectorAll('.live-added, .live-changed').forEach(e => e.classList.remove('live-added', 'live-changed'))
    const byKey = api.model.byKey
    const add = (keys, cls) => {
      for (const k of keys) {
        const id = byKey.get(k)
        if (id == null) continue
        for (const e of doc.querySelectorAll('.node[data-id], .tree-item[data-id]')) if (e.dataset.id === id) e.classList.add(cls)
      }
    }
    add(changes.added, 'live-added')
    add(changes.changed, 'live-changed')
    markTimer = setTimeout(() => doc.querySelectorAll('.live-added, .live-changed').forEach(e => e.classList.remove('live-added', 'live-changed')), 4000)
  }
  function toast(msg) {
    const t = doc.getElementById('toast')
    if (!t) return
    t.textContent = msg
    t.classList.add('on')
    setTimeout(() => t.classList.remove('on'), 2400)
  }

  function apply(next, fresh, id) {
    const changes = V.graphChanges(prev, next)
    const selKey = api.selectedKey
    api.setGraph(fresh) // its own copy: the page's model may annotate it
    prev = next
    version = id
    updated = new Date()
    mark(changes)
    const nameOf = (k) => String(k).split('#')[1] || k
    if (selKey && changes.removed.includes(selKey)) toast(`${nameOf(selKey)} was removed: nothing selected`)
    else if (changes.removed.length) toast(`Removed: ${changes.removed.map(nameOf).join(', ')}`)
    const status = doc.getElementById('status')
    const n = changes.added.length + changes.changed.length + changes.removed.length
    if (status) status.textContent = `Graph updated${n ? `: ${changes.added.length} added, ${changes.changed.length} changed, ${changes.removed.length} removed` : ''}`
  }

  if (typeof EventSource !== 'function' || !live.events) { state = 'disconnected'; show(); return null }
  const es = new EventSource(live.events + location.search)
  es.addEventListener('graph', (e) => {
    clearTimeout(lostTimer); lostTimer = 0
    state = 'live'
    const id = Number(e.lastEventId)
    if (id !== version) {
      let next = null
      try { next = JSON.parse(e.data) } catch (_) { /* a broken event: keep the graph */ }
      if (next && Array.isArray(next.components)) apply(next, JSON.parse(e.data), id)
    }
    show()
  })
  es.addEventListener('open', () => { clearTimeout(lostTimer); lostTimer = 0; state = 'live'; show() })
  es.addEventListener('error', () => {
    if (state === 'disconnected') return
    state = 'reconnecting'
    show()
    if (!lostTimer) lostTimer = setTimeout(() => { state = 'disconnected'; show() }, 5000)
  })
  const handle = { get version() { return version }, get state() { return state }, close: () => es.close() }
  window.__sygnalLive = handle
  return handle
}
