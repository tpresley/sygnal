// What needs the person's attention, scored from the world: the input to both ways of arranging
// the board (the rules here, or the model from a written brief).
import { fromTree, toTree } from 'sygnal/ai'

const minutes = (m) => (m < 60 ? `${m} min` : `${Math.round(m / 60)} h`)

/**
 * Every part the board can show, scored 0–100, with a one-line reason.
 * band: 'act' (do something now), 'watch' (keep an eye on it), 'calm'.
 */
export function attention(state) {
  const items = []
  const add = (key, part, params, score, reason) =>
    items.push({ key, part, params, score, reason, band: score >= 70 ? 'act' : score >= 35 ? 'watch' : 'calm' })

  for (const i of state.incidents) {
    const score = (i.sev === 1 ? 95 : i.sev === 2 ? 72 : 40) - (i.acked ? 20 : 0)
    add(`incident:${i.id}`, 'incident', { id: i.id }, score, `SEV${i.sev}, ${minutes(i.minutes)} old, ${i.acked ? 'acknowledged' : 'nobody has acknowledged it'}`)
  }
  const down = state.services.filter((s) => s.status !== 'ok')
  add('services', 'services', {}, down.some((s) => s.status === 'down') ? 60 : down.length ? 45 : 10,
    down.length ? `${down.map((s) => `${s.name} ${s.status}`).join(', ')}` : 'All services healthy')
  const burn = state.slo.burn
  add('slo', 'slo', {}, burn >= 5 ? 85 : burn >= 2 ? 62 : burn >= 1 ? 38 : 8,
    burn >= 1 ? `Error budget burning ${burn}× (gone in ${Math.round(720 / burn)} h)` : 'Error budget fine')
  const q = state.queue
  add('queue', 'queue', {}, q.depth >= 1500 ? 66 : q.depth >= 600 ? 40 : 6,
    q.depth >= 600 ? `${q.depth.toLocaleString('en-US')} jobs waiting, ${q.trend > 0 ? 'rising' : 'draining'}` : 'Queue is short')
  const rolling = state.deploys.find((d) => d.status === 'rolling back')
  add('deploys', 'deploys', {}, rolling ? 55 : 12, rolling ? `${rolling.service} ${rolling.version} is rolling back` : 'No deploy in trouble')
  const stale = state.reviews.filter((r) => r.hours >= 24)
  add('reviews', 'reviews', {}, stale.length ? 30 : 5, stale.length ? `${stale.length} review${stale.length > 1 ? 's' : ''} waiting over a day` : 'No review waiting long')
  const soon = state.agenda.find((a) => a.in >= 0 && a.in <= 15)
  add('agenda', 'agenda', {}, soon ? 50 : 8, soon ? `${soon.title} in ${soon.in} min` : 'Nothing in the next 15 min')
  add('oncall', 'oncall', {}, 4, 'Rotation as usual')

  return items.sort((a, b) => b.score - a.score)
}

/** what makes the board rearrange: a part changing band, a pin or a snooze (not every score change) */
export const signature = (state) => [
  ...attention(state).map((i) => `${i.key}=${i.band}`).sort(),
  `pins=${state.pins.join(',')}`,
  `snoozed=${state.snoozed.join(',')}`,
].join(' ')

const visible = (state) => attention(state).filter((i) => !state.snoozed.includes(i.key))

const nodeOf = (i, size) => ({ part: i.part, params: { ...i.params, size, why: i.reason } })

/**
 * The rules' arrangement: pinned parts first, then what needs action (full size), what to watch
 * side by side (compact), and the calm parts folded into the "quiet" container at the bottom.
 */
export function rulesTree(state) {
  const items = visible(state)
  const pinned = items.filter((i) => state.pins.includes(i.key))
  const rest = items.filter((i) => !state.pins.includes(i.key))
  const act = rest.filter((i) => i.band === 'act')
  const watch = rest.filter((i) => i.band === 'watch')
  const calm = rest.filter((i) => i.band === 'calm')
  const tree = [...pinned.map((i) => nodeOf(i, 'full')), ...act.map((i) => nodeOf(i, 'full'))]
  for (let k = 0; k < watch.length; k += 3) {
    const group = watch.slice(k, k + 3).map((i) => nodeOf(i, 'compact'))
    tree.push(group.length > 1 ? { part: 'row', children: group } : group[0])
  }
  if (calm.length) tree.push({ part: 'quiet', children: calm.map((i) => nodeOf(i, 'compact')) })
  return tree
}

export const rulesLayout = (catalog, state) => fromTree(catalog, rulesTree(state), state.page.layout)

const ROLES = {
  oncall: 'the on-call engineer, who has to fix things now',
  manager: 'the engineering manager, who needs to know what is at risk and who is on it',
}

/**
 * The model's arrangement: a brief of the situation, written by the app. The model doesn't see the
 * data; it sees this text (and the incidents' record descriptions), so the brief is the whole of
 * what the model knows about "attention".
 */
export function brief(state) {
  const items = visible(state)
  const lines = items.filter((i) => i.band !== 'calm').map((i) => `- ${i.part}${i.params.id ? ` ${i.params.id}` : ''}: ${i.reason}`)
  const calm = items.filter((i) => i.band === 'calm').map((i) => i.part)
  const pins = state.pins.map((k) => k.replace(':', ' '))
  return [
    `Arrange my ops board for ${ROLES[state.role]}. What is going on now:`,
    ...(lines.length ? lines : ['- nothing needs attention']),
    calm.length ? `Normal: ${calm.join(', ')}.` : '',
    `Show every part listed here${pins.length ? `. Keep ${pins.join(' and ')} at the very top` : ''}. Put what needs action first, at full size; the things to watch side by side, compact; the normal parts inside the quiet section at the bottom.`,
    `Give each part a why: one short reason it is where it is.`,
  ].filter(Boolean).join('\n')
}

/**
 * A model's layout, held to the person's choices: pinned parts it left out or put lower go back to
 * the top, snoozed parts it kept come out. The model is told both in the brief; this is the
 * guarantee. Returns null when the layout already complies.
 */
export function enforceChoices(catalog, state, layout) {
  const tree = toTree(layout)
  const keyOf = (n) => (n.part === 'incident' ? `incident:${n.params?.id}` : n.part)
  const drop = (nodes, out) => nodes.flatMap((n) => {
    if (n.children) return [{ ...n, children: drop(n.children, out) }]
    if (state.snoozed.includes(keyOf(n)) || state.pins.includes(keyOf(n))) { out.push(n); return [] }
    return [n]
  })
  const flat = (nodes) => nodes.flatMap((n) => (n.children ? flat(n.children) : [n]))
  const complies = !flat(tree).some((n) => state.snoozed.includes(keyOf(n))) && state.pins.every((k, i) => tree[i] && keyOf(tree[i]) === k)
  if (complies) return null
  const removed = []
  const rest = drop(tree, removed).filter((n) => !n.children || n.children.length)
  const items = attention(state)
  const pinned = state.pins.map((k) => removed.find((n) => keyOf(n) === k) ?? nodeOf(items.find((i) => i.key === k) ?? { part: k, params: {}, reason: '' }, 'full'))
    .filter((n) => catalog.get(n.part))
  return fromTree(catalog, [...pinned.map((n) => ({ ...n, params: { ...n.params, size: 'full' } })), ...rest], layout)
}
