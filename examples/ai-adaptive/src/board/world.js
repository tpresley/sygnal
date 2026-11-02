// A small simulated ops world, advanced one step per tick by a fixed script, so the board can be
// watched (and tested) going from calm to a bad morning and back.

export const START = {
  tick: 0,
  services: [
    { id: 'checkout', name: 'Checkout API', status: 'ok', p99: 180 },
    { id: 'search', name: 'Search', status: 'ok', p99: 95 },
    { id: 'payments', name: 'Payments', status: 'ok', p99: 240 },
    { id: 'email', name: 'Email sender', status: 'ok', p99: 60 },
  ],
  incidents: [],
  slo: { burn: 0.6 },
  queue: { depth: 140, trend: 0 },
  deploys: [
    { id: 'd-311', service: 'search', version: 'v2.14.0', status: 'done', ago: 50 },
    { id: 'd-312', service: 'checkout', version: 'v8.3.1', status: 'done', ago: 25 },
  ],
  reviews: [
    { id: 'pr-901', title: 'Retry payment webhooks with backoff', author: 'Ana', hours: 30 },
    { id: 'pr-907', title: 'Bump search index shards', author: 'Raj', hours: 3 },
  ],
  agenda: [
    { id: 'standup', title: 'Team standup', in: 40 },
    { id: 'review', title: 'Quarterly planning', in: 180 },
  ],
  oncall: { primary: 'You', secondary: 'Raj', handoffIn: 300 },
}

const service = (w, id, patch) => ({ ...w, services: w.services.map((s) => (s.id === id ? { ...s, ...patch } : s)) })
const incident = (w, i) => ({ ...w, incidents: [...w.incidents, { acked: false, note: '', minutes: 0, ...i }] })
const resolve = (w, id) => ({ ...w, incidents: w.incidents.filter((i) => i.id !== id) })

/** what happens at each tick (after the tick's clock step) */
export const SCRIPT = {
  2: (w) => ({ ...w, queue: { depth: 900, trend: 1 } }),
  3: (w) => ({ ...w, queue: { depth: 1650, trend: 1 } }),
  4: (w) => incident(service(w, 'payments', { status: 'degraded', p99: 1900 }), { id: 41, title: 'Payment webhooks timing out', service: 'payments', sev: 2 }),
  5: (w) => ({ ...w, slo: { burn: 2.4 }, deploys: [{ id: 'd-313', service: 'payments', version: 'v5.0.0', status: 'rolling back', ago: 0 }, ...w.deploys] }),
  6: (w) => incident(service(w, 'checkout', { status: 'down', p99: 0 }), { id: 42, title: 'Checkout returns 502 for every order', service: 'checkout', sev: 1 }),
  7: (w) => ({ ...w, slo: { burn: 6.8 } }),
  9: (w) => ({ ...resolve(service(w, 'checkout', { status: 'ok', p99: 210 }), 42), slo: { burn: 3.1 } }),
  10: (w) => ({ ...w, deploys: w.deploys.map((d) => (d.id === 'd-313' ? { ...d, status: 'rolled back' } : d)), queue: { depth: 700, trend: -1 } }),
  11: (w) => ({ ...resolve(service(w, 'payments', { status: 'ok', p99: 260 }), 41), slo: { burn: 1.2 }, queue: { depth: 160, trend: -1 } }),
  12: (w) => ({ ...w, slo: { burn: 0.7 }, queue: { depth: 120, trend: 0 } }),
}

export const LAST_TICK = 12

/** one step: the clocks move (incident ages, deploy ages, the agenda), then the script's event */
export function step(w) {
  const tick = w.tick + 1
  const moved = {
    ...w,
    tick,
    incidents: w.incidents.map((i) => ({ ...i, minutes: i.minutes + 5 })),
    deploys: w.deploys.map((d) => ({ ...d, ago: d.ago + 5 })),
    agenda: w.agenda.map((a) => ({ ...a, in: a.in - 5 })).filter((a) => a.in > -30),
    reviews: w.reviews.map((r) => ({ ...r, hours: r.hours + 1 })),
  }
  return SCRIPT[tick] ? SCRIPT[tick](moved) : moved
}
