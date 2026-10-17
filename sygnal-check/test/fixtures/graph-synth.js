/**
 * Seeded synthetic InspectGraphs for the large-app tests (PLAN-10 V-4), moved here from S-1's research
 * generator (dev-plans/research/graph-viz/large/gen.mjs now imports it), so the gate doesn't depend on
 * the research folder. Pure; no Node built-ins.
 *
 *   synthGraph(n, seed = 1) → an InspectGraph with exactly n components: App → Shell → Header /
 *   Router (a Switchable of feature pages) / Footer, features under src/features/<f>/, shared
 *   components, extra entries above 200 / 500, NAVIGATE from 2.5 % of components, context
 *   providers, duplicate names, diagnostics, agent surfaces and behavior actions
 *   addOne(graph, seed) → the graph with one component added (layout stability)
 */
export function mulberry32(seed) {
  let a = seed >>> 0
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

const FEATURES = ['shop', 'account', 'orders', 'catalog', 'search', 'inbox', 'settings', 'chat', 'billing', 'reports', 'projects', 'tasks', 'calendar', 'docs', 'team', 'media', 'analytics', 'onboarding', 'help', 'notifications', 'profile', 'integrations', 'audit', 'files', 'wiki', 'forms', 'payments', 'shipping', 'returns', 'reviews', 'loyalty', 'support', 'campaigns', 'segments', 'pricing', 'inventory', 'vendors', 'contracts', 'approvals', 'timesheets', 'expenses', 'assets', 'learning', 'events', 'tickets', 'surveys', 'jobs', 'roles', 'webhooks', 'exports', 'imports', 'labels', 'goals', 'okrs', 'boards', 'sprints', 'releases', 'builds', 'deploys', 'alerts', 'metrics', 'logs', 'traces', 'billing-admin', 'tenants', 'quotas']
const GENERIC = ['List', 'Item', 'Header', 'Toolbar', 'Panel', 'Form', 'Field', 'Row', 'Card', 'Detail', 'Filter', 'Summary', 'Editor', 'Dialog', 'Table', 'Cell', 'Tabs', 'Sidebar', 'Empty', 'Stats', 'Chart', 'Legend', 'Section', 'Footer', 'Preview', 'Picker', 'Menu', 'Search', 'Pager', 'Status']
const SHARED = ['Button', 'Icon', 'Avatar', 'Modal', 'Spinner', 'Tooltip', 'DataTable', 'Pagination', 'EmptyState', 'Badge', 'Card', 'Dropdown', 'DatePicker', 'TextField', 'Select', 'Checkbox', 'Tabs', 'Skeleton', 'ConfirmDialog', 'Chip', 'ProgressBar', 'Breadcrumbs', 'NavLink', 'Popover', 'Toast']
const VERBS = ['ADD', 'REMOVE', 'TOGGLE', 'SET_FILTER', 'LOAD', 'SUBMIT', 'OPEN', 'CLOSE', 'SELECT', 'EDIT', 'SAVE', 'CANCEL', 'SORT', 'EXPAND', 'RESET', 'UPDATE', 'DRAG_START', 'DROP', 'NEXT_PAGE', 'REFRESH']
const NOUNS = ['ITEM', 'ROW', 'FILTER', 'TAB', 'DRAFT', 'QUERY', 'PAGE', 'ENTRY', 'NOTE', 'TAG']
const KEYS = ['items', 'rows', 'filter', 'query', 'loading', 'error', 'selected', 'open', 'draft', 'page', 'sort', 'tab', 'expanded', 'editing', 'total', 'tags', 'notes', 'entries']
const cap = (s) => s.split(/[-_]/).map(w => w[0].toUpperCase() + w.slice(1)).join('')
const snake = (s) => s.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()

/**
 * generate(n, seed) → InspectGraph with exactly n components.
 */
export function generate(n, seed = 1) {
  const rnd = mulberry32(seed * 7919 + n)
  const pick = (a) => a[Math.floor(rnd() * a.length)]
  const chance = (p) => rnd() < p
  const geo = (mean, max) => { let k = 0; while (k < max && rnd() < mean / (mean + 1)) k++; return k }

  const comps = []
  const byKey = new Map()
  const fileLines = new Map()
  /** A component; `file` defaults to its own <name>.jsx in `dir`. */
  function add(name, dir, o = {}) {
    const file = o.file ?? `${dir}/${name}.jsx`
    const line = (fileLines.get(file) ?? -15) + 20 + Math.floor(rnd() * 30)
    fileLines.set(file, line)
    const c = { name, id: `${file}:${line}`, parentId: null, file, kind: 'child', actions: [], stateKeys: [], calculated: [], contextProvides: [], contextConsumes: [], eventsEmitted: [], eventsSelected: [], children: [], selectors: [], diagnostics: [], _dir: dir, _depth: o.depth ?? 0, _parents: [], _feature: o.feature ?? null }
    if (o.viewOnly) c.viewOnly = true
    if (o.entry) c.entry = true
    comps.push(c)
    byKey.set(o.key ?? c.id, c)
    return c
  }
  function render(parent, child, via = 'tag', from) {
    if (parent === child || parent.children.some(x => x.id === child.id)) return
    const ch = { name: child.name, via, id: child.id }
    if (via === 'collection') ch.from = from ?? pick(['items', 'rows', 'entries', 'list', 'results'])
    parent.children.push(ch)
    child._parents.push(parent)
  }

  // ── the skeleton (always present) ──
  const big = n >= 200
  const App = add('App', 'src', { entry: true, depth: 0, key: 'App' })
  App.contextProvides.push('theme', 'user', 'locale', 'flags')
  const Shell = add('Shell', 'src/layout', { depth: 1 }); render(App, Shell)
  const Header = add('Header', 'src/layout', { depth: 2 }); render(Shell, Header)
  const Router = add('Router', 'src/layout', { depth: 2 }); render(Shell, Router)
  const Footer = add('Footer', 'src/layout', { depth: 2, viewOnly: true }); render(Shell, Footer)
  const PageTracker = add('PageTracker', 'src/layout', { depth: 2 }); render(Shell, PageTracker)
  const Notifications = add('Notifications', 'src/layout', { depth: 2 }); render(Shell, Notifications)
  // shop: StoreShell provides currency; Checkout reads it; CartLine has three parents
  const StoreShell = add('StoreShell', 'src/features/shop', { depth: 3, feature: 'shop' }); render(Router, StoreShell, 'switchable')
  StoreShell.contextProvides.push('currency', 'cart')
  const Cart = add('Cart', 'src/features/shop', { depth: 4, feature: 'shop' }); render(StoreShell, Cart, 'switchable')
  const Checkout = add('Checkout', 'src/features/shop', { depth: 4, feature: 'shop' }); render(StoreShell, Checkout, 'switchable')
  Checkout.contextConsumes.push('currency', 'user')
  const OrderSummary = add('OrderSummary', 'src/features/shop', { depth: 5, feature: 'shop' }); render(Checkout, OrderSummary)
  const CartLine = add('CartLine', 'src/features/shop', { depth: 5, feature: 'shop' }); render(Cart, CartLine, 'collection', 'items'); render(OrderSummary, CartLine, 'collection', 'lines')
  CartLine.contextConsumes.push('currency')
  const MiniCart = add('MiniCart', 'src/features/shop', { depth: 3, feature: 'shop' }); render(Header, MiniCart); render(MiniCart, CartLine, 'collection', 'items')
  const special = [App, Shell, Header, Router, Footer, PageTracker, Notifications, StoreShell, Cart, Checkout, OrderSummary, CartLine, MiniCart]

  // shared components (view-only mostly, many parents)
  const nShared = Math.max(3, Math.min(SHARED.length, Math.round(n * 0.04)))
  const shared = SHARED.slice(0, nShared).map(s => add(s, 'src/components', { depth: 6, viewOnly: chance(0.7) }))
  // extra entries
  const entries = [App]
  let adminRouter = null
  if (big) {
    const AdminApp = add('AdminApp', 'src/admin', { entry: true, depth: 0 }); AdminApp.contextProvides.push('theme', 'user', 'permissions')
    adminRouter = add('Router', 'src/admin', { depth: 1 }); render(AdminApp, adminRouter)
    entries.push(AdminApp)
  }
  if (n >= 500) {
    const W = add('EmbedWidget', 'src/widgets', { entry: true, depth: 0 }); W.contextProvides.push('theme')
    entries.push(W)
    const sub = add('WidgetBody', 'src/widgets', { depth: 1 }); render(W, sub); render(sub, shared[0])
  }

  // ── features ──
  const remaining = n - comps.length
  const nFeatures = Math.max(2, Math.min(FEATURES.length, Math.round(n / 28)))
  const feats = FEATURES.slice(0, nFeatures)
  // feature sizes: uneven (a few big, many small), summing to `remaining`
  const weights = feats.map((f, i) => (f === 'shop' ? 1.4 : 1) * (0.4 + rnd() * 1.6) * (i < 3 ? 1.6 : 1))
  const wsum = weights.reduce((a, b) => a + b, 0)
  const sizes = weights.map(w => Math.max(1, Math.floor(remaining * w / wsum)))
  let diff = remaining - sizes.reduce((a, b) => a + b, 0)
  for (let i = 0; diff !== 0; i = (i + 1) % sizes.length) { if (diff > 0) { sizes[i]++; diff-- } else if (sizes[i] > 1) { sizes[i]--; diff++ } }
  const featureNodes = new Map()
  feats.forEach((f, fi) => {
    const dir = `src/features/${f}`
    const isAdmin = adminRouter && fi % 5 === 4 // every fifth feature lives under the admin entry
    const nodes = []
    const used = new Set(comps.filter(c => c._dir.startsWith(dir)).map(c => c.name))
    const uniq = (name) => { let s = name, k = 2; while (used.has(s)) s = name + k++; used.add(s); return s }
    let budget = sizes[fi]
    let page
    if (f === 'shop') { page = StoreShell; nodes.push(StoreShell, Cart, Checkout, OrderSummary, CartLine, MiniCart) } else {
      page = add(uniq(cap(f) + 'Page'), isAdmin ? `src/admin/${f}` : dir, { depth: isAdmin ? 2 : 3, feature: f })
      render(isAdmin ? adminRouter : Router, page, 'switchable')
      if (chance(0.6)) page.contextProvides.push(f.replace(/-(\w)/g, (_, x) => x.toUpperCase()) + 'Filter')
      nodes.push(page); budget--
    }
    while (budget > 0) {
      // parent choice: depth-biased (3–6 most common), fewer children preferred
      let parent = null, best = -1
      for (let t = 0; t < 6; t++) {
        const p = pick(nodes)
        if (p.viewOnly) continue
        const rel = p._depth - page._depth
        const w = (rel < 7 ? 1 : 0) * (1 / (1 + p.children.length ** 1.3)) * (rel <= 1 ? 1.4 : rel <= 3 ? 1 : 0.5) * (0.5 + rnd())
        if (w > best) { best = w; parent = p }
      }
      parent = parent ?? page
      const rel = parent._depth - page._depth + 1
      const leafish = rel >= 3 || chance(0.25)
      const viewOnly = leafish && chance(0.5)
      const generic = chance(0.4)
      const name = uniq(generic ? pick(GENERIC) : cap(f) + pick(GENERIC))
      const deep = rel >= 3 ? `${isAdmin ? 'src/admin/' + f : dir}/components` : (isAdmin ? `src/admin/${f}` : dir)
      const inParentFile = viewOnly && chance(0.35)
      const c = add(name, deep, { depth: parent._depth + 1, viewOnly, feature: f, file: inParentFile ? parent.file : undefined })
      const r = rnd()
      render(parent, c, r < 0.16 ? 'collection' : r < 0.21 ? 'switchable' : r < 0.25 ? 'slot' : 'tag')
      nodes.push(c); budget--
    }
    featureNodes.set(f, nodes)
  })
  // shared components: rendered by many feature components
  const stateful = comps.filter(c => !c.viewOnly)
  for (const c of stateful) if (c._feature && chance(0.28)) { render(c, pick(shared)); if (chance(0.3)) render(c, pick(shared)) }
  for (const s of shared) if (!s._parents.length) render(pick(stateful.filter(c => c._feature)), s)
  render(Header, shared.find(s => s.name === 'NavLink') ?? shared[0], 'collection', 'links')
  // a few cross-feature renders (UserCard-like reuse)
  const allFeat = comps.filter(c => c._feature)
  for (let i = 0; i < Math.round(n * 0.015); i++) { const a = pick(allFeat), b = pick(allFeat); if (a._feature !== b._feature && !a.viewOnly && b._depth > a._depth && !b._parents.includes(a)) render(a, b) }

  // ── kinds ──
  for (const c of comps) c.kind = !c._parents.length ? 'root' : ({ tag: 'child', slot: 'child', collection: 'collection-item', switchable: 'switchable' })[c._parents[0].children.find(x => x.id === c.id).via]

  // ── actions, state, selectors ──
  for (const c of comps) {
    if (c.viewOnly) continue
    const nAct = 1 + geo(3, 14)
    const names = new Set()
    for (let i = 0; i < nAct; i++) names.add(pick(VERBS) + (chance(0.5) ? '_' + pick(NOUNS) : ''))
    for (const a of names) {
      const trigger = a === 'LOAD' && chance(0.5) ? 'builtin' : chance(0.08) ? 'reply' : chance(0.05) ? 'next' : 'intent'
      const sinks = ['STATE']
      if (a.startsWith('LOAD') || a.startsWith('SAVE')) sinks.push('HTTP')
      if (chance(0.06)) sinks.push('EFFECT')
      if (chance(0.04) && c._parents.length) sinks.push('PARENT')
      c.actions.push({ name: trigger === 'builtin' ? 'BOOTSTRAP' : a, trigger, sinks })
      if (trigger === 'intent') c.selectors.push({ selector: '.' + a.toLowerCase().replace(/_/g, '-'), events: [a.includes('FILTER') || a.includes('EDIT') ? 'input' : 'click'], matched: true, isolationHit: null })
    }
    c.actions = c.actions.filter((a, i, l) => l.findIndex(x => x.name === a.name) === i)
    const nKeys = geo(2.5, 10)
    for (let i = 0; i < nKeys; i++) { const k = pick(KEYS); if (!c.stateKeys.includes(k)) c.stateKeys.push(k) }
    for (const ch of c.children) if (ch.from && !c.stateKeys.includes(ch.from)) c.stateKeys.push(ch.from)
    if (c.stateKeys.length > 2 && chance(0.3)) c.calculated.push(pick(['count', 'isEmpty', 'visible', 'canSubmit']))
  }
  // behaviors
  for (const c of stateful) {
    if (chance(0.05) || (c._feature === 'chat' && chance(0.3))) {
      const b = c._feature === 'chat' ? 'chat' : 'form'
      c.uses = [{ key: b, behavior: b, status: 'resolved' }]
      for (const a of b === 'chat' ? ['PROMPT', 'DELTA', 'DONE', 'ERROR', 'STOP'] : ['CHANGE', 'BLUR', 'SUBMIT', 'RESET', 'VALIDATED']) c.actions.push({ name: `${b}.${a}`, trigger: 'intent', sinks: b === 'chat' ? ['STATE', 'LLM'] : ['STATE'], behavior: b })
    }
  }

  // ── EVENTS ──
  const events = {}
  const ensureAction = (c, type) => { if (!c.actions.some(a => a.sinks.includes('EVENTS') && a.name === type)) c.actions.push({ name: type, trigger: 'intent', sinks: ['EVENTS'] }) }
  const emit = (c, type) => { if (c.viewOnly) return; (events[type] ??= { emitters: [], selectors: [], emitterIds: [], selectorIds: [] }); if (!events[type].emitterIds.includes(c.id)) { events[type].emitters.push(c.name); events[type].emitterIds.push(c.id); c.eventsEmitted.push(type); ensureAction(c, type) } }
  const sel = (c, type) => { if (c.viewOnly) return; (events[type] ??= { emitters: [], selectors: [], emitterIds: [], selectorIds: [] }); if (!events[type].selectorIds.includes(c.id)) { events[type].selectors.push(c.name); events[type].selectorIds.push(c.id); c.eventsSelected.push(type); if (!c.actions.some(a => a.name === type)) c.actions.push({ name: type, trigger: 'intent', sinks: ['STATE'] }) } }
  const deepish = stateful.filter(c => c._depth >= 4)
  for (let i = 0; i < Math.max(3, Math.round(n * 0.025)); i++) emit(pick(deepish.length ? deepish : stateful), 'NAVIGATE')
  sel(Router, 'NAVIGATE'); sel(PageTracker, 'NAVIGATE'); if (adminRouter) sel(adminRouter, 'NAVIGATE')
  for (let i = 0; i < Math.max(2, Math.round(n * 0.02)); i++) emit(pick(stateful), 'NOTIFY')
  sel(Notifications, 'NOTIFY')
  emit(Cart, 'CART_CHANGED'); emit(CartLine, 'CART_CHANGED'); sel(MiniCart, 'CART_CHANGED'); sel(StoreShell, 'CART_CHANGED')
  const nTypes = Math.max(4, Math.round(n / 5))
  const evNouns = ['ORDER', 'USER', 'FILE', 'TASK', 'ITEM', 'PROJECT', 'MESSAGE', 'INVOICE', 'REPORT', 'TICKET', 'LABEL', 'RULE', 'TEAM', 'DOC', 'COMMENT']
  const evVerbs = ['CREATED', 'UPDATED', 'DELETED', 'SELECTED', 'OPENED', 'CLOSED', 'MOVED', 'SHARED', 'ARCHIVED', 'RESTORED', 'IMPORTED', 'APPROVED', 'REJECTED', 'ASSIGNED', 'SYNCED']
  for (let i = 0; Object.keys(events).length < nTypes + 3 && i < nTypes * 4; i++) {
    const f = pick(feats)
    const type = `${f.toUpperCase().replace(/-/g, '_')}_${pick(evNouns)}_${pick(evVerbs)}`
    if (events[type]) continue
    const fn = featureNodes.get(f).filter(c => !c.viewOnly)
    const ne = 1 + geo(0.5, 4), ns = 1 + geo(0.6, 4)
    const noSel = chance(0.04), noEm = chance(0.03)
    if (!noEm) for (let k = 0; k < ne; k++) emit(chance(0.7) ? pick(fn) : pick(stateful), type)
    if (!noSel) for (let k = 0; k < ns; k++) {
      // distant selectors: another feature's page or component, the Shell, the root
      const r = rnd()
      sel(r < 0.3 ? pick(stateful.filter(c => c._feature && c._feature !== f)) : r < 0.45 ? pick([Shell, App, Notifications]) : pick(fn), type)
    }
    if (noEm) { events[type] ??= { emitters: [], selectors: [], emitterIds: [], selectorIds: [] }; sel(pick(fn), type) }
    if (noSel && !events[type]?.emitterIds.length) emit(pick(fn), type)
  }

  // ── context readers (resolve to the nearest ancestor provider) ──
  const ancestorProvided = (c) => { const out = new Set(); const seen = new Set(); const st = [...c._parents]; while (st.length) { const p = st.pop(); if (seen.has(p)) continue; seen.add(p); p.contextProvides.forEach(f => out.add(f)); st.push(...p._parents) } return [...out] }
  for (const c of comps) {
    if (special.includes(c) || c._depth < 2) continue
    if (chance(c.viewOnly ? 0.1 : 0.2)) { const avail = ancestorProvided(c); if (avail.length) { const f = pick(avail); if (!c.contextConsumes.includes(f)) c.contextConsumes.push(f) } }
    if (chance(0.006)) c.contextConsumes.push(pick(['tenant', 'featureFlags', 'session']))
  }

  // ── agent surfaces ──
  const nAgent = Math.max(2, Math.round(n / 70))
  const agentCands = [Cart, ...stateful.filter(c => c._feature && c !== Cart && c.actions.length >= 3)]
  for (let i = 0; i < nAgent && i < agentCands.length; i++) {
    const c = i === 0 ? Cart : agentCands[1 + Math.floor(rnd() * (agentCands.length - 1))]
    if (c.agent) continue
    const own = c.actions.filter(a => !a.behavior && a.trigger === 'intent' && !a.sinks.includes('EVENTS')).slice(0, 4)
    c.agent = { name: snake(c.name), tools: snake(c.name), description: `The ${c.name} on the ${c._feature} page`, read: chance(0.8), actions: own.map(a => ({ name: a.name, consequential: /REMOVE|SUBMIT|SAVE|DELETE/.test(a.name), input: chance(0.6) })) }
    if (chance(0.4)) { const a = 'AGENT_' + pick(NOUNS); c.agent.actions.push({ name: a, consequential: chance(0.3), input: true }); c.actions.push({ name: a, trigger: 'agent', sinks: ['STATE'] }) }
  }

  // ── diagnostics ──
  const D = (c, code, severity, message, extra = {}) => c.diagnostics.push({ code, severity, message, component: c.name, file: c.file, line: +c.id.split(':').pop() + 3, column: 5, ...extra })
  for (const c of comps) {
    if (c.viewOnly) { if (chance(0.004)) D(c, 'SYG406', 'error', `${c.name}: the view reads props.items.map on a possibly undefined value`); continue }
    if (chance(0.025)) { const s = { selector: '.missing-' + Math.floor(rnd() * 99), events: ['click'], matched: false, isolationHit: null }; c.selectors.push(s); c.actions.push({ name: 'GHOST_CLICK', trigger: 'intent', sinks: ['STATE'] }); D(c, 'SYG110', 'warn', `Intent selector '${s.selector}' is not present in ${c.name}'s view`) }
    if (chance(0.02)) { c.actions.push({ name: 'STALE_ENTRY', trigger: 'unknown', sinks: ['STATE'] }); D(c, 'SYG102', 'info', `Model entry STALE_ENTRY in ${c.name} is unreachable`) }
    if (chance(0.012)) D(c, 'SYG101', 'warn', `Intent action OPEN_MENU in ${c.name} has no model entry`)
    if (chance(0.008)) D(c, 'SYG112', 'error', `Reply action SAVED in ${c.name} has no model entry`)
    if (chance(0.006) && c.kind === 'collection-item') D(c, 'SYG405', 'error', `${c.name} has initialState but is rendered by a Collection without isolatedState`)
  }
  for (const [t, e] of Object.entries(events)) if (!e.selectors.length || !e.emitters.length) { const c = comps.find(x => x.id === (e.emitterIds[0] ?? e.selectorIds[0])); D(c, 'SYG105', 'info', `EVENTS type ${t} is ${e.selectors.length ? 'selected but never emitted' : 'emitted but never selected'}`) }
  if (!comps.some(c => c.diagnostics.some(d => d.severity === 'error'))) D(pick(stateful), 'SYG112', 'error', 'Reply action SAVED has no model entry')

  // ── output ──
  const graphDiags = [{ code: 'SYG301', severity: 'info', message: 'RxJS-style operator hint (app-wide)' }]
  return {
    version: 1, source: 'static',
    components: comps.map(({ _dir, _depth, _parents, _feature, ...c }) => c),
    events, diagnostics: graphDiags,
  }
}

/**
 * addOne(G, seed) → a copy of G with one more component (a stateful child under a random stateful
 * feature component, in the parent's directory): the "one edit" for the layout-stability check.
 */
export function addOne(G, seed = 1) {
  const rnd = mulberry32(seed * 104729)
  const g = structuredClone(G)
  const cands = g.components.filter(c => !c.viewOnly && c.file.includes('/features/'))
  const p = cands[Math.floor(rnd() * cands.length)]
  const dir = p.file.slice(0, p.file.lastIndexOf('/'))
  const c = { name: 'AddedPanel', id: `${dir}/AddedPanel.jsx:7`, parentId: null, file: `${dir}/AddedPanel.jsx`, kind: 'child', actions: [{ name: 'TOGGLE', trigger: 'intent', sinks: ['STATE'] }], stateKeys: ['open'], calculated: [], contextProvides: [], contextConsumes: [], eventsEmitted: [], eventsSelected: [], children: [], selectors: [{ selector: '.toggle', events: ['click'], matched: true, isolationHit: null }], diagnostics: [] }
  g.components.push(c)
  p.children.push({ name: c.name, via: 'tag', id: c.id })
  return { graph: g, parent: p.id, added: c.id }
}

/** All examples/*\/src scanned together with sygnal-check's graph(): one real, many-rooted graph. */

export { generate as synthGraph }
