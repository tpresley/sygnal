/**
 * Text form of the app graph (`sygnal-check --graph` without --json).
 *
 *   RootComponent  src/RootComponent.jsx:12  root
 *     actions   ADD_LANE (intent → STATE), DELETE_LANE (intent → STATE), INITIALIZE (builtin → STATE)
 *     state     lanes, dragging, nextId
 *     context   provides draggingTaskId
 *     events    selects DELETE_LANE
 *     children  LaneComponent (collection from 'lanes')
 *     controls  Add <button> ✓
 *     selectors .add-lane-btn [click] ✓
 *     ! SYG110 …
 *   EVENTS
 *     DELETE_LANE  LaneComponent → RootComponent
 */
const list = (xs) => xs.join(', ')

function selectorText(s) {
  const mark = s.isolationHit ? `✗ inside <${s.isolationHit}>` : s.matched === true ? '✓' : s.matched === false ? '✗ not in view' : '?'
  return `${s.control ?? s.selector}${s.events?.length ? ` [${s.events.join(',')}]` : ''} ${mark}`
}

export function formatGraph(g, { verbose = false } = {}) {
  const out = []
  const shown = (d) => verbose || d.severity !== 'info'
  for (const c of g.components) {
    out.push(`${c.name}  ${c.file ? c.file + ':' + c.id.split(':').pop() : '#' + c.id}  ${c.kind}`)
    const row = (label, value) => { if (value) out.push(`  ${label.padEnd(9)} ${value}`) }
    row('actions', list(c.actions.map(a => `${a.name} (${a.trigger}${a.sinks.length ? ' → ' + a.sinks.join('+') : ', no model entry'})`)))
    row('state', list(c.stateKeys))
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
    row('children', list(c.children.map(ch => `${ch.name} (${ch.via}${ch.from ? ` from '${ch.from}'` : ''})`)))
    row('controls', list((c.controls || []).map(x => `${x.name}${x.element ? ` <${x.element}>` : x.kind ? ` (${x.kind})` : ''} ${x.listened ? '✓' : x.listened === false ? '(not listened to)' : '?'}`)))
    row('selectors', list(c.selectors.map(selectorText)))
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
