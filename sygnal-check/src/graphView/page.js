/**
 * The page's DOM layer (PLAN-10 V-1, V-5): draws what model.js and layout.js computed and wires
 * selection, trace, search, overlays, pan / zoom, the keyboard and export. Everything it shows
 * comes from the graph; it runs no app code and makes no network request.
 *
 *   mountPage(V, G, META)
 *     V     the pure modules' exports (buildModel, healthList, layoutGraph, edgePaths, bbox,
 *           toMermaid, …), as html.js inlines them
 *     G     the InspectGraph
 *     META  { title, subtitle?, root?, editor?, select?, codes?: { SYGnnn: title } }
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
  function load(graph) {
    G = graph
    M = V.buildModel(G)
    ;({ comps, byId, parentsOf, childrenOf, renderEdges, contextEdges } = M)
    health = V.healthList(M, META.codes || {})
    L = V.layoutGraph(M)
    pos = L.pos
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
  const fileLine = (c) => `${c.file}${c.line != null ? ':' + c.line : ''}`
  const describe = (c) => c.ghost
    ? `${c.name}, ${ghostWhat(c)}`
    : `${c.name}, ${KIND[c.kind] ?? c.kind}${c.entry === true ? ', entry' : ''}${c.viewOnly ? ', view only' : ''}${diagCount(c) ? `, ${plural(diagCount(c), 'problem')}` : ''}`
  function drawGraph() {
    for (const g of ['clusters', 'edges', 'labels', 'nodes']) $(g).textContent = ''
    nodeEls.clear()
    edgeEls.length = 0
    for (const b of L.clusters) {
      const g = el('g', { class: 'cluster', 'aria-hidden': 'true' }, $('clusters'))
      el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 14 }, g)
      el('text', { x: b.x + 14, y: b.y + 22 }, g).textContent = b.key + '/'
    }
    for (const e of V.edgePaths(M, L)) {
      const p = el('path', { class: 'edge ' + e.cls, d: e.d, 'marker-end': `url(#${e.marker})` }, $('edges'))
      let t = null
      if (e.label) { t = el('text', { class: 'elabel ' + e.cls, x: e.mid[0], y: e.mid[1], 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, $('labels')); t.textContent = e.label }
      edgeEls.push({ ...e, p, t })
    }
    for (const c of comps) {
      const p = pos.get(c.id)
      const w = V.worst(c)
      const cls = ['node', c.ghost && 'ghost', c.external && 'external', c.widget && 'widget', c.viewOnly && 'view-only', c.entry === true && 'entry'].filter(Boolean).join(' ')
      const g = el('g', { class: cls + (w === 'error' ? ' has-err' : w === 'warn' ? ' has-warn' : ''), transform: `translate(${p.x},${p.y})`, tabindex: -1, role: 'button', 'aria-label': describe(c), 'data-id': c.id }, $('nodes'))
      el('rect', { class: 'box', width: p.w, height: p.h, rx: 11 }, g)
      if (!c.ghost) el('rect', { x: 0, y: 10, width: 3.5, height: p.h - 20, rx: 2, fill: `var(--${{ root: 'k-root', 'collection-item': 'k-coll', switchable: 'k-switch' }[c.kind] ?? 'k-child'})` }, g)
      el('text', { class: 'name', x: 16, y: 24 }, g).textContent = c.name.length > 22 ? c.name.slice(0, 21) + '…' : c.name
      const file = c.ghost ? ghostWhat(c) : `${c.file.split('/').pop()}${c.line != null ? ':' + c.line : ''}`
      el('text', { class: 'sub', x: 16, y: 41 }, g).textContent = file.length > 30 ? '…' + file.slice(-29) : file
      if (!c.ghost) {
        const meta = el('text', { class: 'meta', x: 16, y: 60 }, g)
        const own = c.actions.filter(a => !a.behavior).length, beh = c.actions.length - own
        const parts = [[own, 'act' + (beh ? `+${beh}` : '')], [c.stateKeys.length, 'state'], [c.eventsEmitted.length + c.eventsSelected.length, 'events']].filter(([n]) => n)
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
      el('title', {}, g).textContent = c.ghost ? `${c.name}: ${c.external || c.widget ? ghostWhat(c) : 'rendered, but not found in the scanned files'}` : `${c.name}\n${fileLine(c)}`
      g.addEventListener('click', (ev) => { ev.stopPropagation(); select(c.id) })
      g.addEventListener('keydown', (ev) => onNodeKey(ev, c.id))
      g.addEventListener('focus', () => { setTabStop(c.id); if (!selected && !tracing) hover(c.id); if (!restoring) ensureVisible(c.id) })
      g.addEventListener('blur', () => { if (!selected && !tracing) clearHl() })
      g.addEventListener('mouseenter', () => { if (!selected && !tracing) hover(c.id) })
      g.addEventListener('mouseleave', () => { if (!selected && !tracing) clearHl() })
      nodeEls.set(c.id, g)
    }
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
    const first = comps.find(c => c.entry === true) ?? [...comps].sort((a, b) => pos.get(a.id).y - pos.get(b.id).y || pos.get(a.id).x - pos.get(b.id).x)[0]
    if (first) setTabStop(first.id)
  }
  initTabStop()
  const cx = (id) => pos.get(id).x + pos.get(id).w / 2
  const nearest = (from, ids) => ids.slice().sort((a, b) => Math.abs(cx(a) - cx(from)) - Math.abs(cx(b) - cx(from)) || cx(a) - cx(b))[0]
  function neighbour(id, key) {
    if (key === 'ArrowUp') return nearest(id, parentsOf.get(id).filter(p => p !== id))
    if (key === 'ArrowDown') return nearest(id, childrenOf.get(id).filter(c => c !== id))
    const p = pos.get(id)
    const row = comps.map(c => c.id).filter(o => o !== id && Math.abs(pos.get(o).y - p.y) < 1)
    const side = key === 'ArrowLeft' ? row.filter(o => pos.get(o).x < p.x) : row.filter(o => pos.get(o).x > p.x)
    return side.sort((a, b) => Math.abs(pos.get(a).x - p.x) - Math.abs(pos.get(b).x - p.x))[0]
  }
  function onNodeKey(ev, id) {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(id); return }
    if (!ev.key.startsWith('Arrow')) return
    ev.preventDefault()
    const next = neighbour(id, ev.key)
    if (next) nodeEls.get(next).focus()
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
    const r = visibleRect(), p = pos.get(id)
    const sx = view.x + p.x * view.k, sy = view.y + p.y * view.k
    if (centre || sx < 20 || sy < 20 || sx + p.w * view.k > r.width - 20 || sy + p.h * view.k > r.height - 20) {
      const k = Math.max(view.k, 0.85)
      animateTo({ k, x: r.width / 2 - (p.x + p.w / 2) * k, y: r.height / 2.4 - (p.y + p.h / 2) * k })
    }
  }

  // ───────────── pan / zoom ─────────────
  let view = { x: 0, y: 0, k: 1 }
  const apply = () => vp.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`)
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
  function fit(ids = comps.map(c => c.id), animate = true, maxK = 1.15) {
    const r = visibleRect(), b = V.bbox(pos, ids)
    if (!r.width || !r.height) return
    const k = Math.min(r.width / (b.x1 - b.x0), r.height / (b.y1 - b.y0), maxK)
    const t = { k, x: (r.width - (b.x1 - b.x0) * k) / 2 - b.x0 * k, y: (r.height - (b.y1 - b.y0) * k) / 2 - b.y0 * k }
    if (animate) animateTo(t); else { anim++; animating = false; view = t; apply() }
  }
  function zoomAt(f, x, y) { stopAnim(); const k = Math.max(0.12, Math.min(3, view.k * f)); const r = k / view.k; view = { k, x: x - (x - view.x) * r, y: y - (y - view.y) * r }; apply() }
  svg.addEventListener('wheel', (e) => {
    e.preventDefault()
    const r = svg.getBoundingClientRect()
    if (e.ctrlKey || e.metaKey || e.deltaMode === 1) zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01)), e.clientX - r.left, e.clientY - r.top)
    else { stopAnim(); view.x -= e.deltaX; view.y -= e.deltaY; apply() }
  }, { passive: false })
  let drag = null
  svg.addEventListener('pointerdown', (e) => { if (e.target.closest('.node')) return; drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }; svg.setPointerCapture(e.pointerId); svg.classList.add('panning') })
  svg.addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true; stopAnim(); view.x = drag.vx + dx; view.y = drag.vy + dy; apply() })
  svg.addEventListener('pointerup', () => { if (drag && !drag.moved) { select(null); endTrace() } drag = null; svg.classList.remove('panning') })
  const centre = () => { const r = svg.getBoundingClientRect(); return [r.width / 2, r.height / 2] }
  $('zin').onclick = () => zoomAt(1.25, ...centre())
  $('zout').onclick = () => zoomAt(0.8, ...centre())
  $('zfit').onclick = () => fit()

  // ───────────── highlight / select / trace ─────────────
  let selected = null, tracing = null
  const pressed = (id) => $(id).getAttribute('aria-pressed') === 'true'
  function clearHl() { svg.classList.remove('dim'); svg.querySelectorAll('.hl').forEach(e => e.classList.remove('hl')) }
  function hl(nodeIds, edgePred) {
    clearHl(); svg.classList.add('dim')
    for (const id of nodeIds) nodeEls.get(id)?.classList.add('hl')
    for (const e of edgeEls) if (edgePred(e)) { e.p.classList.add('hl'); e.t?.classList.add('hl') }
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
  function select(id, opts = {}) {
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
    // the panel narrows the canvas: wait for it, then pan if the card is (partly) hidden
    if (!opts.keepView) setTimeout(() => ensureVisible(id, opts.pan), reduceMotion() ? 0 : 200)
  }
  function trace(kind, key, opts = {}) {
    tracing = { kind, key }
    const ids = new Set()
    let pred = () => false
    let text = ''
    if (kind === 'event') {
      const e = evInfo(key)
      for (const x of edgeEls) if (x.cls === 'event' && x.type === key) { ids.add(x.from); ids.add(x.to) }
      for (const [idList, nameList] of [[e.emitterIds, e.emitters], [e.selectorIds, e.selectors]]) {
        if (Array.isArray(idList)) { for (const x of idList) if (byId.has(x)) ids.add(x) } // D528: full id lists
        else for (const n of names(nameList)) for (const c of M.byName.get(n) || []) ids.add(c.id)
      }
      pred = (x) => x.cls === 'event' && x.type === key
      text = `EVENTS <b>${esc(key)}</b> · ${esc(names(e.emitters).join(', ') || 'no emitter')} → ${esc(names(e.selectors).join(', ') || 'no selector')}`
    } else if (kind === 'context') {
      for (const c of comps) if (c.contextProvides.includes(key) || c.contextConsumes.includes(key)) ids.add(c.id)
      pred = (x) => x.cls === 'context' && x.fields.includes(key)
      text = `context <b>${esc(key)}</b> · provided by ${esc(comps.filter(c => c.contextProvides.includes(key)).map(c => c.name).join(', ') || 'nobody')}`
    } else if (kind === 'action') {
      for (const c of comps) if (c.actions.some(a => a.name === key)) ids.add(c.id)
      text = `action <b>${esc(key)}</b> · in ${plural(ids.size, 'component')}`
    } else if (kind === 'state') {
      for (const c of comps) if (c.stateKeys.includes(key) || c.calculated.includes(key)) ids.add(c.id)
      for (const e of renderEdges) if (e.label === `[${key}]`) { ids.add(e.from); ids.add(e.to) }
      pred = (x) => x.label === `[${key}]`
      text = `state key <b>${esc(key)}</b> · ${plural(ids.size, 'component')}`
    }
    const t = $('trace')
    t.innerHTML = `<span>${text}</span><button type="button" id="trace-x">Clear</button>`
    t.classList.add('on')
    $('trace-x').onclick = () => { endTrace(); if (selected) hover(selected) }
    announce(t.firstChild.textContent)
    hl(ids, pred)
    if (ids.size && opts.fit !== false) fit([...ids], true, 1)
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
    }).join('')
  }

  function renderDetail(c) {
    const out = []
    out.push(`<div class="dhead"><h2 id="dtitle">${esc(c.name)} <span class="kind ${kindClass(c.kind)}">${esc(kindLabel(c))}</span>${c.entry === true ? ' <span class="tag">entry</span>' : ''}${c.viewOnly ? ' <span class="tag">view only</span>' : ''}<button type="button" class="close" id="dclose" aria-label="Close details (Esc)">×</button></h2>
      <div class="loc">${c.ghost ? (c.external ? `A component from the package <code>${esc(c.external)}</code>${c.widget ? ' (a widget)' : ''}.` : c.widget ? 'A widget (defineWidget, fromReact, fromZag…): its inside is not a Sygnal component.' : 'Rendered by a scanned component, but its definition was not found in the scanned files (a plain function, a dynamic tag, or a file outside the paths).') : fileLink(c.file, c.line, fileLine(c)) + '<span class="spacer"></span><button type="button" class="copy" id="dcopy">Copy JSON</button>'}</div></div>`)

    if (c.diagnostics.length) {
      out.push(`<section class="dsec"><h3>Diagnostics <span class="n">${c.diagnostics.length}</span></h3>${c.diagnostics.map(d => {
        const at = d.line && editorHref(d.file, d.line)
        return `<div class="diag ${esc(d.severity)}"><div class="code">${d.docsUrl ? `<a href="${esc(d.docsUrl)}" target="_blank" rel="noopener noreferrer">${esc(d.code)}</a>` : esc(d.code)}${META.codes?.[d.code] ? ` <span class="title">${esc(META.codes[d.code])}</span>` : ''}${at ? ` · <a href="${esc(at)}">line ${d.line}</a>` : d.line ? ` · line ${d.line}` : ''}</div><div>${esc(d.message)}</div>${d.fix ? `<div class="fix">Fix: ${esc(d.fix)}</div>` : ''}</div>`
      }).join('')}</section>`)
    }

    const rel = []
    const parents = parentsOf.get(c.id).map(id => byId.get(id))
    if (parents.length) rel.push(`<div class="r"><span class="lbl">rendered by</span><span class="chips">${parents.map(nameLink).join('')}</span></div>`)
    const kids = renderEdges.filter(e => e.from === c.id)
    if (kids.length) rel.push(`<div class="r"><span class="lbl">renders</span><span class="chips">${kids.map(e => `<button type="button" class="chip" data-goto="${esc(e.to)}">${esc(byId.get(e.to).name)}${e.label ? ` <small>${esc(e.label)}</small>` : ''}</button>`).join('')}</span></div>`)
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

    if (c.actions.length) {
      const own = c.actions.filter(a => !a.behavior)
      const byB = new Map()
      for (const a of c.actions.filter(a => a.behavior)) { if (!byB.has(a.behavior)) byB.set(a.behavior, []); byB.get(a.behavior).push(a) }
      const used = c.uses || []
      out.push(`<section class="dsec"><h3>Actions <span class="n">trigger → action → sinks</span></h3><div class="flow">${actionRows(own, c)}${[...byB].map(([k, list]) => `<details class="behav"><summary>${esc(k)}.* · ${plural(list.length, 'action')} from the <b>${esc(used.find(u => u.key === k)?.behavior ?? k)}</b> behavior</summary><div class="flow">${actionRows(list, c)}</div></details>`).join('')}</div></section>`)
    }

    const st = [...c.stateKeys.map(k => btnChip(k, `data-trace-state="${esc(k)}"`, '', `trace state key ${k}`)), ...c.calculated.map(k => btnChip(k + ' ƒ', `data-trace-state="${esc(k)}" title="calculated"`, 'calc', `trace calculated field ${k}`))]
    if (st.length) out.push(`<section class="dsec"><h3>State <span class="n">${st.length}</span></h3><div class="chips">${st.join('')}</div></section>`)

    const ctx = []
    if (c.contextProvides.length) ctx.push(`<div class="r"><span class="lbl">provides</span><span class="chips">${c.contextProvides.map(k => btnChip(k, `data-trace-context="${esc(k)}"`, '', `trace context ${k}`)).join('')}</span></div>`)
    if (c.contextConsumes.length) ctx.push(`<div class="r"><span class="lbl">reads</span><span class="chips">${c.contextConsumes.map(k => { const p = contextEdges.find(e => e.to === c.id && e.fields.includes(k)); return btnChip(k + (p ? '' : ' ⚠'), `data-trace-context="${esc(k)}" title="${p ? 'from ' + esc(byId.get(p.from).name) : 'no scanned ancestor provides it'}"`, '', `trace context ${k}${p ? '' : ', no provider'}`) }).join('')}</span></div>`)
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
    if (cp) cp.onclick = () => copy(JSON.stringify((G.components || []).find(x => x.id === c.id) ?? null, null, 2), 'Component JSON copied')
    inner.querySelectorAll('[data-goto]').forEach(n => { n.onclick = () => select(n.dataset.goto, { pan: true }) })
    inner.querySelectorAll('[data-trace-event]').forEach(n => { n.onclick = () => trace('event', n.dataset.traceEvent) })
    inner.querySelectorAll('[data-trace-context]').forEach(n => { n.onclick = () => trace('context', n.dataset.traceContext) })
    inner.querySelectorAll('[data-trace-action]').forEach(n => { n.onclick = () => trace('action', n.dataset.traceAction) })
    inner.querySelectorAll('[data-trace-state]').forEach(n => { n.onclick = () => trace('state', n.dataset.traceState) })
  }

  // ───────────── sidebar: stats, health, the component list ─────────────
  function drawSidebar() {
    const real = comps.filter(c => !c.ghost)
    const sev = (s) => M.diagnostics.filter(d => d.severity === s).length
    $('title').textContent = META.title ?? 'app'
    $('subtitle').textContent = META.subtitle ?? ''
    $('stats').innerHTML = [
      [real.length, 'components'], [Object.keys(events).length, 'event types'], [real.reduce((n, c) => n + c.actions.length, 0), 'actions'],
      [sev('error'), 'errors', 'err'], [sev('warn'), 'warnings', 'warn'], [real.filter(c => c.agent).length, 'agent surfaces'],
    ].map(([n, l, cls]) => `<div class="stat ${n && cls ? cls : ''}"><b>${n}</b><span>${l}</span></div>`).join('')
    $('health').innerHTML = health.length
      ? health.map((h, gi) => `<details class="health-group" ${gi < 3 && h.tone !== 'ai' && h.tone !== 'muted' ? 'open' : ''}><summary><span class="dot tone-${h.tone}"></span>${esc(h.group)}<span class="n">${h.items.length}</span></summary><ul class="plain">${h.items.map((it, i) => `<li><button type="button" class="health-item" data-g="${gi}" data-i="${i}"><span class="dot tone-${h.tone}"></span><span class="t">${esc(it.title)}<small title="${esc(it.sub)}">${esc(it.sub)}</small></span></button></li>`).join('')}</ul></details>`).join('')
      : '<div class="empty">✓ No wiring problems found</div>'
    $('health').querySelectorAll('.health-item').forEach(n => {
      n.onclick = () => { const it = health[n.dataset.g].items[n.dataset.i]; if (it.event) trace('event', it.event); else if (it.id) select(it.id, { pan: true }) }
    })
    {
      const groups = new Map()
      for (const c of comps) { const d = c.external ?? (c.ghost ? '(not scanned)' : c.dir); if (!groups.has(d)) groups.set(d, []); groups.get(d).push(c) }
      let gi = 0
      $('tree').innerHTML = [...groups].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0).map(([d, list]) => {
        const hid = 'tree-dir-' + gi++
        return `<h3 class="tree-dir" id="${hid}">${esc(d)}/</h3><ul class="plain" aria-labelledby="${hid}">` + list.slice().sort((a, b) => Number(b.entry === true) - Number(a.entry === true) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map(c => {
          const n = diagCount(c), w = V.worst(c)
          return `<li><button type="button" class="tree-item" data-id="${esc(c.id)}" aria-current="false" aria-label="${esc(describe(c))}"><span class="k ${kindClass(c.kind)}"></span>${esc(c.name)}${c.entry === true ? ' <span class="tag">entry</span>' : ''}${c.viewOnly ? ' <span class="unk">·</span>' : ''}${n ? `<span class="badge kind ${w === 'error' ? 'k-err' : 'k-warn'}">${n}</span>` : ''}</button></li>`
        }).join('') + '</ul>'
      }).join('')
      $('tree').querySelectorAll('.tree-item').forEach(n => { n.onclick = () => { select(n.dataset.id, { pan: true }); if (innerWidth <= 700) $('side').classList.remove('open') } })
    }
  }
  drawSidebar()

  // ───────────── search ─────────────
  let matches = []
  const q = $('q')
  q.addEventListener('input', () => {
    const s = q.value.trim().toLowerCase()
    nodeEls.forEach(g => g.classList.remove('match'))
    if (!s) { $('qcount').textContent = ''; matches = []; if (!selected) clearHl(); return }
    matches = comps.filter(c => hay.get(c.id).includes(s)).map(c => c.id)
    $('qcount').textContent = String(matches.length)
    announce(`${plural(matches.length, 'match')}${matches.length ? '. Press Enter to show them.' : ''}`)
    matches.forEach(id => nodeEls.get(id).classList.add('match'))
    hl(matches, e => matches.includes(e.from) && matches.includes(e.to))
  })
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && matches.length) { if (matches.length === 1) select(matches[0], { pan: true }); else fit(matches, true, 1) }
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
    const clone = svg.cloneNode(true), b = V.bbox(pos, comps.map(c => c.id))
    clone.setAttribute('viewBox', `${b.x0} ${b.y0} ${b.x1 - b.x0} ${b.y1 - b.y0}`); clone.setAttribute('width', b.x1 - b.x0); clone.setAttribute('height', b.y1 - b.y0)
    clone.querySelector('#vp').removeAttribute('transform'); clone.querySelector('#bgrect').remove(); clone.classList.remove('dim')
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
    else if (e.key === 'Escape') { const id = selected; select(null); endTrace(); if (id && e.target.closest('#detail')) nodeEls.get(id)?.focus() }
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
    const idOf = (key) => key == null ? null : M.byKey.get(key) ?? null
    if (idOf(was.stop)) setTabStop(idOf(was.stop)); else initTabStop()
    restoring = true
    try {
      if (idOf(was.sel)) { select(idOf(was.sel), { keepView: true }); $('dinner').scrollTop = was.detailScroll } else select(null)
      if (was.trace) trace(was.trace.kind, was.trace.key, { fit: false })
      if (q.value) q.dispatchEvent(new Event('input'))
      if (idOf(was.focus)) nodeEls.get(idOf(was.focus)).focus({ preventScroll: true })
    } finally { restoring = false }
    // a view the user moved stays exactly where it was (a running animation finishes); an untouched one fits the new graph
    if (wasMoved) { moved = true; if (!animating) { view = wasView; apply() } } else fit(undefined, false)
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
  }
  window.__sygnalGraph = api
  return api
}
