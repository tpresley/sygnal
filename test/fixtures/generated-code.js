// compose.generated's scripted model output (no LLM call), from the compose-sandbox spike
// (dev-plans/research/compose-sandbox/fixtures/code.js): the code a model writes for a generated
// part, as it appears in the `code` param of compose.llm()'s structured reply. GOOD are working
// parts in the shape gen.instructions asks for; BROKEN is the repair corpus: each entry is a
// realistic first attempt with a mistake models make in an unfamiliar framework, then the repair
// reply(s). Turns are scripted: the corpus checks that each error reaches the model with enough to
// fix it, not how often a real model does (an eval's job).
// (trimmed: compose.llm trims text params, so the code that mounts is the trimmed text)
const trimmed = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.trim()]))

export const GOOD = trimmed({
  byStatus: `const STATUSES = ['paid', 'pending', 'refunded']

export default function OrdersByStatus({ state }) {
  const counts = STATUSES.map((s) => ({ s, n: state.orders.filter((o) => o.status === s).length }))
  const max = Math.max(1, ...counts.map((c) => c.n))
  return <div className="card stack">
    {counts.map((c) => <button className="btn bar" data-status={c.s} style={{ width: (20 + 80 * c.n / max) + '%' }}>{c.s}: {c.n}</button>)}
  </div>
}
OrdersByStatus.initialState = { orders: [] }
OrdersByStatus.intent = ({ DOM, PROPS }) => ({
  DATA: PROPS.stream,
  PICK: DOM.select('.bar').events('click').map((e) => e.target.dataset.status),
})
OrdersByStatus.model = {
  DATA: (state, data) => ({ ...state, ...data }),
  PICK: { EVENTS: (state, status) => ({ type: 'FILTER_STATUS', data: { status } }) },
}
`,
  topCustomers: `export default function TopCustomers({ state }) {
  const rows = state.customers.map((c) => ({
    ...c,
    total: state.orders.filter((o) => o.customer === c.id && o.status === 'paid').reduce((a, o) => a + o.total, 0),
  })).sort((a, b) => b.total - a.total).slice(0, 5)
  return <table className="table">
    <thead><tr><th>Customer</th><th>Paid</th><th></th></tr></thead>
    <tbody>{rows.map((c) => <tr>
      <td className="name">{c.name}</td>
      <td>EUR {c.total.toFixed(2)}</td>
      <td><button className="btn open" data-id={c.id}>Open</button></td>
    </tr>)}</tbody>
  </table>
}
TopCustomers.initialState = { orders: [], customers: [] }
TopCustomers.intent = ({ DOM, PROPS }) => ({
  DATA: PROPS.stream,
  OPEN: DOM.select('.open').events('click').map((e) => Number(e.target.dataset.id)),
})
TopCustomers.model = {
  DATA: (state, data) => ({ ...state, ...data }),
  OPEN: { EVENTS: (state, id) => ({ type: 'OPEN_CUSTOMER', data: { id } }) },
}
`,
  refunds: `export default function Refunds({ state }) {
  const refunded = state.orders.filter((o) => o.status === 'refunded')
  const sum = refunded.reduce((a, o) => a + o.total, 0)
  return <div className="card">
    <p className="muted">Refunds</p>
    <strong className="refund-total">EUR {sum.toFixed(2)}</strong>
    <span className="badge">{refunded.length} orders</span>
  </div>
}
Refunds.initialState = { orders: [] }
Refunds.intent = ({ PROPS }) => ({ DATA: PROPS.stream })
Refunds.model = { DATA: (state, data) => ({ ...state, ...data }) }
`,
  pending: `import { ABORT } from 'sygnal'

export default function PendingLookup({ state }) {
  const rows = state.orders.filter((o) => o.status === 'pending' && (!state.q || String(o.id).includes(state.q)))
  return <div className="card stack">
    <input className="q" placeholder="Order id" value={state.q} />
    <ul>{rows.slice(0, 8).map((o) => <li>#{o.id} EUR {o.total.toFixed(2)}</li>)}</ul>
    <p className="muted count">{rows.length} pending</p>
  </div>
}
PendingLookup.initialState = { orders: [], q: '' }
PendingLookup.intent = ({ DOM, PROPS }) => ({
  DATA: PROPS.stream,
  Q: DOM.select('.q').events('input').map((e) => e.target.value.trim()),
})
PendingLookup.model = {
  DATA: (state, data) => ({ ...state, ...data }),
  Q: (state, q) => (q === state.q ? ABORT : { ...state, q }),
}
`,
})

/** n distinct working parts (the four above, varied), for the 1 / 3 / 10 part measurements */
export function variants(n) {
  const base = Object.entries(GOOD)
  return Array.from({length: n}, (_, i) => {
    const [name, code] = base[i % base.length]
    const reads = /customers/.test(code) ? ['orders', 'customers'] : ['orders']
    // a distinct module per part (another component name and a comment), so no two share a hash
    return {title: `${name} ${i + 1}`, reads, code: `// part ${i + 1}\n` + code.replace(/\b(OrdersByStatus|TopCustomers|Refunds|PendingLookup)\b/g, `$1${i + 1}`)}
  })
}

const fix = (code) => JSON.stringify({code})

// The repair corpus. `reason`: what the box reports first (src/Sandboxed.js). `replies`: the
// model's repair turns in order (a reply that doesn't fix it leads to the next turn).
export const BROKEN = [
  {
    name: 'syntax: an unclosed element',
    reads: ['orders'], reason: 'compile', match: /Unexpected token \(\d+:\d+\)/,
    code: GOOD.refunds.replace('<span className="badge">{refunded.length} orders</span>\n  </div>', '<span className="badge">{refunded.length} orders</span>\n'),
    replies: [fix(GOOD.refunds)],
  },
  {
    name: 'reaches for document in the view',
    reads: ['orders'], reason: 'runtime', match: /'document' is not defined/,
    code: GOOD.refunds.replace("const sum = ", "document.title = 'Refunds'\n  const sum = "),
    replies: [fix(GOOD.refunds)],
  },
  {
    name: 'imports a library',
    reads: ['orders'], reason: 'error', match: /date-fns' can't be imported/,
    code: "import { format } from 'date-fns'\n" + GOOD.refunds.replace('<p className="muted">Refunds</p>', '<p className="muted">Refunds {format(new Date(), \'MMM d\')}</p>'),
    replies: [fix(GOOD.refunds)],
  },
  {
    name: 'React habits: useState',
    reads: ['orders'], reason: 'runtime', match: /'useState' is not defined/,
    code: GOOD.refunds.replace('const refunded', "const [open, setOpen] = useState(false)\n  const refunded"),
    replies: [fix(GOOD.refunds)],
  },
  {
    name: 'React habits: onClick in JSX (silent at run time; caught by the pre-mount check)',
    reads: ['orders'], reason: 'compile', match: /onClick.*don't run/,
    code: GOOD.byStatus.replace('<button className="btn bar"', '<button onClick={() => console.log(c.s)} className="btn bar"'),
    replies: [fix(GOOD.byStatus)],
  },
  {
    name: 'wiring: an intent action without a model entry (silent; the kernel\'s SYG101 check at boot)',
    reads: ['orders'], reason: 'check', match: /SYG101: intent action 'PICK' has no model entry/,
    code: GOOD.byStatus.replace('  PICK: { EVENTS:', '  PICKED: { EVENTS:'),
    replies: [fix(GOOD.byStatus)],
  },
  {
    name: 'an event payload of the wrong shape (customerId for id)',
    reads: ['orders', 'customers'], reason: 'rejected', match: /invalid \(id: Invalid input: expected number/, click: '.open',
    code: GOOD.topCustomers.replace("data: { id } })", "data: { customerId: id } })"),
    replies: [fix(GOOD.topCustomers)],
  },
  {
    name: 'an undeclared event type',
    reads: ['orders', 'customers'], reason: 'rejected', match: /undeclared/, click: '.open',
    code: GOOD.topCustomers.replace("type: 'OPEN_CUSTOMER'", "type: 'SELECT_CUSTOMER'"),
    replies: [fix(GOOD.topCustomers)],
  },
  {
    name: 'an endless loop in the view (i-- for i++)',
    reads: ['orders'], reason: 'timeout', match: /interrupted|terminated|timeout/i,
    code: GOOD.refunds.replace('const sum = refunded.reduce((a, o) => a + o.total, 0)', 'let sum = 0\n  for (let i = 0; i < refunded.length; i--) sum += refunded[i]?.total || 0'),
    replies: [fix(GOOD.refunds)],
  },
  {
    name: 'a lookup table far over the memory cap (ArrayBuffer)',
    reads: ['orders'], reason: 'runtime', match: /out of memory/,
    code: GOOD.refunds.replace('const refunded', 'const table = new Float64Array(64 * 1024 * 1024)\n  const refunded'),
    replies: [fix(GOOD.refunds)],
  },
  {
    name: 'recursion without a base case',
    reads: ['orders'], reason: 'runtime', match: /stack overflow/,
    code: GOOD.refunds.replace('const sum = refunded.reduce((a, o) => a + o.total, 0)', 'const add = (list) => list[0].total + add(list.slice(1).concat(list[0]))\n  const sum = refunded.length ? add(refunded) : 0'),
    replies: [fix(GOOD.refunds)],
  },
  {
    name: 'renders nothing (waits for a flag nothing sets)',
    reads: ['orders'], reason: 'empty', match: /nothing/,
    code: GOOD.refunds.replace('  return <div className="card">', '  if (!state.ready) return null\n  return <div className="card">'),
    replies: [fix(GOOD.refunds)],
  },
  {
    name: 'over the size limit',
    reads: ['orders'], reason: 'compile', match: /over the limit/, maxCode: 1500,
    code: GOOD.refunds + '\n' + Array.from({length: 60}, (_, i) => `// note ${i}: padding a model might write as long comments`).join('\n'),
    replies: [fix(GOOD.refunds)],
  },
  {
    name: 'two mistakes: the fix of the first reveals the second (2 turns)',
    reads: ['orders'], reason: 'error', match: /can't be imported/, turns: 2,
    code: "import { sum } from 'lodash'\n" + GOOD.refunds.replace("const sum = refunded.reduce((a, o) => a + o.total, 0)", "document.title = 'x'\n  const total = sum(refunded.map((o) => o.total))").replace('sum.toFixed', 'total.toFixed'),
    replies: [
      fix(GOOD.refunds.replace("const sum = refunded.reduce((a, o) => a + o.total, 0)", "document.title = 'x'\n  const sum = refunded.reduce((a, o) => a + o.total, 0)")),
      fix(GOOD.refunds),
    ],
  },
  {
    name: 'a model that does not fix it: gives up after maxAttempts (2), the part shows a fallback',
    reads: ['orders'], reason: 'runtime', match: /'window' is not defined/, turns: 2, gaveUp: true,
    code: GOOD.refunds.replace('const refunded', 'const w = window.innerWidth\n  const refunded'),
    replies: [
      fix(GOOD.refunds.replace('const refunded', 'const w = window.screen.width\n  const refunded')),
      fix(GOOD.refunds.replace('const refunded', 'const w = globalThis.window.innerWidth\n  const refunded')),
    ],
  },
]
