/**
 * Text form of the app graph (`sygnal-check --graph` without --json).
 *
 *   RootComponent  src/RootComponent.jsx:12  root  entry
 *     actions   ADD_LANE (intent → STATE writes nextId, lanes), DELETE_LANE (intent → STATE writes lanes),
 *               REMOVE (intent → STATE removes), SAVE (intent → STATE)   (no `writes`: not known)
 *     state     lanes, dragging, nextId
 *     reads     lanes, dragging   (… when incomplete: the state used whole somewhere)
 *     context   provides draggingTaskId
 *     events    selects DELETE_LANE
 *     children  LaneComponent (collection from 'lanes'), Toaster (tag, sygnal/ui), Menu (widget, sygnal/ui/menu)
 *     parent    from LaneComponent → LANE_DELETED   (CHILD.select(LaneComponent): PARENT receivers)
 *     controls  Add <button> ✓
 *     selectors .add-lane-btn [click] ✓
 *     commands  OPEN_HELP → showModal HelpDialog
 *     timers    tick every 100 ms → TICK
 *     agent     todos (read): ADD (input), CLEAR_DONE (consequential)
 *     ! SYG110 …
 *   Greeting  src/Scoreboard.jsx:4  child  view only
 *   Layout  pages/+Layout.jsx:3  root  entry  route /
 *     children  Page (layout /), Page (layout /orders/@id)   (Vike's shell: the Layout renders these
 *               pages, A-9; with the page's route when it has one)
 *   Page  pages/orders/@id/+Page.jsx:1  root  entry  route /orders/@id   ('route (dynamic)': a Route
 *         Function; 'route (error page)': _error/+Page)
 * (entry: run() / defineElement() / a Vike page; `entry?`: maybe, an entry call can't be resolved)
 *   EVENTS
 *     DELETE_LANE  LaneComponent → RootComponent
 */
const list = (xs) => xs.join(', ')

/**
 * PLAN-10 A-9: a Vike component's route: 'route /orders/@id', 'route (dynamic)', 'route (error page)';
 * 'routes /orders/new, /orders/@id' for a component several +Page files export.
 */
function routeText(c) {
  if (c.route === undefined) return ''
  const one = (r, dyn) => r ?? (dyn ? '(dynamic)' : '(error page)')
  return c.routes ? `routes ${c.routes.map((r, i) => one(r, i ? true : c.routeDynamic)).join(', ')}` : `route ${one(c.route, c.routeDynamic)}`
}

function selectorText(s) {
  const mark = s.isolationHit ? `✗ inside <${s.isolationHit}>` : s.matched === true ? '✓' : s.matched === false ? '✗ not in view' : '?'
  return `${s.control ?? s.selector}${s.events?.length ? ` [${s.events.join(',')}]` : ''} ${mark}`
}

/** PLAN-10 A-7: 'STATE writes a, b' / 'STATE writes nothing' / 'STATE removes'; plain STATE when unknown. */
function sinkText(a, sink) {
  if (sink !== 'STATE' || !a.writes) return sink
  const w = a.writes.length ? `writes ${list(a.writes)}` : a.removes ? '' : 'writes nothing'
  return `STATE ${[w, a.removes && 'removes'].filter(Boolean).join(' or ')}`
}

// 'STATE+EFFECT', or 'STATE writes todos + EFFECT' once a sink's text has words
function sinksText(a) {
  const xs = a.sinks.map(x => sinkText(a, x))
  return xs.join(xs.some(x => x.includes(' ')) ? ' + ' : '+')
}

function timerText(t) {
  const ms = (v) => v == null ? '?' : `${v} ms`
  const how = 'frame' in t ? 'frame' : 'every' in t ? `every ${ms(t.every)}` : 'after' in t ? `after ${ms(t.after)}` : '?'
  return `${t.name} ${how} → ${('frame' in t ? t.frame : t.action) ?? '?'}${t.background ? ' (background)' : ''}`
}

export function formatGraph(g, { verbose = false } = {}) {
  const out = []
  const shown = (d) => verbose || d.severity !== 'info'
  const byId = new Map(g.components.map(c => [c.id, c]))
  for (const c of g.components) {
    const marks = [c.entry === true ? 'entry' : c.entry === 'unknown' ? 'entry?' : '', c.viewOnly ? 'view only' : '', routeText(c)].filter(Boolean).map(m => '  ' + m).join('')
    out.push(`${c.name}  ${c.file ? c.file + ':' + c.id.split(':').pop() : '#' + c.id}  ${c.kind}${marks}`)
    const row = (label, value) => { if (value) out.push(`  ${label.padEnd(9)} ${value}`) }
    row('actions', list(c.actions.map(a => `${a.name} (${a.trigger}${a.sinks.length ? ' → ' + sinksText(a) : ', no model entry'})`)))
    row('state', list(c.stateKeys))
    row('reads', c.stateReads || c.stateReadsPartial ? `${list(c.stateReads || [])}${c.stateReadsPartial ? (c.stateReads ? ' …' : '…') : ''}` : '')
    row('calc', list(c.calculated))
    const ctx = [
      c.contextProvides.length ? `provides ${list(c.contextProvides)}` : '',
      c.contextConsumes?.length ? `reads ${list(c.contextConsumes)}` : '',
    ].filter(Boolean).join('; ')
    row('context', ctx)
    const evs = [
      c.eventsEmitted.length ? `emits ${list(c.eventsEmitted)}` : '',
      c.eventsSelected.length ? `selects ${list(c.eventsSelected)}` : '',
    ].filter(Boolean).join('; ')
    row('events', evs)
    row('children', list(c.children.map(ch => `${ch.name} (${[`${ch.widget ? 'widget' : ch.via}${ch.from ? ` from '${ch.from}'` : ''}${ch.via === 'layout' && byId.get(ch.id)?.route != null ? ` ${byId.get(ch.id).route}` : ''}`, ch.state && `state '${ch.state}'`, ch.external].filter(Boolean).join(', ')})`)))
    row('parent', list((c.childSelects || []).map(s => `from ${s.child ?? '?'} → ${s.actions.length ? s.actions.join(', ') : '?'}`)))
    row('controls', list((c.controls || []).map(x => `${x.name}${x.element ? ` <${x.element}>` : x.kind ? ` (${x.kind})` : ''} ${x.listened ? '✓' : x.listened === false ? '(not listened to)' : '?'}`)))
    row('selectors', list(c.selectors.map(selectorText)))
    row('commands', list((c.commands || []).map(x => `${x.action} → ${x.method} ${x.target ?? '?'}${x.triggers ? ` (→ ${x.triggers.join(', ')})` : ''}`)))
    row('timers', list((c.timers || []).map(timerText)))
    if (c.agent) {
      const acts = list(c.agent.actions.map(a => `${a.name}${a.input || a.consequential ? ` (${[a.input && 'input', a.consequential && 'consequential'].filter(Boolean).join(', ')})` : ''}`))
      const qs = list((c.agent.queries || []).map(q => `${q.name} (query${q.input ? ', input' : ''})`))
      row('agent', `${c.agent.tools ?? '?'}${c.agent.read ? ' (read)' : ''}${acts || qs ? ': ' + [acts, qs].filter(Boolean).join(', ') : ''}${c.agent.partial ? ' …' : ''}`)
    }
    for (const d of c.diagnostics.filter(shown)) out.push(`  ! ${d.code}${d.severity === 'warn' ? '' : ` [${d.severity}]`} ${d.message}`)
  }
  const types = Object.keys(g.events)
  if (types.length) {
    out.push('EVENTS')
    for (const t of types) {
      const e = g.events[t]
      out.push(`  ${t}  ${list(e.emitters) || '(no emitter)'} → ${list(e.selectors) || '(no selector)'}`)
    }
  }
  const app = g.diagnostics.filter(shown)
  if (app.length) {
    out.push('DIAGNOSTICS')
    for (const d of app) out.push(`  ${d.file ? `${d.file}:${d.line}:${d.column} ` : ''}${d.code} ${d.component ? d.component + ': ' : ''}${d.message}`)
  }
  const all = [...g.components.flatMap(c => c.diagnostics), ...g.diagnostics]
  const count = (s) => all.filter(d => d.severity === s).length
  out.push(`sygnal-check: ${g.components.length} component${g.components.length === 1 ? '' : 's'}, ${count('error') ? count('error') + ' errors, ' : ''}${count('warn')} warning${count('warn') === 1 ? '' : 's'}${count('info') ? `, ${count('info')} info` : ''}`)
  return out.join('\n')
}
