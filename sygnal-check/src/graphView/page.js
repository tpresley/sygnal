/**
 * The page's DOM layer (PLAN-10 V-1, V-5): draws what model.js and layout.js computed and wires
 * selection, trace, search, overlays, pan / zoom, the keyboard and export. Everything it shows
 * comes from the graph; it runs no app code and makes no network request.
 *
 *   mountPage(V, G, META)
 *     V     the pure modules' exports (buildModel, healthList, layoutGraph, edgePaths, bbox,
 *           toMermaid, …), as html.js inlines them
 *     G     the InspectGraph
 *     META  { title, subtitle?, root?, editor?, select?, codes?: { SYGnnn: title }, base? }
 *
 * With META.base ({ ref, commit?, graph }: `--base <ref>`, PLAN-10 V-6) the page draws the diff
 * (diff.js's diffModel): removed components as faded cards, added / removed / changed marks on cards,
 * edges, folded groups and the outline, a "Changes" section in the sidebar and the detail panel, and
 * the "Changes only" filter. Health and counts are the head graph's.
 *
 * A runtime graph (`source: 'runtime'`, V-3) goes through runtime.js's fromRuntime() first: cards
 * ×N, instances and their state in the detail panel. Hosts (the devtools panel) set
 * `__sygnalGraph.host = { getState(instanceId) → value | Promise }` and call `action(record)` (a flash
 * on the instance's card), `state(instanceId, value)` (a state changed) and `setGraph(graph)`.
 *
 * Keyboard: Tab reaches the canvas (one card at a time is in the tab order); arrow keys move along
 * render edges (up: a parent, down: a child, left / right: the next card in the row); Enter or
 * Space selects; `/` focuses search, `F` fits, Esc clears. The component list in the sidebar is
 * the same graph as a list of buttons (the screen-reader view).
 *
 * html.js inlines this file (see model.js): keep to top-level `export function` declarations.
 */
export function mountPage(V, G, META) {
  const doc = document
  const $ = (id) => doc.getElementById(id)
  const SVGNS = 'http://www.w3.org/2000/svg'
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const store = {
    get(k, d) { try { return localStorage.getItem('sygnal-graph:' + k) ?? d } catch (_) { return d } },
    set(k, v) { try { localStorage.setItem('sygnal-graph:' + k, v) } catch (_) { /* storage blocked */ } },
  }
  const reduceMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches } catch (_) { return false } }

  const KIND = { root: 'root', child: 'child', 'collection-item': 'collection item', switchable: 'switchable', ghost: 'not scanned' }
  /** What a card is, in words: the kind, or for a ghost what kind of ghost. */
  const kindLabel = (c) => !c.ghost ? KIND[c.kind] ?? c.kind : c.external ? 'package' : c.widget ? 'widget' : 'not scanned'
  const ghostWhat = (c) => c.external ? `from ${c.external}${c.widget ? ' (widget)' : ''}` : c.widget ? 'widget' : 'not in scanned files'
  const SINKS = ['STATE', 'EVENTS', 'EFFECT', 'PARENT', 'HTTP', 'ELEMENT', 'LLM', 'DOM']
  const TRIG = { intent: 'intent', builtin: 'builtin', reply: 'reply', next: 'next', agent: 'agent', behavior: 'behavior', unknown: 'never' }
  const EDITORS = ['vscode', 'cursor', 'windsurf', 'idea', 'none']
  const kindClass = (k) => 'k-' + (KIND[k] ? k : 'child')
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

  // ───────────── model and layout (pure, see model.js / layout.js) ─────────────
  // replaced as a whole by setGraph(); ids link within one graph, `key`s survive an update
  let M, comps, byId, parentsOf, childrenOf, renderEdges, contextEdges, health, L, pos, events, hay
  // V-6: the diff with META.base (diff.js), else null
  let DX = null
  // V-4 (groups.js): the size tier, the directory groups and what is drawn (P). The UI state behind
  // the projection is kept by stable keys (group keys are directories, the focus a component key),
  // so it survives setGraph (live mode, D521)
  let P, tier, groupOf, canvasMode = false
  // a canvas repaint is queued (var: drawGraph() can ask for one before the view below exists)
  var paintQueued = false
  const ui = { filter: {}, open: new Set(), closed: new Set(), focusKey: null, tree: new Map(), view: 'graph' }
  function project() {
    tier = V.tierFor(comps.filter(c => !c.ghost && c.diff !== 'removed').length)
    const focus = ui.focusKey != null ? M.byKey.get(ui.focusKey) ?? null : null
    if (focus == null) ui.focusKey = null
    P = V.projectView(M, { tier, groupOf, filter: ui.filter, open: ui.open, closed: ui.closed, focus })
    L = P.identity ? V.layoutGraph(M) : P.flat ? V.layoutGraph(P) : V.layoutView(P)
    pos = L.pos
    canvasMode = P.nodes.length > V.CANVAS_NODES
  }
  /** The drawn node that shows component `id` (itself, or its folded group), or null. */
  const repOf = (id) => P.rep.get(id) ?? (P.byNode.has(id) ? id : null)
  function load(graph) {
    G = graph
    DX = META.base?.graph && G?.source !== 'runtime' ? V.diffModel(V, META.base.graph, G, { base: META.base.ref, commit: META.base.commit }) : null
    M = DX ? DX.M : V.buildModel(G?.source === 'runtime' ? V.fromRuntime(G) : G)
    ;({ comps, byId, parentsOf, childrenOf, renderEdges, contextEdges } = M)
    health = V.healthList(DX ? DX.headModel : M, META.codes || {})
    if (M.runtime) health = health.concat(V.runtimeHealth(M))
    groupOf = V.groupKeys(M)
    project()
    events = M.events
    hay = new Map(comps.map(c => [c.id, V.searchText(c)]))
  }
  load(G)
  const evInfo = (t) => events[t] || { emitters: [], selectors: [] }
  const names = (xs) => (xs || []).map(x => typeof x === 'string' ? x : x?.name)

  // ───────────── render ─────────────
  const svg = $('svg'), vp = $('vp')
  const el = (tag, attrs = {}, parent) => { const e = doc.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e }
  const nodeEls = new Map(), edgeEls = []
  const nd0 = (c) => c.diagnostics.some(d => d.severity !== 'info')
  let restoring = false
  const diagCount = (c) => c.diagnostics.filter(d => d.severity !== 'info').length
  // a runtime card (no file) is described by its instances; a static card with live data (P-2) keeps its file
  const fileLine = (c) => c.rt && !c.file ? V.rtCardSub(c) : `${c.file}${c.line != null ? ':' + c.line : ''}`
  const nameOf = (c) => c.rt && c.rt.count > 1 ? `${c.name} ×${c.rt.count}` : c.name
  const dirLabel = (d) => M.runtime ? d : d + '/'
  const describe = (c) => c.ghost
    ? `${c.name}, ${ghostWhat(c)}`
    : `${nameOf(c)}, ${KIND[c.kind] ?? c.kind}${c.diff ? `, ${c.diff} since ${META.base.ref}` : ''}${c.shown === false ? ', hidden' : ''}${c.entry === true ? ', entry' : ''}${c.viewOnly ? ', view only' : ''}${diagCount(c) ? `, ${plural(diagCount(c), 'problem')}` : ''}`
  // routes of the drawn edges (edgePaths output): SVG mode makes elements, canvas mode paints them
  let routes = []
  const hideBehavior = () => !!ui.filter.hideBehavior
  const groupName = (k) => (k.split('/').pop() || k)
  function drawGraph() {
    for (const g of ['clusters', 'edges', 'labels', 'nodes']) $(g).textContent = ''
    nodeEls.clear()
    edgeEls.length = 0
    routes = V.edgePaths(P.identity ? M : P, L)
    svg.classList.toggle('grouped', !!tier.grouped)
    $('cv').hidden = !canvasMode
    const lg = $('legend').querySelector('.lg-layout')
    if (lg) lg.hidden = !M.renderEdges.some(e => e.via === 'layout')
    if (canvasMode) { for (const e of routes) edgeEls.push({ ...e, p: null, t: null }); paint(); return }
    for (const b of L.clusters) {
      const g = el('g', { class: 'cluster', 'aria-hidden': 'true', 'data-key': b.key }, $('clusters'))
      el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 14 }, g)
      el('text', { x: b.x + 14, y: b.y + 22 }, g).textContent = dirLabel(b.key)
      if (b.open && tier.grouped) {
        const f = el('text', { class: 'fold', x: b.x + b.w - 14, y: b.y + 22, 'text-anchor': 'end' }, g)
        f.textContent = '− fold'
        f.addEventListener('click', (ev) => { ev.stopPropagation(); foldGroup(b.key) })
        el('text', { class: 'big', x: b.x + 14, y: b.y + 8, 'dominant-baseline': 'hanging', 'data-w': b.w - 28, 'data-h': b.h }, g).textContent = groupName(b.key)
      }
    }
    for (const e of routes) {
      const n = e.edge?.count ?? 1
      const dc = DX ? V.diffEdgeClass(e) : ''
      const p = el('path', { class: 'edge ' + e.cls + (n > 1 ? ' bundled' : '') + dc, d: e.d, 'marker-end': `url(#${e.marker})` }, $('edges'))
      if (n > 1) p.style.strokeWidth = Math.min(8, 1.5 + Math.log2(n) * 1.2).toFixed(1)
      let t = null
      if (e.label) { t = el('text', { class: 'elabel ' + e.cls + dc, x: e.mid[0], y: e.mid[1], 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, $('labels')); t.textContent = e.label }
      edgeEls.push({ ...e, p, t })
    }
    for (const n of P.nodes) {
      if (n.type === 'group') { drawGroupCard(n); continue }
      if (n.type === 'bus') { drawBus(n); continue }
      const c = n.comp
      const p = pos.get(c.id)
      const w = V.worst(c)
      const route = V.routeLabel(c)
      const cls = ['node', c.ghost && 'ghost', c.external && 'external', c.widget && 'widget', c.viewOnly && 'view-only', c.entry === true && 'entry', c.rt && 'rt', c.mounted === false && 'unmounted', c.shown === false && 'hidden-page', n.dim && 'dimf', route != null && 'vike'].filter(Boolean).join(' ')
      const g = el('g', { class: cls + (w === 'error' ? ' has-err' : w === 'warn' ? ' has-warn' : '') + (DX ? V.diffNodeClass(c) : ''), transform: `translate(${p.x},${p.y})`, tabindex: -1, role: 'button', 'aria-label': describe(c), 'data-id': c.id }, $('nodes'))
      el('rect', { class: 'box', width: p.w, height: p.h, rx: 11 }, g)
      if (c.diff) { const m = el('g', { class: 'dmark d-' + c.diff, transform: 'translate(2,2)' }, g); el('circle', { r: 8 }, m); el('text', { y: 4, 'text-anchor': 'middle' }, m).textContent = { added: '+', removed: '−', changed: '~' }[c.diff] }
      if (!c.ghost) el('rect', { x: 0, y: 10, width: 3.5, height: p.h - 20, rx: 2, fill: `var(--${{ root: 'k-root', 'collection-item': 'k-coll', switchable: 'k-switch' }[c.kind] ?? 'k-child'})` }, g)
      // A-9: a Vike card whose name is generic (Page, Layout, Wrapper) is titled by its route
      const byRoute = route != null && /^(Page|Layout|Wrapper)$/.test(c.name)
      const nm = byRoute ? route : c.rt && c.rt.count > 1 ? `${c.name.length > 16 ? c.name.slice(0, 15) + '…' : c.name} ×${c.rt.count}` : c.name
      el('text', { class: 'name', x: 16, y: 24 }, g).textContent = nm.length > 22 ? nm.slice(0, 21) + '…' : nm
      const base = c.ghost ? ghostWhat(c) : c.rt && !c.file ? V.rtCardSub(c) : `${c.file.split('/').pop()}${c.line != null ? ':' + c.line : ''}`
      const file = route != null ? `${byRoute ? c.name : route} · ${base}` : base
      el('text', { class: 'sub', x: 16, y: 41 }, g).textContent = file.length > 30 ? (route != null ? file.slice(0, 29) + '…' : '…' + file.slice(-29)) : file
      if (!c.ghost) {
        const meta = el('text', { class: 'meta', x: 16, y: 60 }, g)
        const own = c.actions.filter(a => !a.behavior).length, beh = c.actions.length - own
        const parts = [[own, 'act' + (beh && !hideBehavior() ? `+${beh}` : '')], [c.stateKeys.length, 'state'], [c.eventsEmitted.length + c.eventsSelected.length, 'events']].filter(([n]) => n)
        parts.forEach(([n, l], i) => { el('tspan', { class: 'n', dx: i ? 10 : 0 }, meta).textContent = n; el('tspan', {}, meta).textContent = ' ' + l })
        if (!parts.length && c.viewOnly) meta.textContent = 'view only'
        if (c.entry === true) el('text', { class: 'entry-tag', x: nd0(c) ? p.w - 44 : p.w - 14, y: 24, 'text-anchor': 'end' }, g).textContent = 'entry'
        if (c.agent) el('text', { class: 'ai', x: p.w - 14, y: 60, 'text-anchor': 'end' }, g).textContent = 'AI'
      }
      const nd = diagCount(c)
      if (nd) {
        const pg = el('g', { class: 'pill', transform: `translate(${p.w - 12},12)` }, g)
        el('rect', { class: w === 'error' ? 'err' : 'warn', x: -22, y: -1, width: 26, height: 17, rx: 8.5 }, pg)
        el('text', { x: -9, y: 11.5, 'text-anchor': 'middle' }, pg).textContent = nd
      }
      el('title', {}, g).textContent = c.ghost ? `${c.name}: ${c.external || c.widget ? ghostWhat(c) : 'rendered, but not found in the scanned files'}` : `${c.name}${route != null ? ' · ' + route : ''}\n${fileLine(c)}`
      wireNode(g, c.id, () => select(c.id))
    }
    if (isFar) sizeFarLabels()
  }
  /** The listeners every drawn node shares (`act`: what a click, Enter or Space does). */
  function wireNode(g, id, act) {
    g.addEventListener('click', (ev) => { ev.stopPropagation(); act() })
    g.addEventListener('keydown', (ev) => onNodeKey(ev, id, act))
    g.addEventListener('focus', () => { setTabStop(id); if (!selected && !tracing) hover(id); if (!restoring) ensureVisible(id) })
    g.addEventListener('blur', () => { if (!selected && !tracing) clearHl() })
    g.addEventListener('mouseenter', () => { if (!selected && !tracing) hover(id) })
    g.addEventListener('mouseleave', () => { if (!selected && !tracing) clearHl() })
    nodeEls.set(id, g)
  }
  /** A folded directory group: one card with its counts and worst severity; a click or Enter opens it. */
  function drawGroupCard(n) {
    const p = pos.get(n.id)
    const w = n.err ? 'error' : n.warn ? 'warn' : null
    const nch = DX ? V.diffGroupCount(DX, n.members, byId) : 0
    const label = `${n.key}, folded group of ${plural(n.count, 'component')}${n.err ? `, ${n.err} with errors` : ''}${n.warn ? `, ${n.warn} with warnings` : ''}${nch ? `, ${nch} changed since ${META.base.ref}` : ''}. Enter opens it`
    const g = el('g', { class: 'node group' + (w === 'error' ? ' has-err' : w === 'warn' ? ' has-warn' : ''), transform: `translate(${p.x},${p.y})`, tabindex: -1, role: 'button', 'aria-label': label, 'data-id': n.id, 'data-key': n.key }, $('nodes'))
    el('rect', { class: 'box', width: p.w, height: p.h, rx: 14 }, g)
    const nm = groupName(n.key)
    el('text', { class: 'name', x: 16, y: 26 }, g).textContent = nm.length > 24 ? nm.slice(0, 23) + '…' : nm
    el('text', { class: 'sub', x: 16, y: 44 }, g).textContent = n.key.length > 31 ? '…' + n.key.slice(-30) : dirLabel(n.key)
    const meta = el('text', { class: 'count', x: 16, y: 72 }, g)
    el('tspan', { class: 'n' }, meta).textContent = n.count
    el('tspan', {}, meta).textContent = ` component${n.count === 1 ? '' : 's'}${n.entry ? ' · entry' : ''}`
    if (n.ai) el('text', { class: 'ai', x: p.w - 14, y: 72, 'text-anchor': 'end' }, g).textContent = `${n.ai} AI`
    if (n.err || n.warn) {
      const pg = el('g', { class: 'pill', transform: `translate(${p.w - 12},12)` }, g)
      el('rect', { class: w === 'error' ? 'err' : 'warn', x: -30, y: -1, width: 34, height: 17, rx: 8.5 }, pg)
      el('text', { x: -13, y: 11.5, 'text-anchor': 'middle' }, pg).textContent = n.err + n.warn
    }
    if (nch) { const m = el('g', { class: 'dmark', transform: 'translate(-6,-8)' }, g); el('rect', { width: 22 + String(nch).length * 6, height: 17, rx: 8.5 }, m); el('text', { x: (22 + String(nch).length * 6) / 2, y: 12.5, 'text-anchor': 'middle' }, m).textContent = `~${nch}` }
    el('title', {}, g).textContent = `${dirLabel(n.key)}: ${plural(n.count, 'component')}${nch ? `, ${nch} changed` : ''} (click to open)`
    wireNode(g, n.id, () => openGroup(n.key))
  }
  /** An EVENTS bus node (one type: emitters → bus → selectors); a click traces the type. */
  function drawBus(n) {
    const p = pos.get(n.id)
    const g = el('g', { class: 'node bus', transform: `translate(${p.x},${p.y})`, tabindex: -1, role: 'button', 'aria-label': `EVENTS ${n.event}: ${plural(n.emitters, 'emitter')}, ${plural(n.selectors, 'selector')}. Enter traces it`, 'data-id': n.id }, $('nodes'))
    el('rect', { class: 'box', width: p.w, height: p.h, rx: p.h / 2 }, g)
    el('text', { x: p.w / 2, y: p.h / 2 + 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, g).textContent = n.event.length > 22 ? n.event.slice(0, 21) + '…' : n.event
    el('title', {}, g).textContent = `EVENTS ${n.event}: ${n.emitters} → ${n.selectors}`
    wireNode(g, n.id, () => trace('event', n.event))
  }
  drawGraph()

  // ───────────── keyboard on the canvas (roving tab stop) ─────────────
  let tabStop = null
  function setTabStop(id) {
    if (tabStop === id) return
    if (tabStop) nodeEls.get(tabStop)?.setAttribute('tabindex', '-1')
    tabStop = id
    nodeEls.get(id)?.setAttribute('tabindex', '0')
  }
  function initTabStop() {
    // the first card of the first cluster (an entry if the graph marks one)
    if (canvasMode) { tabStop = null; return }
    const first = P.nodes.find(n => n.comp?.entry === true)?.id ?? [...pos.keys()].sort((a, b) => pos.get(a).y - pos.get(b).y || pos.get(a).x - pos.get(b).x)[0]
    if (first) setTabStop(first)
  }
  initTabStop()
  const cx = (id) => pos.get(id).x + pos.get(id).w / 2
  const nearest = (from, ids) => ids.slice().sort((a, b) => Math.abs(cx(a) - cx(from)) - Math.abs(cx(b) - cx(from)) || cx(a) - cx(b))[0]
  function neighbour(id, key) {
    // the drawn graph's render edges (P: the model's own when nothing is folded or filtered)
    if (key === 'ArrowUp') return nearest(id, (P.parentsOf.get(id) || []).filter(p => p !== id && pos.has(p)))
    if (key === 'ArrowDown') return nearest(id, (P.childrenOf.get(id) || []).filter(c => c !== id && pos.has(c)))
    const p = pos.get(id)
    const row = [...pos.keys()].filter(o => o !== id && Math.abs(pos.get(o).y - p.y) < 1)
    const side = key === 'ArrowLeft' ? row.filter(o => pos.get(o).x < p.x) : row.filter(o => pos.get(o).x > p.x)
    return side.sort((a, b) => Math.abs(pos.get(a).x - p.x) - Math.abs(pos.get(b).x - p.x))[0]
  }
  function onNodeKey(ev, id, act) {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); act ? act() : select(id); return }
    if (!ev.key.startsWith('Arrow')) return
    ev.preventDefault()
    const next = neighbour(id, ev.key)
    if (next) nodeEls.get(next)?.focus()
  }
  /** The canvas area not covered by the detail panel (it overlays the canvas below 1200 px). */
  function visibleRect() {
    const r = svg.getBoundingClientRect()
    const d = $('detail')
    if (!d.classList.contains('open') || getComputedStyle(d).position !== 'fixed') return { width: r.width, height: r.height }
    return { width: Math.max(120, Math.min(r.width, d.getBoundingClientRect().left - r.left)), height: r.height }
  }
  /** Pan to the card when it is (partly) off screen, or always with `centre`. */
  function ensureVisible(id, centre = false) {
    const r = visibleRect(), p = pos.get(repOf(id) ?? id)
    if (!p) return
    const sx = view.x + p.x * view.k, sy = view.y + p.y * view.k
    if (centre || sx < 20 || sy < 20 || sx + p.w * view.k > r.width - 20 || sy + p.h * view.k > r.height - 20) {
      const k = Math.max(view.k, 0.85)
      animateTo({ k, x: r.width / 2 - (p.x + p.w / 2) * k, y: r.height / 2.4 - (p.y + p.h / 2) * k })
    }
  }

  // ───────────── pan / zoom ─────────────
  let view = { x: 0, y: 0, k: 1 }
  // semantic zoom (D536): below 0.4 cards lose their text and the overlays hide; group names grow
  const FAR_K = 0.4
  var isFar = null // var: drawGraph() reads it before this line runs
  const apply = () => {
    vp.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`)
    const far = view.k < FAR_K
    if (far !== isFar) { isFar = far; svg.classList.toggle('far', far); if (!far) for (const t of svg.querySelectorAll('.node.group .name')) placeFarName(t, false) }
    if (far && !canvasMode) sizeFarLabels()
    if (canvasMode) paint()
    drawMinimapView()
  }
  // `moved`: the view changed since the automatic fit (setGraph keeps a moved view exactly and
  // re-fits one the user never moved); `anim`: the running animation, cancelled by any other move
  let moved = false, anim = 0, animating = false
  function animateTo(target, ms = 280) {
    moved = true
    const token = ++anim
    if (reduceMotion()) { view = target; apply(); animating = false; return }
    const from = { ...view }, t0 = performance.now()
    animating = true
    const step = (t) => {
      if (token !== anim) return
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3)
      view = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, k: from.k + (target.k - from.k) * e }
      apply()
      if (k < 1) requestAnimationFrame(step); else animating = false
    }
    requestAnimationFrame(step)
  }
  const stopAnim = () => { anim++; animating = false; moved = true }
  /** Far away, directory names stay ~15–18 px on screen, never wider than their box or card. */
  // A folded group's name is centred in its card and capped by the card's height as well as its
  // width, so far away it never grows out of the card (it was anchored at the card's top-left)
  function sizeFarLabels() {
    for (const t of $('clusters').querySelectorAll('.big')) t.style.fontSize = Math.min(18 / view.k, Number(t.dataset.w) / (0.62 * t.textContent.length), (Number(t.dataset.h) - 16) * 0.3).toFixed(1) + 'px'
    for (const t of $('nodes').querySelectorAll('.node.group .name')) placeFarName(t, true)
  }
  function placeFarName(t, far) {
    if (!far) { t.style.fontSize = ''; t.setAttribute('x', 16); t.setAttribute('y', 26); t.removeAttribute('text-anchor'); t.removeAttribute('dominant-baseline'); return }
    t.setAttribute('x', V.GROUP_W / 2); t.setAttribute('y', V.GROUP_H / 2); t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'central')
    t.style.fontSize = Math.min(15 / view.k, (V.GROUP_W - 24) / (0.62 * t.textContent.length), V.GROUP_H * 0.6).toFixed(1) + 'px'
  }
  let fitK = 1
  function fit(ids = [...pos.keys()], animate = true, maxK = 1.15) {
    const r = visibleRect(), b = V.bbox(pos, ids.map(id => pos.has(id) ? id : repOf(id)).filter(Boolean))
    if (!r.width || !r.height) return
    const k = Math.min(r.width / (b.x1 - b.x0), r.height / (b.y1 - b.y0), maxK)
    if (ids.length === pos.size) fitK = k
    const t = { k, x: (r.width - (b.x1 - b.x0) * k) / 2 - b.x0 * k, y: (r.height - (b.y1 - b.y0) * k) / 2 - b.y0 * k }
    if (animate) animateTo(t); else { anim++; animating = false; view = t; apply() }
  }
  function zoomAt(f, x, y) { stopAnim(); const k = Math.max(Math.min(0.12, fitK * 0.7), Math.min(3, view.k * f)); const r = k / view.k; view = { k, x: x - (x - view.x) * r, y: y - (y - view.y) * r }; apply() }
  svg.addEventListener('wheel', (e) => {
    e.preventDefault()
    const r = svg.getBoundingClientRect()
    if (e.ctrlKey || e.metaKey || e.deltaMode === 1) zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01)), e.clientX - r.left, e.clientY - r.top)
    else { stopAnim(); view.x -= e.deltaX; view.y -= e.deltaY; apply() }
  }, { passive: false })
  let drag = null
  svg.addEventListener('pointerdown', (e) => { if (e.target.closest('.node, .cluster .fold')) return; drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }; svg.setPointerCapture(e.pointerId); svg.classList.add('panning') })
  svg.addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true; stopAnim(); view.x = drag.vx + dx; view.y = drag.vy + dy; apply() })
  svg.addEventListener('pointerup', (e) => {
    if (drag && !drag.moved) {
      // canvas mode: the click lands on the svg; find the node under it
      const r = svg.getBoundingClientRect()
      const n = canvasMode ? V.hitNode({ P, L }, view, e.clientX - r.left, e.clientY - r.top) : null
      if (n?.type === 'group') openGroup(n.key)
      else if (n?.type === 'bus') trace('event', n.event)
      else if (n) select(n.id)
      else { select(null); endTrace() }
    }
    drag = null; svg.classList.remove('panning')
  })
  const centre = () => { const r = svg.getBoundingClientRect(); return [r.width / 2, r.height / 2] }
  $('zin').onclick = () => zoomAt(1.25, ...centre())
  $('zout').onclick = () => zoomAt(0.8, ...centre())
  $('zfit').onclick = () => fit()

  // ───────────── highlight / select / trace ─────────────
  let selected = null, tracing = null
  const pressed = (id) => $(id).getAttribute('aria-pressed') === 'true'
  // highlighted edges and their labels are copied into a layer above the cards, so a line
  // that passes behind an intermediate card (and its label) stays visible; unhighlighted, cards stay on top
  // canvas mode keeps the highlight as data and repaints
  let hlState = null
  function clearHl() {
    svg.classList.remove('dim'); svg.querySelectorAll('.hl, .state-write, .state-read').forEach(e => e.classList.remove('hl', 'state-write', 'state-read')); $('hl-layer').replaceChildren()
    if (hlState) { hlState = null; if (canvasMode) paint() }
  }
  function hl(nodeIds, edgePred) {
    clearHl()
    // components shown inside a folded group light their group's card
    const drawn = new Set([...nodeIds].map(id => repOf(id) ?? id))
    if (canvasMode) { hlState = { ids: drawn, pred: edgePred }; paint(); return }
    svg.classList.add('dim')
    for (const id of drawn) nodeEls.get(id)?.classList.add('hl')
    const top = $('hl-layer'), labels = []
    for (const e of edgeEls) if (edgePred(e)) {
      if (!e.p) continue
      e.p.classList.add('hl'); e.t?.classList.add('hl')
      top.appendChild(e.p.cloneNode(false))
      if (e.t) labels.push(e.t.cloneNode(true))
    }
    // on top of a card, a label gets a pill so it doesn't read as part of the card's text
    for (const t of labels) {
      top.appendChild(t)
      const b = t.getBBox()
      if (!b.width) continue
      const kind = ['event', 'context', 'parent'].find(k => t.classList.contains(k)) || 'tree'
      const pill = el('rect', { class: 'elabel-pill ' + kind, x: b.x - 5, y: b.y - 2, width: b.width + 10, height: b.height + 4, rx: (b.height + 4) / 2 })
      top.insertBefore(pill, t)
    }
  }
  function neighbourhood(id) {
    const ids = new Set([id])
    for (const e of edgeEls) {
      if (e.from !== id && e.to !== id) continue
      if ((e.cls === 'event' && !pressed('t-events')) || (e.cls === 'context' && !pressed('t-context')) || (e.cls === 'parent' && !pressed('t-parent'))) continue
      ids.add(e.from); ids.add(e.to)
    }
    return ids
  }
  function hover(id) { hl(neighbourhood(id), e => e.from === id || e.to === id) }
  function announce(text) { $('status').textContent = text }
  /** Make component `id` drawn as itself: open its group, drop the filters that hide it. */
  function reveal(id) {
    const k = groupOf.get(id)
    if (k != null) { ui.closed.delete(k); if (tier.folded) ui.open.add(k) }
    if (!P.rep.has(id) && !ui.focusKey) { const hb = ui.filter.hideBehavior; ui.filter = hb ? { hideBehavior: true } : {} }
  }
  function select(id, opts = {}) {
    if (id != null && !byId.has(id)) id = null
    // V-4: in the medium and large tiers selecting focuses the component (ancestors, children to
    // depth 2, EVENTS / context / PARENT peers; D536); `noFocus` selects in the whole graph
    let relaid = false
    if (id != null) {
      const want = tier.focus && !opts.noFocus ? byId.get(id).key : opts.noFocus ? null : ui.focusKey
      if (repOf(id) !== id || ui.focusKey !== want) { reveal(id); ui.focusKey = want; relayout(); relaid = true }
    } else if (ui.focusKey != null && !opts.keepFocus) { ui.focusKey = null; relayout(); fit(undefined, false) }
    selected = id
    nodeEls.forEach((g, k) => g.classList.toggle('sel', k === id))
    doc.querySelectorAll('.tree-item').forEach(t => t.setAttribute('aria-current', String(t.dataset.id === id)))
    if (!id) { clearHl(); $('detail').classList.remove('open'); $('detail').setAttribute('aria-hidden', 'true'); return }
    const c = byId.get(id)
    setTabStop(id)
    endTrace(true)
    hover(id)
    renderDetail(c)
    $('detail').classList.add('open')
    $('detail').removeAttribute('aria-hidden')
    announce(`Selected ${describe(c)}. Details are in the panel on the right.`)
    // the panel narrows the canvas: wait for it, then pan if the card is (partly) hidden; a new
    // focus view fits as a whole
    if (relaid && ui.focusKey) setTimeout(() => fit(undefined, false), reduceMotion() ? 0 : 200)
    else if (!opts.keepView || relaid) setTimeout(() => ensureVisible(id, opts.pan || relaid), reduceMotion() ? 0 : 200)
  }
  function trace(kind, key, opts = {}) {
    tracing = { kind, key }
    const ids = new Set()
    let pred = () => false
    let text = ''
    const evHas = (x) => x.cls === 'event' && (x.edge?.types ? x.edge.types.includes(key) : x.type === key)
    let marks = null
    if (kind === 'event') {
      const e = evInfo(key)
      // V-4: open the folded groups that hold its ends (a few at most), so the trace shows components
      if (!opts.noOpen && tier.grouped && !ui.focusKey) {
        const ends = M.eventEdges.filter(x => x.type === key).flatMap(x => [x.from, x.to])
        const folded = [...new Set(ends.map(id => P.rep.get(id)).filter(r => r && r.startsWith('grp:')).map(r => r.slice(4)))]
        if (folded.length && folded.length <= 6) { for (const k of folded) { ui.open.add(k); ui.closed.delete(k) } relayout() }
      }
      for (const x of edgeEls) if (evHas(x)) { ids.add(x.from); ids.add(x.to) }
      for (const [idList, nameList] of [[e.emitterIds, e.emitters], [e.selectorIds, e.selectors]]) {
        if (Array.isArray(idList)) { for (const x of idList) if (byId.has(x)) ids.add(x) } // D528: full id lists
        else for (const n of names(nameList)) for (const c of M.byName.get(n) || []) ids.add(c.id)
      }
      pred = evHas
      text = `EVENTS <b>${esc(key)}</b> · ${esc(names(e.emitters).join(', ') || 'no emitter')} → ${esc(names(e.selectors).join(', ') || 'no selector')}`
    } else if (kind === 'context') {
      for (const c of comps) if (c.contextProvides.includes(key) || c.contextConsumes.includes(key)) ids.add(c.id)
      pred = (x) => x.cls === 'context' && x.fields.includes(key)
      text = `context <b>${esc(key)}</b> · provided by ${esc(comps.filter(c => c.contextProvides.includes(key)).map(c => c.name).join(', ') || 'nobody')}`
    } else if (kind === 'action') {
      for (const c of comps) if (c.actions.some(a => a.name === key)) ids.add(c.id)
      text = `action <b>${esc(key)}</b> · in ${plural(ids.size, 'component')}`
    } else if (kind === 'state') {
      // A-7: who writes the key (actions[].writes) and who reads it (stateReads), lit differently
      const st = V.stateTrace(M, key)
      for (const id of [...st.owners, ...st.writers.map(w => w.id), ...st.readers]) ids.add(id)
      for (const e of renderEdges) if (e.label === `[${key}]`) { ids.add(e.from); ids.add(e.to) }
      pred = (x) => x.label === `[${key}]`
      const who = (list) => list.map(x => esc(x)).join(', ')
      const writers = st.writers.map(w => `${w.action} (${byId.get(w.id).name})`)
      text = `state key <b>${esc(key)}</b> · written by <span class="w">${who(writers.slice(0, 6)) || 'nothing known'}${writers.length > 6 ? ` +${writers.length - 6}` : ''}</span>`
        + ` · read by <span class="rd">${who(st.readers.slice(0, 6).map(id => byId.get(id).name)) || 'nothing known'}${st.readers.length > 6 ? ` +${st.readers.length - 6}` : ''}</span>`
        + (st.unknown.length ? ` · ${plural(st.unknown.length, 'reducer')} unread` : '')
      marks = { write: new Set(st.writers.map(w => w.id)), read: new Set(st.readers) }
    }
    const t = $('trace')
    t.innerHTML = `<span>${text}</span><button type="button" id="trace-x">Clear</button>`
    t.classList.add('on')
    $('trace-x').onclick = () => { endTrace(); if (selected) hover(selected) }
    announce(t.firstChild.textContent)
    hl(ids, pred)
    if (marks && !canvasMode) {
      for (const id of marks.write) nodeEls.get(repOf(id) ?? id)?.classList.add('state-write')
      for (const id of marks.read) if (!marks.write.has(id)) nodeEls.get(repOf(id) ?? id)?.classList.add('state-read')
    }
    if (ids.size && opts.fit !== false) fit([...ids].filter(id => repOf(id)), true, 1)
  }
  function endTrace(keepHl) { tracing = null; $('trace').classList.remove('on'); if (!keepHl && !selected) clearHl() }

  // ───────────── detail panel ─────────────
  const editorSel = $('editor')
  function editorHref(file, line) {
    const ed = editorSel.value
    const root = META.root
    if (!file || !root || ed === 'none' || !EDITORS.includes(ed)) return null
    const abs = (root.endsWith('/') ? root : root + '/') + file
    const ln = line ?? 1
    if (ed === 'idea') return `idea://open?file=${encodeURIComponent(abs)}&line=${ln}`
    return `${ed}://file${abs.startsWith('/') ? '' : '/'}${encodeURI(abs)}:${ln}`
  }
  const timeTag = (ms) => ms != null ? ` <span class="unk" title="reported at ${esc(new Date(ms).toISOString())}">${esc(V.rtTime(ms))}</span>` : ''
  const fileLink = (file, line, text) => { const h = editorHref(file, line); return h ? `<a href="${esc(h)}">${esc(text)}</a>` : `<span class="mono">${esc(text)}</span>` }
  const chip = (text, attrs = '', cls = '') => `<span class="chip ${cls}" ${attrs}>${esc(text)}</span>`
  const btnChip = (text, attrs = '', cls = '', label = '') => `<button type="button" class="chip ${cls}" ${attrs}${label ? ` aria-label="${esc(label)}"` : ''}>${esc(text)}</button>`
  const sinkChip = (s) => `<span class="sink" style="background:var(--s-${SINKS.includes(s) ? s : 'other'})">${esc(s)}</span>`
  const nameLink = (c) => btnChip(c.name, `data-goto="${esc(c.id)}"`)

  function actionRows(list, c) {
    return list.map(a => {
      const trig = a.behavior && a.trigger === 'unknown' ? 'maybe' : TRIG[a.trigger] ? a.trigger : 'unknown'
      const lbl = trig === 'maybe' ? '?' : TRIG[trig]
      const at = a.line != null && editorHref(a.file ?? c.file, a.line)
      return `<span class="trig t-${trig}" title="trigger: ${esc(lbl)}">${esc(lbl)}</span>`
        + `<span>${btnChip(a.name, `data-trace-action="${esc(a.name)}"`, 'act', `trace action ${a.name}`)}${at ? ` <a href="${esc(at)}" class="unk" title="line ${a.line}">:${a.line}</a>` : ''}</span>`
        + `<span class="sinks">${a.sinks.length ? a.sinks.map(sinkChip).join('') : '<span class="unk">no model entry</span>'}</span>`
        // A-7: the state keys its reducer writes
        + (Array.isArray(a.writes) && a.writes.length ? `<span class="writes">writes ${a.writes.map(k => btnChip(k, `data-trace-state="${esc(k)}"`, '', `trace state key ${k}`)).join(' ')}${a.removes ? ' <span class="unk">· may remove the item</span>' : ''}</span>`
          : a.writes === null ? '<span class="writes">writes <span class="unk">? (reducer not readable)</span></span>' : a.removes ? '<span class="writes unk">may remove the item</span>' : '')
    }).join('')
  }

  function renderDetail(c) {
    const out = []
    out.push(`<div class="dhead"><h2 id="dtitle">${esc(c.name)}${c.rt && c.rt.count > 1 ? ` <span class="unk">×${c.rt.count}</span>` : ''} <span class="kind ${kindClass(c.kind)}">${esc(kindLabel(c))}</span>${c.entry === true ? ' <span class="tag">entry</span>' : ''}${c.viewOnly ? ' <span class="tag">view only</span>' : ''}${c.shown === false ? ' <span class="tag">hidden</span>' : ''}<button type="button" class="close" id="dclose" aria-label="Close details (Esc)">×</button></h2>
      <div class="loc">${c.ghost ? (c.external ? `A component from the package <code>${esc(c.external)}</code>${c.widget ? ' (a widget)' : ''}.` : c.widget ? 'A widget (defineWidget, fromReact, fromZag…): its inside is not a Sygnal component.' : 'Rendered by a scanned component, but its definition was not found in the scanned files (a plain function, a dynamic tag, or a file outside the paths).') : (c.rt && !c.file ? `<span class="mono">runtime · ${esc(V.rtCardSub(c))}</span>` : fileLink(c.file, c.line, fileLine(c))) + '<span class="spacer"></span><button type="button" class="copy" id="dcopy">Copy JSON</button>'}</div></div>`)

    if (DX) out.push(V.diffDetailHtml(DX, c, { esc }))
    if (c.diagnostics.length) {
      out.push(`<section class="dsec"><h3>Diagnostics <span class="n">${c.diagnostics.length}</span></h3>${c.diagnostics.map(d => {
        const at = d.line && editorHref(d.file, d.line)
        return `<div class="diag ${esc(d.severity)}"><div class="code">${d.docsUrl ? `<a href="${esc(d.docsUrl)}" target="_blank" rel="noopener noreferrer">${esc(d.code)}</a>` : esc(d.code)}${META.codes?.[d.code] ? ` <span class="title">${esc(META.codes[d.code])}</span>` : ''}${at ? ` · <a href="${esc(at)}">line ${d.line}</a>` : d.line ? ` · line ${d.line}` : ''}${timeTag(d.timestamp)}</div><div>${esc(d.message)}</div>${d.fix ? `<div class="fix">Fix: ${esc(d.fix)}</div>` : ''}</div>`
      }).join('')}</section>`)
    }

    if (c.rt) out.push(V.rtDetailHtml(c, { esc, btnChip, states: rtStates, canFetch: !!rtHost?.getState }))
    const rel = []
    const parents = parentsOf.get(c.id).map(id => byId.get(id))
    if (parents.length) rel.push(`<div class="r"><span class="lbl">rendered by</span><span class="chips">${parents.map(nameLink).join('')}</span></div>`)
    const kids = renderEdges.filter(e => e.from === c.id)
    if (kids.length) rel.push(`<div class="r"><span class="lbl">renders</span><span class="chips">${kids.map(e => `<button type="button" class="chip" data-goto="${esc(e.to)}">${esc(nameOf(byId.get(e.to)))}${e.label ? ` <small>${esc(e.label)}</small>` : ''}</button>`).join('')}</span></div>`)
    if (rel.length) out.push(`<section class="dsec"><h3>Tree</h3><div class="rel">${rel.join('')}</div></section>`)
    const up = M.parentEdges.filter(e => e.from === c.id), down = M.parentEdges.filter(e => e.to === c.id)
    const sends = c.actions.filter(a => a.sinks.includes('PARENT'))
    if (up.length || down.length || sends.length) {
      const pr = []
      if (sends.length) pr.push(`<div class="r"><span class="lbl">sends</span><span class="chips">${sends.map(a => chip(a.name)).join('')}${up.length ? ` → ${up.map(e => btnChip(byId.get(e.to).name, `data-goto="${esc(e.to)}"`)).join('')}` : ' <span class="unk">no parent CHILD.selects it</span>'}</span></div>`)
      for (const e of down) {
        const at = e.line != null && editorHref(c.file, e.line)
        pr.push(`<div class="r"><span class="lbl">receives</span><span class="chips">${btnChip(byId.get(e.from).name, `data-goto="${esc(e.from)}"`)} → ${e.actions.map(a => chip(a)).join('') || '<span class="unk">?</span>'}${at ? ` <a href="${esc(at)}" class="unk" title="CHILD.select at line ${e.line}">:${e.line}</a>` : ''}</span></div>`)
      }
      out.push(`<section class="dsec"><h3>PARENT</h3><div class="rel">${pr.join('')}</div></section>`)
    }

    if (c.actions.some(a => !a.behavior || !hideBehavior())) {
      const own = c.actions.filter(a => !a.behavior)
      const byB = new Map()
      for (const a of c.actions.filter(a => a.behavior && !hideBehavior())) { if (!byB.has(a.behavior)) byB.set(a.behavior, []); byB.get(a.behavior).push(a) }
      const used = c.uses || []
      out.push(`<section class="dsec"><h3>Actions <span class="n">trigger → action → sinks</span></h3><div class="flow">${actionRows(own, c)}${[...byB].map(([k, list]) => `<details class="behav"><summary>${esc(k)}.* · ${plural(list.length, 'action')} from the <b>${esc(used.find(u => u.key === k)?.behavior ?? k)}</b> behavior</summary><div class="flow">${actionRows(list, c)}</div></details>`).join('')}</div></section>`)
    }

    const st = [...c.stateKeys.map(k => btnChip(k, `data-trace-state="${esc(k)}"`, '', `trace state key ${k}`)), ...c.calculated.map(k => btnChip(k + ' ƒ', `data-trace-state="${esc(k)}" title="calculated"`, 'calc', `trace calculated field ${k}`))]
    const reads = (c.stateReads || []).map(k => btnChip(k, `data-trace-state="${esc(k)}"`, '', `trace state key ${k}`))
    if (st.length || reads.length) {
      out.push(`<section class="dsec"><h3>State <span class="n">${st.length}</span></h3>${st.length ? `<div class="chips">${st.join('')}</div>` : ''}${reads.length ? `<div class="rel" style="margin-top:6px"><div class="r"><span class="lbl">reads</span><span class="chips">${reads.join('')}${c.stateReadsPartial ? ' <span class="unk" title="the state is also used in ways the checker can\'t list">+ more</span>' : ''}</span></div></div>` : ''}</section>`)
    }

    const ctx = []
    if (c.contextProvides.length) ctx.push(`<div class="r"><span class="lbl">provides</span><span class="chips">${c.contextProvides.map(k => btnChip(k, `data-trace-context="${esc(k)}"`, '', `trace context ${k}`)).join('')}</span></div>`)
    if (c.contextConsumes.length) ctx.push(`<div class="r"><span class="lbl">reads</span><span class="chips">${c.contextConsumes.map(k => { const p = contextEdges.find(e => e.to === c.id && e.fields.includes(k)); const own = c.contextProvides.includes(k); const fw = !p && !own && V.VIKE_FIELDS.includes(k) && !M.orphanReads.some(o => o.id === c.id && o.field === k); const okd = p || own || fw; return btnChip(k + (okd ? '' : ' ⚠'), `data-trace-context="${esc(k)}" title="${p ? 'from ' + esc(byId.get(p.from).name) : own ? 'from its own .context' : fw ? 'from Vike (vike-sygnal)' : 'no scanned ancestor provides it'}"`, '', `trace context ${k}${okd ? '' : ', no provider'}`) }).join('')}</span></div>`)
    if (ctx.length) out.push(`<section class="dsec"><h3>Context</h3><div class="rel">${ctx.join('')}</div></section>`)

    const evs = []
    if (c.eventsEmitted.length) evs.push(`<div class="r"><span class="lbl">emits</span><span class="chips">${c.eventsEmitted.map(t => { const to = names(evInfo(t).selectors); return btnChip(t + (to.length ? '' : ' ⚠'), `data-trace-event="${esc(t)}" title="→ ${esc(to.join(', ') || 'nobody selects it')}"`, '', `trace event ${t}`) }).join('')}</span></div>`)
    if (c.eventsSelected.length) evs.push(`<div class="r"><span class="lbl">selects</span><span class="chips">${c.eventsSelected.map(t => { const from = names(evInfo(t).emitters); return btnChip(t + (from.length ? '' : ' ⚠'), `data-trace-event="${esc(t)}" title="← ${esc(from.join(', ') || 'nobody emits it')}"`, '', `trace event ${t}`) }).join('')}</span></div>`)
    if (evs.length) out.push(`<section class="dsec"><h3>EVENTS</h3><div class="rel">${evs.join('')}</div></section>`)

    if (c.selectors.length || c.controls?.length) {
      const mark = (s) => s.isolationHit ? `<span class="bad" title="matches inside child ${esc(s.isolationHit)}">✗</span>` : s.matched === true ? '<span class="ok" title="in the view">✓</span>' : s.matched === false ? '<span class="bad" title="not in the view">✗</span>' : '<span class="unk" title="not checked statically">?</span>'
      const rows = c.selectors.map(s => `<tr><td class="st">${mark(s)}</td><td><code>${esc(s.control ? `control ${s.control}` : s.selector)}</code></td><td>${(s.events || []).map(x => chip(x)).join(' ')}${s.behavior ? ` <small class="unk">via ${esc(s.behavior)}</small>` : ''}</td></tr>`)
      for (const x of c.controls || []) if (!c.selectors.some(s => s.control === x.name)) rows.push(`<tr><td class="st">${x.listened ? '<span class="ok">✓</span>' : x.listened === false ? '<span class="bad" title="nothing listens">∅</span>' : '<span class="unk">?</span>'}</td><td><code>control ${esc(x.name)}</code></td><td><small class="unk">${x.element ? '&lt;' + esc(x.element) + '&gt; ' : ''}${x.listened === false ? 'nothing listens' : ''}</small></td></tr>`)
      out.push(`<section class="dsec"><h3>DOM inputs <span class="n">${rows.length}</span></h3><table class="t">${rows.join('')}</table></section>`)
    }
    if (c.commands?.length) out.push(`<section class="dsec"><h3>ELEMENT commands</h3><table class="t">${c.commands.map(x => `<tr><td><code>${esc(x.action)}</code></td><td>→ <b>${esc(x.method)}</b> <code>${esc(x.target ?? '?')}</code>${x.triggers ? ` <small class="unk">fires ${esc(x.triggers.join(', '))}</small>` : ''}</td></tr>`).join('')}</table></section>`)
    if (c.timers?.length) out.push(`<section class="dsec"><h3>Timers</h3><table class="t">${c.timers.map(t => `<tr><td><code>${esc(t.name)}</code></td><td>${'frame' in t ? 'every frame' : 'every' in t ? `every ${esc(t.every)} ms` : `after ${esc(t.after)} ms`} → <code>${esc(t.frame ?? t.action ?? '?')}</code>${t.background ? ' <small class="unk">background</small>' : ''}</td></tr>`).join('')}</table></section>`)
    if (c.uses?.length) out.push(`<section class="dsec"><h3>Behaviors</h3><div class="chips">${c.uses.map(u => chip(`${u.key}: ${u.behavior ?? '?'}`, '', u.status === 'invalid' ? 'bad' : '')).join('')}</div></section>`)
    if (c.agent) {
      const a = c.agent
      out.push(`<section class="dsec"><h3>AI agent surface</h3><div class="agent">
        <div style="margin-bottom:6px"><b>${esc(a.tools ?? '?')}</b>${a.read ? ' <span class="tag">reads page state</span>' : ''}${a.partial ? ' <span class="tag">partial</span>' : ''}</div>
        ${a.description ? `<div class="unk" style="margin-bottom:6px">${esc(a.description)}</div>` : ''}
        ${(a.actions || []).map(x => `<div class="tool"><code>${esc(x.name)}</code>${x.input ? '<span class="tag">input</span>' : ''}${x.consequential ? '<span class="tag danger">asks the user first</span>' : ''}</div>`).join('')}
        ${(a.queries || []).map(x => `<div class="tool"><code>${esc(x.name)}</code><span class="tag">query</span>${x.input ? '<span class="tag">input</span>' : ''}</div>`).join('')}
      </div></section>`)
    }

    const inner = $('dinner')
    inner.innerHTML = out.join('')
    $('dclose').onclick = () => { const id = selected; select(null); nodeEls.get(id)?.focus() }
    const cp = $('dcopy')
    const raw = () => c.diff === 'removed' ? (META.base.graph.components || []).find(x => 'base:' + x.id === c.id) : (G.components || []).find(x => x.id === c.id)
    const rtOnly = c.rt && !c.file
    if (cp) cp.onclick = () => copy(JSON.stringify(rtOnly ? c.rt.raw : raw() ?? null, null, 2), rtOnly ? 'Instances JSON copied' : 'Component JSON copied')
    if (c.rt) rtFetch(c, inner)
    inner.querySelectorAll('[data-goto]').forEach(n => { n.onclick = () => select(n.dataset.goto, { pan: true }) })
    inner.querySelectorAll('[data-trace-event]').forEach(n => { n.onclick = () => trace('event', n.dataset.traceEvent) })
    inner.querySelectorAll('[data-trace-context]').forEach(n => { n.onclick = () => trace('context', n.dataset.traceContext) })
    inner.querySelectorAll('[data-trace-action]').forEach(n => { n.onclick = () => trace('action', n.dataset.traceAction) })
    inner.querySelectorAll('[data-trace-state]').forEach(n => { n.onclick = () => trace('state', n.dataset.traceState) })
  }

  // ───────────── sidebar: stats, health, the component list ─────────────
  function drawSidebar() {
    const real = comps.filter(c => !c.ghost && c.diff !== 'removed')
    const sev = (s) => M.diagnostics.filter(d => d.severity === s).length
    $('title').textContent = META.title ?? 'app'
    $('subtitle').textContent = META.subtitle ?? ''
    $('stats').innerHTML = [
      [real.length, 'components'], ...(M.runtime ? [[real.reduce((n, c) => n + c.rt.count, 0), 'instances']] : []), [Object.keys(events).length, 'event types'], [real.reduce((n, c) => n + c.actions.length, 0), 'actions'],
      [sev('error'), 'errors', 'err'], [sev('warn'), 'warnings', 'warn'], [real.filter(c => c.agent).length, 'agent surfaces'],
    ].map(([n, l, cls]) => `<div class="stat ${n && cls ? cls : ''}"><b>${n}</b><span>${l}</span></div>`).join('')
    $('health').innerHTML = health.length
      ? health.map((h, gi) => `<details class="health-group" ${gi < 3 && h.tone !== 'ai' && h.tone !== 'muted' ? 'open' : ''}><summary><span class="dot tone-${h.tone}"></span>${esc(h.group)}<span class="n">${h.items.length}</span></summary><ul class="plain">${h.items.map((it, i) => `<li><button type="button" class="health-item" data-g="${gi}" data-i="${i}"><span class="dot tone-${h.tone}"></span><span class="t">${esc(it.title)}<small title="${esc(it.sub)}">${it.at != null ? esc(V.rtTime(it.at)) + ' · ' : ''}${esc(it.sub)}</small></span></button></li>`).join('')}</ul></details>`).join('')
      : '<div class="empty">✓ No wiring problems found</div>'
    drawDiffSummary()
    $('health').querySelectorAll('.health-item').forEach(n => {
      n.onclick = () => { const it = health[n.dataset.g].items[n.dataset.i]; if (it.event) trace('event', it.event); else if (it.id) select(it.id, { pan: true }) }
    })
    drawTree()
  }
  /**
   * The outline (V-4): the component list as a directory tree. A directory that is a group of the
   * drawing (medium and large tiers) folds with it; the others keep their own open state (by path).
   * A folded directory's components are not in the DOM until it opens.
   */
  function drawTree() {
    const root = V.dirTree(M, tier.grouped ? groupOf : null)
    const folded = new Set(P.groups.filter(g => g.folded).map(g => g.key))
    const isOpen = (n) => n.group != null && tier.grouped && !ui.focusKey ? !folded.has(n.group) : ui.tree.get(n.path) ?? true
    const item = (id) => {
      const c = byId.get(id), n = diagCount(c), w = V.worst(c), route = V.routeLabel(c)
      return `<li><button type="button" class="tree-item${P.rep.has(id) ? '' : ' filtered'}${DX ? V.diffNodeClass(c) : ''}"data-id="${esc(c.id)}" aria-current="${String(c.id === selected)}" aria-label="${esc(describe(c))}"><span class="k ${kindClass(c.kind)}"></span>${esc(nameOf(c))}${route != null ? ` <span class="unk">${esc(route)}</span>` : ''}${c.entry === true ? ' <span class="tag">entry</span>' : ''}${c.viewOnly ? ' <span class="unk">·</span>' : ''}${n ? `<span class="badge kind ${w === 'error' ? 'k-err' : 'k-warn'}">${n}</span>` : ''}</button></li>`
    }
    const dir = (n) => {
      const open = isOpen(n)
      const grp = n.group != null && tier.grouped
      return `<li class="tree-node"><button type="button" class="tree-toggle" aria-expanded="${open}" data-path="${esc(n.path)}"${grp ? ` data-group="${esc(n.group)}"` : ''} title="${esc(n.path)}">${esc(dirLabel(n.name))}${grp && !open ? ' <span class="gtag">folded</span>' : ''}<span class="n">${n.count}</span></button>`
        + (open ? `<ul class="tree-kids">${n.dirs.map(dir).join('')}${n.comps.map(item).join('')}</ul>` : '') + '</li>'
    }
    $('tree').innerHTML = `<ul class="plain">${root.dirs.map(dir).join('')}${root.comps.map(item).join('')}</ul>`
    $('tree').querySelectorAll('.tree-item').forEach(n => { n.onclick = () => { select(n.dataset.id, { pan: true }); if (innerWidth <= 700) $('side').classList.remove('open') } })
    $('tree').querySelectorAll('.tree-toggle').forEach(n => {
      n.onclick = () => {
        const open = n.getAttribute('aria-expanded') === 'true', path = n.dataset.path
        if (n.dataset.group != null && !ui.focusKey) { if (open) foldGroup(n.dataset.group); else openGroup(n.dataset.group) } else { ui.tree.set(path, !open); drawTree() }
        $('tree').querySelector(`.tree-toggle[data-path="${CSS.escape(path)}"]`)?.focus()
      }
    })
  }
  /** V-6: the sidebar's "Changes" section (diff.js), after the stats; gone without a diff. */
  function drawDiffSummary() {
    let sec = $('diffsec')
    if (!DX) { sec?.remove(); return }
    if (!sec) {
      sec = doc.createElement('section')
      sec.className = 'sec'; sec.id = 'diffsec'; sec.setAttribute('aria-labelledby', 'h-diff')
      $('stats').closest('.sec').after(sec)
    }
    sec.innerHTML = '<h2 id="h-diff">Changes</h2>' + V.diffSummaryHtml(DX, { esc, byId })
    sec.querySelectorAll('[data-goto]').forEach(n => { n.onclick = () => { if (ui.view !== 'graph') setView('graph'); select(n.dataset.goto, { pan: true }) } })
  }
  drawSidebar()

  // ───────────── search: highlight on the canvas, and a results list (V-4) ─────────────
  // the list works whatever is folded or filtered: picking a result reveals it (opens its group,
  // clears a hiding filter) or traces an EVENTS type
  let matches = [], found = [], active = -1
  const q = $('q'), results = $('results')
  function markMatches() {
    nodeEls.forEach(g => g.classList.remove('match'))
    for (const id of new Set(matches.map(repOf).filter(Boolean))) nodeEls.get(id)?.classList.add('match')
  }
  function showResults(open) {
    results.hidden = !open
    q.setAttribute('aria-expanded', String(open))
    if (!open) { active = -1; q.removeAttribute('aria-activedescendant') }
  }
  function setActive(i) {
    active = Math.max(-1, Math.min(found.length - 1, i))
    results.querySelectorAll('.r').forEach((n, j) => n.classList.toggle('on', j === active))
    const on = results.querySelector('.r.on')
    if (on) { q.setAttribute('aria-activedescendant', on.id); on.scrollIntoView({ block: 'nearest' }) } else q.removeAttribute('aria-activedescendant')
  }
  function pick(i) {
    const r = found[i]
    if (!r) return
    showResults(false)
    if (r.type) { if (ui.view === 'events') { $('ev-q').value = r.type; drawEvents() } else trace('event', r.type) } else { if (ui.view !== 'graph') setView('graph'); select(r.id, { pan: true }) }
  }
  q.addEventListener('input', () => {
    const s = q.value.trim().toLowerCase()
    if (!s) { $('qcount').textContent = ''; matches = []; found = []; markMatches(); showResults(false); if (!selected) clearHl(); return }
    matches = comps.filter(c => hay.get(c.id).includes(s)).map(c => c.id)
    $('qcount').textContent = String(matches.length)
    announce(`${plural(matches.length, 'match')}${matches.length ? '. Arrow down to the results, Enter to show them.' : ''}`)
    markMatches()
    hl(matches, e => matches.includes(e.from) && matches.includes(e.to))
    const res = V.searchResults(M, s, { hay })
    found = [...res.events, ...res.comps]
    results.innerHTML = found.map((r, i) => r.type
      ? `<button type="button" class="r" role="option" id="res-${i}" data-i="${i}" tabindex="-1"><span class="nm">${esc(r.type)}</span><span class="why">${esc(r.why)}</span></button>`
      : `<button type="button" class="r" role="option" id="res-${i}" data-i="${i}" tabindex="-1"><span class="nm">${esc(byId.get(r.id).name)}</span>${r.why ? `<span class="why">${esc(r.why)}</span>` : ''}<small>${esc(r.where)}</small></button>`).join('')
      + (res.count > res.comps.length ? `<div class="more">… ${res.count - res.comps.length} more: refine the search</div>` : '')
      + (!found.length ? '<div class="more">No match</div>' : '')
    results.querySelectorAll('.r').forEach(n => {
      n.addEventListener('mousedown', (e) => e.preventDefault())
      n.onclick = () => pick(Number(n.dataset.i))
    })
    active = -1
    showResults(doc.activeElement === q)
  })
  q.addEventListener('focus', () => { if (q.value.trim()) showResults(true) })
  q.addEventListener('blur', () => setTimeout(() => { if (doc.activeElement !== q) showResults(false) }, 120))
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!found.length) return
      e.preventDefault()
      showResults(true)
      setActive(active + (e.key === 'ArrowDown' ? 1 : -1))
      return
    }
    if (e.key === 'Enter') {
      if (active >= 0) { pick(active); return }
      showResults(false)
      if (matches.length) { if (matches.length === 1) select(matches[0], { pan: true }); else fit(matches, true, 1) } else if (found.length) pick(0)
    }
    if (e.key === 'Escape') { q.value = ''; q.dispatchEvent(new Event('input')); q.blur() }
  })

  // ───────────── overlays, menu, editor, theme, export, keys ─────────────
  const toggle = (id, cls, invert, dflt) => {
    const b = $(id)
    const set = (on) => { b.setAttribute('aria-pressed', String(on)); svg.classList.toggle(cls, invert ? !on : on) }
    set(store.get(id, dflt) === 'true')
    b.onclick = () => { const on = !pressed(id); set(on); store.set(id, on) }
  }
  toggle('t-events', 'hide-events', true, 'true')
  toggle('t-context', 'hide-context', true, 'true')
  toggle('t-parent', 'hide-parent', true, 'true')
  toggle('t-labels', 'show-labels', false, 'false')
  const menu = $('menu'), menuBtn = $('menu-btn')
  const closeMenu = () => { menu.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false') }
  menuBtn.onclick = (e) => { e.stopPropagation(); const open = !menu.classList.contains('open'); menu.classList.toggle('open', open); menuBtn.setAttribute('aria-expanded', String(open)); if (open) menu.querySelector('button, select')?.focus() }
  doc.addEventListener('click', (e) => { if (!e.target.closest('.menu')) closeMenu() })
  // a menu command closes the menu (after its own handler ran)
  menu.addEventListener('click', (e) => { if (e.target.closest('button')) setTimeout(() => { closeMenu(); menuBtn.focus() }) })
  menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); menuBtn.focus() } })
  $('side-btn').onclick = () => { const open = !$('side').classList.contains('open'); $('side').classList.toggle('open', open); $('side-btn').setAttribute('aria-expanded', String(open)) }

  // the editor: a remembered choice wins, unless --editor names a different default than when it was made
  {
    const flag = EDITORS.includes(META.editor) ? META.editor : null
    const saved = store.get('editor', null)
    const savedFlag = store.get('editor-default', null)
    let ed = saved && EDITORS.includes(saved) ? saved : flag ?? 'vscode'
    if (flag && flag !== savedFlag) { ed = flag; store.set('editor', flag); store.set('editor-default', flag) }
    editorSel.value = ed
    editorSel.onchange = () => { store.set('editor', editorSel.value); if (flag) store.set('editor-default', flag); if (selected) renderDetail(byId.get(selected)) }
  }
  const theme = store.get('theme', null)
  if (theme === 'light' || theme === 'dark') doc.documentElement.dataset.theme = theme
  $('m-theme').onclick = () => { const dark = getComputedStyle(doc.documentElement).colorScheme === 'dark'; doc.documentElement.dataset.theme = dark ? 'light' : 'dark'; store.set('theme', doc.documentElement.dataset.theme) }
  function download(name, text, type) { const a = doc.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000) }
  function copy(text, msg) {
    const done = () => toast(msg), fail = () => toast('Copy failed')
    try { navigator.clipboard ? navigator.clipboard.writeText(text).then(done, fail) : fail() } catch (_) { fail() }
  }
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 1600) }
  $('m-json').onclick = () => download('sygnal-graph.json', JSON.stringify(G, null, 2), 'application/json')
  $('m-svg').onclick = () => {
    const clone = svg.cloneNode(true), b = V.bbox(pos, [...pos.keys()])
    clone.setAttribute('viewBox', `${b.x0} ${b.y0} ${b.x1 - b.x0} ${b.y1 - b.y0}`); clone.setAttribute('width', b.x1 - b.x0); clone.setAttribute('height', b.y1 - b.y0)
    clone.querySelector('#vp').removeAttribute('transform'); clone.querySelector('#bgrect').remove(); clone.querySelector('#hl-layer').replaceChildren(); clone.classList.remove('dim')
    const cs = getComputedStyle(doc.documentElement)
    const rules = [...doc.styleSheets[0].cssRules]
    const rootRule = rules.find(r => r.selectorText === ':root')
    const vars = rootRule ? [...rootRule.style].filter(v => v.startsWith('--')).map(v => `${v}:${cs.getPropertyValue(v)}`).join(';') : ''
    const css = rules.filter(r => /^(\.node|\.edge|\.elabel|\.cluster)/.test(r.selectorText || '')).map(r => r.cssText).join('\n')
    const style = doc.createElementNS(SVGNS, 'style'); style.textContent = `svg{${vars};font-family:system-ui,sans-serif;background:${cs.getPropertyValue('--bg')}}\n${css}`
    clone.insertBefore(style, clone.firstChild); clone.setAttribute('xmlns', SVGNS)
    download('sygnal-graph.svg', new XMLSerializer().serializeToString(clone), 'image/svg+xml')
  }
  $('m-mermaid').onclick = () => copy(V.toMermaid(M, { events: pressed('t-events') }), 'Mermaid flowchart copied')

  doc.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === '/') { e.preventDefault(); q.focus() }
    else if ((e.key === 'f' || e.key === 'F') && !e.target.closest('.menu-pop')) fit()
    else if (e.key === 'Escape') {
      if (closeFilters()) return
      if (ui.view !== 'graph') { setView('graph'); return }
      const id = selected; select(null); endTrace(); if (id && e.target.closest('#detail')) nodeEls.get(id)?.focus()
    }
  })
  addEventListener('resize', () => { if (!moved) fit(undefined, false) })

  /**
   * Replaces the graph in place (live mode, the VS Code panel): redraws, and keeps the view, the
   * selection, the keyboard position, a running trace and the search by component `key` (ids are
   * file:line and move when lines are added above a component).
   */
  function setGraph(graph) {
    const keyOf = (id) => id == null ? null : byId.get(id)?.key ?? null
    const wasMoved = moved, wasView = { ...view }
    const was = { sel: keyOf(selected), stop: keyOf(tabStop), focus: doc.activeElement?.closest?.('.node') ? keyOf(doc.activeElement.dataset.id) : null, trace: tracing, detailScroll: $('dinner').scrollTop }
    load(graph)
    selected = null; tabStop = null; tracing = null
    drawGraph()
    drawSidebar()
    drawChrome()
    buildMinimap()
    if (ui.view === 'events') drawEvents()
    reflash()
    const idOf = (key) => key == null ? null : M.byKey.get(key) ?? null
    if (idOf(was.stop)) setTabStop(idOf(was.stop)); else initTabStop()
    restoring = true
    try {
      if (idOf(was.sel)) { select(idOf(was.sel), { keepView: true }); $('dinner').scrollTop = was.detailScroll } else select(null)
      if (was.trace) trace(was.trace.kind, was.trace.key, { fit: false })
      if (q.value) q.dispatchEvent(new Event('input'))
      if (idOf(was.focus)) nodeEls.get(idOf(was.focus))?.focus({ preventScroll: true })
    } finally { restoring = false }
    // a view the user moved stays exactly where it was (a running animation finishes); an untouched one fits the new graph
    if (wasMoved) { moved = true; if (!animating) { view = wasView; apply() } } else fit(undefined, false)
  }

  // ───────────── large apps (V-4, D536): groups, focus, filters, views, minimap, canvas ─────────────
  /** Projects and draws again after the UI state changed (a group opened, the focus, a filter). */
  function relayout(opts = {}) {
    const stop = tabStop
    project()
    drawGraph()
    tabStop = null
    if (stop && nodeEls.has(stop)) setTabStop(stop); else initTabStop()
    if (selected) nodeEls.get(selected)?.classList.add('sel')
    if (q.value.trim()) markMatches()
    drawTree()
    drawChrome()
    buildMinimap()
    if (opts.fit) fit(undefined, false)
  }
  const groupNodes = (key) => P.nodes.filter(n => n.type === 'comp' && groupOf.get(n.id) === key).map(n => n.id)
  function openGroup(key) {
    ui.closed.delete(key)
    if (tier.folded) ui.open.add(key)
    relayout()
    const ids = groupNodes(key)
    if (ids.length) fit(ids, true, 1)
    announce(`Opened ${dirLabel(key)}: ${plural(ids.length, 'component')}`)
  }
  function foldGroup(key) {
    ui.open.delete(key)
    if (!tier.folded) ui.closed.add(key)
    relayout()
    if (pos.has('grp:' + key)) ensureVisible('grp:' + key)
    announce(`Folded ${dirLabel(key)}`)
  }
  function openAll() { ui.closed.clear(); if (tier.folded) for (const k of new Set(groupOf.values())) ui.open.add(k); ui.focusKey = null; relayout({ fit: true }) }
  function foldAll() { ui.open.clear(); if (!tier.folded) for (const k of new Set(groupOf.values())) ui.closed.add(k); ui.focusKey = null; relayout({ fit: true }) }
  /** Leaves focus mode, keeping the selection (its group stays open). */
  function showAll() {
    const id = selected
    ui.focusKey = null
    relayout()
    if (id) select(id, { noFocus: true, pan: true }); else fit(undefined, false)
  }
  function setFilter(f) {
    ui.filter = { ...f }
    for (const k of Object.keys(ui.filter)) if (!ui.filter[k]) delete ui.filter[k]
    relayout({ fit: true })
    if (selected) renderDetail(byId.get(selected)) // "hide behavior actions" changes the panel too
    syncFilterMenu()
  }

  // the toolbar: view switch, filter menu, what is shown; the focus breadcrumbs
  const main = svg.closest('main')
  function drawChrome() {
    const nf = V.filterCount(ui.filter)
    $('filter-n').textContent = nf ? String(nf) : ''
    const folded = P.groups.filter(g => g.folded).length
    const info = []
    if (P.shown !== P.total) info.push(`${P.shown} of ${P.total} shown`)
    if (tier.grouped && !ui.focusKey) info.push(`${plural(P.groups.length, 'group')}${folded ? `, ${folded} folded` : ''}`)
    if (canvasMode) info.push('canvas')
    $('tierinfo').textContent = info.join(' · ')
    const cr = $('crumbs')
    if (!P.focus) { cr.classList.remove('on'); cr.textContent = ''; return }
    cr.innerHTML = '<span class="unk">Focus:</span> ' + P.crumbs.map(id => `<button type="button" data-goto="${esc(id)}">${esc(byId.get(id).name)}</button>`).join('<span class="sep">›</span>')
      + ` <span class="unk">· ancestors, children to depth 2, EVENTS / context / PARENT peers (${P.shown} of ${P.total})</span><button type="button" class="crumb-x" id="crumbs-x">Show all</button>`
    cr.classList.add('on')
    cr.querySelectorAll('[data-goto]').forEach(n => { n.onclick = () => select(n.dataset.goto) })
    $('crumbs-x').onclick = showAll
  }
  // the filter menu (D536: kind, only problems, hide view-only, hide behavior actions, AI surface
  // only, unreachable from any entry; SYG172 is page-only, D534)
  const filters = $('filters'), filterBtn = $('filter-btn')
  const KINDS = [['', 'any kind'], ['root', 'root'], ['child', 'child'], ['collection-item', 'collection item'], ['switchable', 'switchable']]
  filters.innerHTML = `<label>Kind <select id="f-kind">${KINDS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>`
    + V.FILTERS.map(([k, l]) => `<label id="fl-${k}"><input type="checkbox" data-f="${k}"> ${esc(l)}</label>`).join('')
    + '<small id="f-unreach-note" hidden>No entry is known (run(), defineElement(), a Vike page), so nothing can be checked.</small>'
    + '<hr><button type="button" id="f-clear">Clear filters</button><button type="button" id="g-open">Open all groups</button><button type="button" id="g-fold">Fold all groups</button>'
  function syncFilterMenu() {
    $('f-kind').value = ui.filter.kind ?? ''
    filters.querySelectorAll('input[data-f]').forEach(i => { i.checked = !!ui.filter[i.dataset.f] })
    const noEntry = !M.comps.some(c => c.entry === true)
    const un = filters.querySelector('input[data-f="unreachable"]')
    un.disabled = noEntry && !ui.filter.unreachable
    $('fl-unreachable').classList.toggle('off', un.disabled)
    $('f-unreach-note').hidden = !noEntry
    $('g-open').hidden = $('g-fold').hidden = !tier.grouped
    $('fl-changes').style.display = !DX && !ui.filter.changes ? 'none' : '' // V-6: only with a diff
  }
  syncFilterMenu()
  $('f-kind').onchange = () => setFilter({ ...ui.filter, kind: $('f-kind').value })
  filters.querySelectorAll('input[data-f]').forEach(i => { i.onchange = () => setFilter({ ...ui.filter, [i.dataset.f]: i.checked }) })
  $('f-clear').onclick = () => setFilter({})
  $('g-open').onclick = () => { closeFilters(); openAll() }
  $('g-fold').onclick = () => { closeFilters(); foldAll() }
  function closeFilters() {
    if (!filters.classList.contains('open')) return false
    filters.classList.remove('open'); filterBtn.setAttribute('aria-expanded', 'false'); filterBtn.focus()
    return true
  }
  filterBtn.onclick = (e) => { e.stopPropagation(); const open = !filters.classList.contains('open'); filters.classList.toggle('open', open); filterBtn.setAttribute('aria-expanded', String(open)); if (open) { syncFilterMenu(); filters.querySelector('select, input')?.focus() } }
  doc.addEventListener('click', (e) => { if (!e.target.closest('.fmenu') && filters.classList.contains('open')) { filters.classList.remove('open'); filterBtn.setAttribute('aria-expanded', 'false') } })

  // the views: the graph, or the EVENTS table (type × emitters × selectors, every row clickable)
  function setView(v) {
    ui.view = v === 'events' ? 'events' : 'graph'
    $('v-graph').setAttribute('aria-pressed', String(ui.view === 'graph'))
    $('v-events').setAttribute('aria-pressed', String(ui.view === 'events'))
    $('events-view').hidden = ui.view !== 'events'
    buildMinimap()
    if (ui.view === 'events') { drawEvents(); $('ev-q').focus() }
  }
  $('v-graph').onclick = () => setView('graph')
  $('v-events').onclick = () => setView('events')
  let evSort = 'type'
  function drawEvents() {
    const rows = V.eventsTable(M, { q: $('ev-q').value, sort: evSort })
    const total = Object.keys(events).length
    $('ev-n').textContent = `${rows.length} of ${plural(total, 'type')}`
    const list = (ids) => ids.length ? `<span class="chips">${ids.map(id => { const c = byId.get(id), w = V.where(M, c); return btnChip(c.name + (w ? ` · ${w}` : ''), `data-goto="${esc(id)}"`) }).join('')}</span>` : '<span class="none">⚠ none</span>'
    const th = (k, l) => `<th scope="col" aria-sort="${evSort === k ? (k === 'type' ? 'ascending' : 'descending') : 'none'}"><button type="button" data-s="${k}">${l}</button></th>`
    const shown = rows.slice(0, 1000)
    $('evtable').innerHTML = `<thead><tr>${th('type', 'Event type')}${th('emitters', 'Emitted by')}${th('selectors', 'Selected (handled) by')}</tr></thead><tbody>`
      + shown.map(r => `<tr><td>${btnChip(r.type, `data-ev="${esc(r.type)}"`, '', `trace EVENTS ${r.type} in the graph`)}</td><td>${list(r.emitters)}</td><td>${list(r.selectors)}</td></tr>`).join('')
      + (rows.length > shown.length ? `<tr><td colspan="3" class="unk">… ${rows.length - shown.length} more: filter the table</td></tr>` : '') + '</tbody>'
    $('evtable').querySelectorAll('[data-s]').forEach(b => { b.onclick = () => { evSort = b.dataset.s; drawEvents() } })
    $('evtable').querySelectorAll('[data-goto]').forEach(b => { b.onclick = () => { setView('graph'); select(b.dataset.goto, { pan: true }) } })
    $('evtable').querySelectorAll('[data-ev]').forEach(b => { b.onclick = () => { setView('graph'); trace('event', b.dataset.ev) } })
  }
  $('ev-q').addEventListener('input', drawEvents)

  // the minimap (medium and large tiers): the drawing as boxes, cached; the viewport on top
  const mm = $('minimap')
  let mmImg = null, mmT = null
  function buildMinimap() {
    // only when the drawing is larger than the window (a focus view usually isn't)
    const ids = [...pos.keys()], b = V.bbox(pos, ids), sr = svg.getBoundingClientRect()
    const show = !!tier.minimap && ui.view === 'graph' && ((b.x1 - b.x0) > sr.width * 1.25 || (b.y1 - b.y0) > sr.height * 1.25)
    mm.hidden = !show
    main.classList.toggle('has-minimap', show)
    mmImg = null
    if (!show) return
    const W = mm.width, H = mm.height, k = Math.min(W / (b.x1 - b.x0), H / (b.y1 - b.y0)) * 0.94
    mmT = { k, x: (W - (b.x1 - b.x0) * k) / 2 - b.x0 * k, y: (H - (b.y1 - b.y0) * k) / 2 - b.y0 * k }
    const off = doc.createElement('canvas')
    off.width = W; off.height = H
    const c = off.getContext('2d'), cs = getComputedStyle(doc.documentElement), css = (v) => cs.getPropertyValue(v).trim()
    c.strokeStyle = css('--line')
    for (const bx of L.clusters) c.strokeRect(mmT.x + bx.x * k, mmT.y + bx.y * k, bx.w * k, bx.h * k)
    for (const n of P.nodes) {
      const p = pos.get(n.id)
      if (!p) continue
      const w = n.comp ? V.worst(n.comp) : n.err ? 'error' : null
      c.fillStyle = w === 'error' ? css('--err') : n.type === 'group' ? css('--accent') : n.type === 'bus' ? css('--ev') : css('--faint')
      c.fillRect(mmT.x + p.x * k, mmT.y + p.y * k, Math.max(1.5, p.w * k), Math.max(1.5, p.h * k))
    }
    mmImg = off
    drawMinimapView()
  }
  function drawMinimapView() {
    if (!mmImg) return
    const c = mm.getContext('2d'), r = svg.getBoundingClientRect()
    c.clearRect(0, 0, mm.width, mm.height)
    c.drawImage(mmImg, 0, 0)
    c.strokeStyle = getComputedStyle(doc.documentElement).getPropertyValue('--accent').trim()
    c.lineWidth = 3
    c.strokeRect(mmT.x - view.x / view.k * mmT.k, mmT.y - view.y / view.k * mmT.k, r.width / view.k * mmT.k, r.height / view.k * mmT.k)
  }
  {
    let mmDrag = false
    const mmPan = (e) => {
      const r = mm.getBoundingClientRect(), cr = svg.getBoundingClientRect()
      const wx = ((e.clientX - r.left) * mm.width / r.width - mmT.x) / mmT.k, wy = ((e.clientY - r.top) * mm.height / r.height - mmT.y) / mmT.k
      stopAnim()
      view = { ...view, x: cr.width / 2 - wx * view.k, y: cr.height / 2 - wy * view.k }
      apply()
    }
    mm.addEventListener('pointerdown', (e) => { if (!mmT) return; mmDrag = true; mm.setPointerCapture(e.pointerId); mmPan(e) })
    mm.addEventListener('pointermove', (e) => { if (mmDrag) mmPan(e) })
    mm.addEventListener('pointerup', () => { mmDrag = false })
  }

  // the canvas renderer (canvas.js): only when more than V.CANVAS_NODES nodes are drawn
  function paint() {
    if (paintQueued) return
    paintQueued = true
    requestAnimationFrame(paintNow)
  }
  function paintNow() {
    paintQueued = false
    if (!canvasMode) return
    const cv = $('cv'), r = svg.getBoundingClientRect(), dpr = devicePixelRatio || 1
    if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr) }
    const ctx = cv.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const cs = getComputedStyle(doc.documentElement), css = (v) => cs.getPropertyValue(v).trim()
    const colors = {}
    for (const [k, v] of Object.entries({ line: '--line', edge: '--edge', card: '--card', bg: '--bg', ink: '--ink', muted: '--muted', ev: '--ev', ctx: '--ctx', par: '--par', err: '--err', warn: '--warn', accent: '--accent', coll: '--k-coll', switch: '--k-switch' })) colors[k] = css(v)
    V.paintCanvas(ctx, { P, L, routes }, { ...view, width: r.width, height: r.height }, {
      colors, far: view.k < FAR_K, hl: hlState?.ids ?? null, hlEdge: hlState?.pred ?? null, selected: selected ? repOf(selected) : null,
      hidden: { event: !pressed('t-events'), context: !pressed('t-context'), parent: !pressed('t-parent') },
    })
  }
  drawChrome()
  buildMinimap()

  // ───────────── runtime (V-3): instance state from the host, flashes on actions ─────────────
  // state values by instance id: fetched for the selected card's open instances, kept across setGraph
  const rtStates = {}
  let rtHost = null
  function rtFill(inner, id) {
    const pre = [...inner.querySelectorAll('.rt-inst')].find(d => d.dataset.inst === id)?.querySelector('.rt-state')
    if (pre && Object.prototype.hasOwnProperty.call(rtStates, id)) { pre.textContent = V.rtStateText(rtStates[id]); pre.classList.remove('unk') }
  }
  function rtFetch(c, inner) {
    const want = (id) => {
      if (typeof rtHost?.getState !== 'function') return
      let v
      try { v = rtHost.getState(id) } catch (_) { return }
      Promise.resolve(v).then(val => {
        if (val === undefined) return
        rtStates[id] = val
        if (selected === c.id) rtFill($('dinner'), id)
      }, () => {})
    }
    inner.querySelectorAll('.rt-inst').forEach(d => {
      if (d.open) want(d.dataset.inst)
      d.addEventListener('toggle', () => { if (d.open) want(d.dataset.inst) })
    })
  }
  // a flash in progress survives a redraw (setGraph): it goes on where it was, by card key
  const FLASH_MS = 900, flashing = new Map()
  function flash(cardId, elapsed = 0) {
    const n = nodeEls.get(cardId)
    if (!n) return false
    if (!elapsed) flashing.set(byId.get(cardId).key, performance.now())
    n.classList.remove('flash'); void n.getBBox()
    n.style.setProperty('--flash-delay', `-${Math.round(elapsed)}ms`)
    n.classList.add('flash')
    clearTimeout(n._flashT); n._flashT = setTimeout(() => n.classList.remove('flash'), FLASH_MS + 50 - elapsed)
    return true
  }
  function reflash() {
    const now = performance.now()
    for (const [key, t0] of flashing) {
      const id = M.byKey.get(key)
      if (now - t0 >= FLASH_MS || !id) flashing.delete(key); else flash(id, now - t0)
    }
  }

  fit(undefined, false)
  const first = META.select && comps.find(c => c.name === META.select || c.id === META.select || c.key === META.select)
  if (first) select(first.id, { pan: true })
  // the page's API, for hosts (live mode, the VS Code panel) and tests
  const api = {
    get model() { return M }, get layout() { return L }, get health() { return health },
    get selectedKey() { return selected ? byId.get(selected)?.key ?? null : null },
    get view() { return { ...view } }, get animating() { return animating },
    select, trace, fit, setGraph,
    // V-4: the size tier and what is drawn; groups, focus, filters and views (state kept by key)
    get tier() { return tier }, get projection() { return P }, get renderer() { return canvasMode ? 'canvas' : 'svg' },
    get focusKey() { return ui.focusKey },
    /** V-6: the diff with META.base (diff.js's GraphDiff), else null */
    get diff() { return DX ? DX.diff : null }, get filter() { return { ...ui.filter } }, get viewName() { return ui.view },
    groupOf: (id) => groupOf.get(id) ?? null, openGroup, foldGroup, openAll, foldAll, showAll, setFilter, showView: setView,
    /** Show `v` ({ x, y, k }, as `view` gives it) without animating, as a view the user moved (hosts restoring a saved view). */
    setView(v) {
      if (!v || ![v.x, v.y, v.k].every(Number.isFinite) || v.k <= 0) return
      stopAnim()
      view = { x: v.x, y: v.y, k: v.k }
      apply()
    },
    /** the host (runtime graphs): { getState(instanceId) → value | Promise } */
    get host() { return rtHost }, set host(h) { rtHost = h || null },
    /** an action ran (a devtools ACTIONS record, or one of recentActions): flash its instance's card */
    action(record) { const id = record && M.graph.rtCardOf?.[String(record.instance)]; return id ? flash(id) : false },
    /** an instance's state changed (the host pushes it): shown when its card is selected */
    state(instanceId, value) { const id = String(instanceId); rtStates[id] = value; if (selected && M.graph.rtCardOf?.[id] === selected) rtFill($('dinner'), id) },
    /** replays the graph's recentActions as flashes, `speed` times faster; returns how many */
    replay(speed = 4) { const list = G.recentActions || []; const t0 = list.length ? list[0].at : 0; for (const r of list) setTimeout(() => api.action(r), (r.at - t0) / speed); return list.length },
  }
  window.__sygnalGraph = api
  return api
}
