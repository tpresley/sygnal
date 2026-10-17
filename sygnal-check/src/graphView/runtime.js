/**
 * Runtime graphs on the page (PLAN-10 V-3, D520): a runtime `inspect()` graph (`source: 'runtime'`,
 * one entry per live instance, `parentId` links, no file or line) mapped onto the page's component
 * model, plus the runtime parts of the health list and the detail panel.
 *
 *   fromRuntime(graph) → a graph of cards the model and the layout take as they are
 *     one card per (parent card, component name), labelled ×N: the instances a Collection, a
 *     Switchable or repeated tags make are one card; root instances group by name (two run()s of
 *     the same root component are one card ×2). A card's id and key are its path of names
 *     ('rt:App>Lane>Task'), so selection and positions survive a refresh. Its lists are the union over
 *     its instances (an action's trigger is the best one seen; a selector is matched when any instance's
 *     latest render has it); `shown: false` only when every instance is hidden; `dir` names the
 *     app (run()) of its root card ('app 2 · Root'), so several apps are clusters. Each card keeps
 *     `rt = { count, instances: [{ id, app?, shown?, resources?, stateKeys }], recent: { type: n }, raw }`;
 *     children carry the target card's id and events the card ids, so nothing is resolved by name.
 *     The result also has `rtCardOf: { [instanceId]: cardId }` (flashes, state updates).
 *   runtimeHealth(model) → the health groups that replace the static checks a runtime graph would
 *     misread (healthList leaves those out when `model.runtime`): "Actions not seen yet" and "EVENTS
 *     selected, not emitted yet" (tone 'muted': nothing has happened yet, which is not an error)
 *   rtCardSub(card) → the card's second line ('instance #3', '4 instances', '… · hidden')
 *   rtDetailHtml(card, h) → the detail panel's runtime sections (recent actions, instances with a
 *     state slot each) as HTML; `h` is the page's { esc, btnChip, states, canFetch }
 *   rtTime(ms) → 'hh:mm:ss' (a diagnostic's report time)
 *
 * State values are never in the graph (D520): the host fetches the selected card's instances
 * (`__sygnalGraph.host.getState(id)`) and pushes changes (`__sygnalGraph.state(id, value)`); see page.js.
 *
 * Pure: no DOM, no imports (html.js inlines it; see model.js).
 */

const RT_RANK = { intent: 6, reply: 5, next: 4, agent: 4, behavior: 3, builtin: 2, unknown: 0 }
const RT_VIA = { root: 'tag', child: 'tag', 'collection-item': 'collection', switchable: 'switchable' }

export function fromRuntime(graph) {
  const list = graph.components || []
  const byInst = new Map(list.map(c => [String(c.id), c]))
  const pathOf = new Map() // instance id → card path
  const path = (c) => {
    const id = String(c.id)
    if (pathOf.has(id)) return pathOf.get(id)
    pathOf.set(id, c.name) // a parent cycle can't recurse forever
    const parent = c.parentId != null ? byInst.get(String(c.parentId)) : null
    const p = (parent ? path(parent) + '>' : '') + c.name
    pathOf.set(id, p)
    return p
  }
  const union = (a, b) => { for (const x of b || []) if (!a.includes(x)) a.push(x); return a }
  const cards = new Map()
  const parentPath = new Map() // card path → parent card path
  for (const c of list) {
    const p = path(c)
    let d = cards.get(p)
    if (!d) {
      const parent = c.parentId != null ? byInst.get(String(c.parentId)) : null
      d = {
        name: c.name, id: 'rt:' + p, key: 'rt:' + p, parentId: null, kind: c.kind, file: null,
        actions: [], stateKeys: [], calculated: [], contextProvides: [], contextConsumes: [],
        eventsEmitted: [], eventsSelected: [], children: [], selectors: [], diagnostics: [],
        rt: { count: 0, instances: [], recent: {}, raw: [], apps: [] },
      }
      if (c.viewOnly) d.viewOnly = true
      cards.set(p, d)
      parentPath.set(p, parent ? path(parent) : null)
    }
    d.rt.count++
    d.rt.raw.push(c)
    d.rt.instances.push({
      id: String(c.id), stateKeys: c.stateKeys || [],
      ...(c.app != null ? { app: c.app } : {}), ...(c.shown === false ? { shown: false } : {}),
      ...(c.resources ? { resources: c.resources } : {}),
    })
    if (c.app != null && !d.rt.apps.includes(c.app)) d.rt.apps.push(c.app)
    if (!c.viewOnly) delete d.viewOnly
    if (c.entry === true) d.entry = true
    for (const a of c.actions || []) {
      const have = d.actions.find(x => x.name === a.name)
      if (!have) d.actions.push({ ...a, sinks: [...(a.sinks || [])] })
      else { if ((RT_RANK[a.trigger] ?? 0) > (RT_RANK[have.trigger] ?? 0)) have.trigger = a.trigger; union(have.sinks, a.sinks) }
    }
    union(d.stateKeys, c.stateKeys); union(d.calculated, c.calculated)
    union(d.contextProvides, c.contextProvides); union(d.contextConsumes, c.contextConsumes)
    union(d.eventsEmitted, c.eventsEmitted); union(d.eventsSelected, c.eventsSelected)
    for (const s of c.selectors || []) {
      const have = d.selectors.find(x => x.selector === s.selector)
      // matched: false at runtime = not in that instance's latest render: any instance's true wins
      if (!have) d.selectors.push({ ...s })
      else { if (s.matched === true) { have.matched = true; have.isolationHit = null } union(have.events || (have.events = []), s.events) }
    }
    for (const x of c.controls || []) {
      const have = (d.controls || (d.controls = [])).find(y => y.name === x.name)
      if (!have) d.controls.push({ ...x }); else if (x.listened) have.listened = true
    }
    for (const x of c.diagnostics || []) if (!d.diagnostics.some(y => y.code === x.code && y.message === x.message)) d.diagnostics.push(x)
  }
  const cardOf = {}
  for (const [id, p] of pathOf) cardOf[id] = 'rt:' + p
  // shown: false only when every instance is hidden
  for (const d of cards.values()) if (d.rt.instances.every(i => i.shown === false)) d.shown = false
  // children: one entry per child card, in first-instance order
  for (const [p, d] of cards) {
    const pp = parentPath.get(p)
    const parent = pp != null && cards.get(pp)
    if (parent) parent.children.push({ name: d.name, via: RT_VIA[d.kind] || 'tag', id: d.id, count: d.rt.count })
  }
  // the cluster: the apps of the root card above it (several run()s are several clusters)
  const rootOf = (p) => { let q = p; for (let n = 0; parentPath.get(q) != null && n < 10000; n++) q = parentPath.get(q); return q }
  for (const [p, d] of cards) {
    const root = cards.get(rootOf(p))
    const apps = root.rt.apps.slice().sort((a, b) => a - b)
    d.dir = (apps.length ? (apps.length === 1 ? 'app ' : 'apps ') + apps.map(a => a + 1).join(', ') + ' · ' : '') + root.name
  }
  // recent actions per card
  for (const a of graph.recentActions || []) {
    const id = cardOf[String(a.instance)]
    const d = id && cards.get(id.slice(3))
    if (d) d.rt.recent[a.type] = (d.rt.recent[a.type] || 0) + 1
  }
  // events: instance ids → card ids (each card once); names stay as inspect() gave them
  const events = {}
  for (const [type, e] of Object.entries(graph.events || {})) {
    const ids = (xs) => { const out = []; for (const x of xs || []) { const id = cardOf[String(x)]; if (id && !out.includes(id)) out.push(id) } return out }
    events[type] = { emitters: e.emitters || [], selectors: e.selectors || [], emitterIds: ids(e.emitterIds), selectorIds: ids(e.selectorIds) }
  }
  return { ...graph, components: [...cards.values()], events, rtCardOf: cardOf }
}

export function runtimeHealth(model) {
  const out = []
  const add = (group, items) => { if (items.length) out.push({ group, tone: 'muted', items }) }
  const real = model.comps.filter(c => !c.ghost)
  add('Actions not seen yet', real.flatMap(c => c.actions.filter(a => a.trigger === 'unknown' && !a.behavior)
    .map(a => ({ id: c.id, title: a.name, sub: `${c.name} · no intent, reply or next() has run it yet (sygnal-check checks the source)` }))))
  add('EVENTS selected, not emitted yet', Object.entries(model.events).filter(([, e]) => !(e.emitters || []).length && (e.selectors || []).length)
    .map(([t, e]) => ({ id: (e.selectorIds || []).find(x => model.byId.has(x)) ?? null, event: t, title: t, sub: `selected by ${e.selectors.join(', ')}` })))
  return out
}

export function rtCardSub(c) {
  const n = c.rt.count
  const hidden = c.shown === false ? ' · hidden' : ''
  return (n === 1 ? `instance #${c.rt.instances[0].id}` : `${n} instances`) + hidden
}

export function rtTime(ms) {
  if (typeof ms !== 'number' || !isFinite(ms)) return ''
  const d = new Date(ms), p = (n, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** The text of a state value for the detail panel (cut at `max` characters). */
export function rtStateText(value, max = 4000) {
  if (value === undefined) return 'undefined'
  let text
  try { text = JSON.stringify(value, null, 2) } catch (_) { text = String(value) }
  if (text === undefined) text = String(value)
  return text.length > max ? text.slice(0, max) + '\n…' : text
}

export function rtDetailHtml(c, h) {
  const { esc, btnChip } = h
  const out = []
  const acts = Object.entries(c.rt.recent).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  if (acts.length) {
    out.push(`<section class="dsec"><h3>Recent actions <span class="n">${acts.reduce((n, a) => n + a[1], 0)}</span></h3><div class="chips">${acts.map(([t, n]) => btnChip(`${t} ×${n}`, `data-trace-action="${esc(t)}"`, 'act', `trace action ${t}`)).join('')}</div></section>`)
  }
  const rows = c.rt.instances.map(i => {
    const tags = [i.app != null ? `app ${i.app + 1}` : '', i.shown === false ? 'hidden' : ''].filter(Boolean).map(t => `<span class="tag">${esc(t)}</span>`).join(' ')
    const res = (i.resources || []).map(r => `<span class="chip">${esc(r.name)}: ${esc(r.status)}${r.error ? ' ⚠' : ''}</span>`).join('')
    const has = h.states && Object.prototype.hasOwnProperty.call(h.states, i.id)
    const body = has ? esc(rtStateText(h.states[i.id])) : h.canFetch ? 'Loading…' : 'State values come from the host (the devtools panel); this page has keys only.'
    return `<details class="rt-inst" data-inst="${esc(i.id)}"${c.rt.count === 1 ? ' open' : ''}><summary><span class="mono">#${esc(i.id)}</span> ${tags}${i.stateKeys.length ? ` <small class="unk">${esc(i.stateKeys.join(', '))}</small>` : ''}</summary>${res ? `<div class="chips">${res}</div>` : ''}<pre class="rt-state${has ? '' : ' unk'}">${body}</pre></details>`
  })
  out.push(`<section class="dsec"><h3>Instances <span class="n">${c.rt.count}</span></h3>${rows.join('')}</section>`)
  return out.join('')
}
