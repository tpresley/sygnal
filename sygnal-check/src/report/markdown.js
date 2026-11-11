/**
 * The behaviour report as markdown, for a pull request comment (`sygnal-check --report`).
 * The first line is a marker a CI job can find to update its own comment.
 *
 *   formatReport(report, { max? }) → markdown
 */
const code = (s) => `\`${s}\``
const codes = (xs) => xs.map(code).join(', ')
const LABEL = { high: '**Look closely**', medium: '**Check**', low: 'Note' }
const KIND = {
  'side-effect': 'New side effect', 'side-effect-removed': 'Side effect removed', 'guard-removed': 'Guard removed', 'guard-changed': 'Guard changed',
  'trigger-filter-removed': 'Trigger filter removed', 'trigger-filter-changed': 'Trigger filter changed', 'writes-widened': 'Wider writes', 'writes-opaque': 'Writes unknown',
  clock: 'Clock in reducer', driver: 'Driver', removes: 'Can remove item', persist: 'Persistence', payload: 'Payload', agent: 'Agent surface', diagnostic: 'New finding',
  'branch-removed': 'Branch removed', 'guard-weakened': 'Guard weakened', 'helper-differs': 'Helper differs', 'event-no-listener': 'Event without listener', 'event-new': 'New event', 'event-orphan': 'Listener left behind', unclear: 'Unclear',
}
const KINDS = { helper: 'helper changed', guard: 'guard', branch: 'branches', condition: 'conditions', writes: 'written keys', value: 'values', payload: 'payload', moved: 'rewritten', other: 'computation' }

const esc = (s) => String(s).replace(/\|/g, '\\|')

function triggerLine(a) {
  if (a.change === 'added') return (a.sources.length ? `+ ${codes(a.sources)}` : `+ (${a.triggerKind ?? 'no trigger found'})`) + (a.trigger?.filters.added.length ? ` when ${codes(a.trigger.filters.added)}` : '')
  if (a.change === 'removed') return a.sources.length ? `− ${codes(a.sources)}` : `− (${a.triggerKind ?? 'none'})`
  if (!a.trigger) return a.sources.length ? codes(a.sources) : (a.triggerKind ?? '')
  const t = a.trigger
  const bits = []
  if (t.rewired) bits.push(`rewired: ${[...t.added.map(s => `+ ${code(s)}`), ...t.removed.map(s => `− ${code(s)}`)].join(', ')}`)
  for (const x of t.filters.added) bits.push(`new filter ${code(x)}`)
  for (const x of t.filters.removed) bits.push(`filter gone ${code(x)}`)
  if (t.logic) bits.push(`${codes(a.sources)}, what it passes on changed`)
  if (t.helpers.length && !t.logic) bits.push(`helper ${codes(t.helpers)} changed`)
  return bits.join('; ')
}

const keysText = (k) => k == null ? '?' : k.length ? k.join(', ') : '—'

function sinkLine(s) {
  const parts = []
  if (s.change === 'added') parts.push(`+ ${s.sink}`)
  else if (s.change === 'removed') parts.push(`− ${s.sink}`)
  else parts.push(s.sink)
  if (s.sink === 'STATE' && s.writes && s.change !== 'removed') {
    const w = s.writes
    if (s.change === 'added') parts.push(`writes ${keysText(w.head)}`)
    else if (w.base == null && w.head == null) parts.push('writes: unknown')
    else if (JSON.stringify([...(w.base || [])].sort()) === JSON.stringify([...(w.head || [])].sort())) parts.push(`writes ${keysText(w.head)} (same)`)
    else parts.push(`writes ${keysText(w.base)} → ${keysText(w.head)}`)
  }
  const reads = s.readsDiff && (s.readsDiff.added.length || s.readsDiff.removed.length) ? `reads ${[...s.readsDiff.added.map(k => `+${k}`), ...s.readsDiff.removed.map(k => `-${k}`)].join(' ')}` : s.change === 'added' && s.reads.length ? `reads ${s.reads.join(', ')}` : ''
  if (reads) parts.push(reads + (s.readsPartial ? ' …' : ''))
  if (s.events?.added.length) parts.push(`emits ${codes(s.events.added)}`)
  if (s.events?.removed.length) parts.push(`stops emitting ${codes(s.events.removed)}`)
  if (s.requests?.added.length) parts.push(`+ ${codes(s.requests.added)}`)
  if (s.requests?.removed.length) parts.push(`− ${codes(s.requests.removed)}`)
  if (s.shape && s.shape.base !== undefined && (s.sink === 'PARENT' || s.sink === 'EVENTS')) parts.push(`payload ${s.shape.base ? `{${s.shape.base.join(', ')}}` : 'value'} → ${s.shape.head ? `{${s.shape.head.join(', ')}}` : 'value'}`)
  return parts.join(', ')
}

function logicLine(s) {
  if (!s.logic) return ''
  const k = s.logic.kinds.map(x => KINDS[x]).join(', ')
  const notes = s.logic.notes.length ? `: ${s.logic.notes.join('; ')}` : ''
  return `${k}${notes}${s.logic.confidence === 'low' ? ' _(low confidence)_' : ''}`
}

function actionRows(comp, out) {
  if (!comp.actions.some(a => !a.folded)) return
  out.push('', '| | action | trigger | sinks | logic |', '|---|---|---|---|---|')
  const mark = { added: '+', removed: '−', changed: '~' }
  for (const a of comp.actions) {
    // a behavior's own wiring: the `behavior added` line says it
    if (a.change === 'added' && a.name.includes('.') && !a.sinks.length && !a.sources.length) continue
    if (a.folded) continue
    const sinks = a.sinks.map(sinkLine).join('<br>') || a.sinksAfter.join(', ')
    const logic = a.sinks.map(s => s.logic ? `${a.sinks.length > 1 ? `${s.sink}: ` : ''}${logicLine(s)}` : '').filter(Boolean).join('<br>')
    out.push(`| ${mark[a.change]} | ${code(a.name)} | ${esc(triggerLine(a))} | ${esc(sinks)} | ${esc(logic)} |`)
  }
  const guards = comp.actions.flatMap(a => a.sinks.flatMap(s => [...s.guards.added.map(g => `+ ${code(`${a.name} ${s.sink}`)} stops when ${code(g)}`), ...s.guards.removed.map(g => `− ${code(`${a.name} ${s.sink}`)} no longer stops when ${code(g)}`)]))
  if (guards.length) out.push('', '**Guards (ABORT / no change)**', ...guards.map(g => `- ${g}`))
}

function miscLines(comp, out) {
  const rows = []
  const entry = (label, list) => {
    for (const x of list) {
      const reads = x.reads && (x.reads.added.length || x.reads.removed.length) ? ` (reads ${[...x.reads.added.map(k => `+${k}`), ...x.reads.removed.map(k => `-${k}`)].join(' ')})` : ''
      rows.push(`- ${label} ${code(x.name)} ${x.change}${x.helpers?.length ? ` through ${codes(x.helpers)}` : ''}${reads}`)
    }
  }
  for (const s of comp.state) rows.push(`- initial state ${code(s.name)}: ${s.change === 'added' ? `+ ${code(s.head)}` : s.change === 'removed' ? `− ${code(s.base)}` : `${code(s.base)} → ${code(s.head)}`}`)
  entry('context', comp.context)
  entry('calculated', comp.calculated)
  entry('static', comp.statics)
  entry('behavior', comp.uses)
  if (comp.persist) rows.push(`- persistence: ${comp.persist.base ? code(comp.persist.base) : 'none'} → ${comp.persist.head ? code(comp.persist.head) : 'none'}`)
  if (comp.view) {
    const v = comp.view
    const bits = []
    if (v.reads) bits.push(`reads ${[...v.reads.added.map(k => `+${k}`), ...v.reads.removed.map(k => `-${k}`)].join(' ')}`)
    if (v.context) bits.push(`context ${[...v.context.added.map(k => `+${k}`), ...v.context.removed.map(k => `-${k}`)].join(' ')}`)
    if (v.children) bits.push(`children ${[...v.children.added.map(k => `+${k.split('#').pop()}`), ...v.children.removed.map(k => `-${k.split('#').pop()}`)].join(' ')}`)
    rows.push(`- view${v.changed ? ` code changed${v.helpers.length ? ` (through ${codes(v.helpers)})` : ''}` : ''}${bits.length ? `${v.changed ? ';' : ''} ${bits.join('; ')}` : ''}${v.changed ? ' (markup, text and styling are not classified)' : ''}`)
  }
  if (rows.length) out.push('', ...rows)
}

function blastLines(comp, out, max) {
  if (!comp.blast.length) return
  const text = comp.blast.map(b => {
    const shown = b.readers.slice(0, max)
    const more = b.readers.length > max ? `, +${b.readers.length - max} more` : ''
    const who = shown.join(', ') + more
    if (b.kind === 'holder') return `its state lives in ${code(b.key)} of ${b.parent}${who ? `, also read by ${who}` : ''}`
    return b.kind === 'state' ? `state ${code(b.key)} → ${who}` : b.kind === 'event' ? `event ${code(b.key)} → ${who || 'no scanned listener'}` : `PARENT → ${who}`
  })
  out.push('', `**Blast radius:** ${text.join('; ')}`)
}

const item = (a) => `- ${LABEL[a.severity]} (${KIND[a.kind] ?? a.kind}): ${a.text}${a.at ? ` (${code(a.at)})` : ''}`

export function formatReport(r, { max = 6 } = {}) {
  const out = ['<!-- sygnal-behaviour-report -->', '## Behaviour report']
  const n = (x, w) => `${x} ${w}`
  out.push('', `${code(r.base)}${r.commit ? ` (${r.commit.slice(0, 10)})` : ''} → ${code(r.head)}. Components: ${n(r.summary.changed, 'changed')}, ${n(r.summary.added, 'added')}, ${n(r.summary.removed, 'removed')}. Derived from the code by \`sygnal-check\`, not from the author's description.`)
  if (r.coverage.parseErrors.length) out.push('', `> **A file did not parse, so its components look removed:** ${r.coverage.parseErrors.map(code).join(', ')}`)
  if (r.attention.length) {
    out.push('', '### Look at these first')
    for (const a of r.attention) out.push(item(a))
  } else if (r.components.length) out.push('', 'No side effect was added to an existing action, and no guard removed or weakened, or write widened. That is all this line says: read the changes below.')
  if (r.notes.length) out.push('', '### Also changed', ...r.notes.map(item))
  if (!r.components.length) out.push('', 'No difference in component behaviour was found.')
  if (r.sharedHelpers.length) {
    out.push('', '### Shared helpers that changed')
    for (const h of r.sharedHelpers) out.push(`- ${code(h.name)} reaches ${n(h.components.length, 'components')} (${codes(h.components.slice(0, 6))}${h.components.length > 6 ? ', …' : ''}). What it means for each of them isn't analysed: read the helper's diff.`)
  }
  for (const c of r.components) {
    if (c.folded) continue
    out.push('', `### ${code(c.name)} ${c.status === 'changed' ? '' : `(${c.status}) `}· \`${c.file}\`${c.movedFrom ? ` (moved from \`${c.movedFrom}\`)` : ''}`)
    actionRows(c, out)
    miscLines(c, out)
    blastLines(c, out, max)
  }
  const cov = r.coverage
  if (cov.files || cov.partial.length) {
    out.push('', '### What this report did not look at')
    if (cov.unexplained.length) out.push(`- Changed code where no behaviour difference was found (comments, formatting, code no component reaches, or a limit of the analysis): ${codes(cov.unexplained)}`)
    if (cov.nonCode.length) out.push(`- Changed files that aren't code: ${codes(cov.nonCode)}`)
    if (cov.tests.length) out.push(`- Changed tests: ${n(cov.tests.length, cov.tests.length === 1 ? 'file' : 'files')}`)
    if (cov.partial.length) out.push(`- Components whose model or intent can't be listed whole: ${codes(cov.partial)}`)
    out.push('- Not analysed at all: what the view renders (markup, text, styling), runtime data and timing. Effects in a view or a helper it calls are reported only as the checker finds them (SYG265, SYG266).')
    out.push('- Compared only as changed or not: a helper whose body has statements other than if, return and const, and a condition with more than 12 parts. Addresses built with `+` are compared as written, not resolved.')
  }
  return out.join('\n') + '\n'
}
