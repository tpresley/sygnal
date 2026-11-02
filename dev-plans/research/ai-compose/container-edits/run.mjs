// Container edits for compose.llm() (container-edits.md): the edit variants against a live model.
//   npx esbuild dev-plans/research/ai-compose/container-edits/run.mjs --bundle --platform=node --format=esm --outfile=<scratch>/run.mjs
//   node <scratch>/run.mjs --out=dev-plans/research/ai-compose/container-edits [--variants=false,ops --only=c3 --model=qwen3:8b --runs=1]
// (bundled: src/ imports have no extensions)
// Each case: a previous page, a change, the acceptable results (the compact notation of
// test/p9-llm-helpers.js; text params ignored there, section titles checked on their own). The real
// backend (src/extra/ai/compose/llm.ts) builds the request; the chatCompletions transport sends it to
// Ollama (temperature 0, reasoning_effort 'none'); every text delta goes through delta() as the app
// would (a runaway reply is stopped there), then reply(). Writes results-<variant>.json to --out.
import { writeFileSync } from 'node:fs'
import { llm } from '../../../../src/extra/ai/compose/llm.ts'
import { fromTree, finish } from '../../../../src/extra/ai/compose/layout.ts'
import { chatCompletions } from '../../../../src/extra/ai/transports/chatCompletions.ts'
import { catalog, fromResearch, tree, str, want } from '../../../../test/p9-llm-helpers.js'
import { EXT, EDIT_CASES } from '../llm/evals/cases.mjs'

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d
const MODEL = arg('model', 'qwen3:8b')
const OLLAMA = arg('url', 'http://localhost:11434')
const VARIANTS = arg('variants', 'false,ops').split(',').map((v) => (v === 'false' ? false : v === 'ops' ? true : v))
const ONLY = arg('only', '')
const RUNS = +arg('runs', 1)

// the intake form of examples/ai-adaptive (src/intake/catalog.jsx), renders stubbed
const anywhere = ['page', 'section']
const label = (fallback, maxLength = 40) => ({ type: 'text', maxLength, default: fallback, label: 'the field label' })
const R = () => null
const intake = catalog({
  parts: {
    contact: { render: R, in: anywhere, description: 'Contact (how to reach the person filing it: email, and a phone number)',
      params: { phone: { label: 'the phone field', default: 'optional', options: { optional: 'phone is optional', required: 'phone is required (someone must call back)', none: 'no phone field' } } } },
    dates: { render: R, in: anywhere, description: 'Dates (a date picker for when something happens or happened)',
      params: { mode: { label: 'one day or a range', default: 'single', options: { single: 'one day (when it happened, a due date)', range: 'a from–to range (leave, a trip)' } }, label: label('When') } },
    amount: { render: R, in: anywhere, description: 'Amount (a money field with its currency)', params: { label: label('Amount') } },
    device: { render: R, in: anywhere, description: 'Device (which company device: its kind and asset tag)' },
    place: { render: R, in: anywhere, description: 'Place (a free-text location: where it happened, or where to go)', params: { label: label('Where') } },
    details: { render: R, in: anywhere, description: 'Details (one long free-text answer)', params: { question: label('Anything else we should know?', 80) } },
    urgency: { render: R, in: anywhere, description: 'Urgency (how soon it must be handled: whenever, this week, today)' },
    approver: { render: R, in: anywhere, description: 'Approver (pick the manager who has to sign off)' },
    attachments: { render: R, in: anywhere, description: 'Attachments (upload photos, receipts or documents)', params: { label: label('Attachments') } },
    consent: { render: R, in: anywhere, description: 'Confirmation (a checkbox the person ticks to confirm one statement)', params: { statement: { type: 'text', maxLength: 100, required: true, label: 'what the person confirms' } } },
    question: { render: R, in: anywhere, maxUses: 3, description: 'Custom question (one extra question that no other part asks)',
      params: { label: { type: 'text', maxLength: 60, required: true, label: 'the question' }, answer: { label: 'the kind of answer', default: 'short', options: { short: 'a short text answer', long: 'a paragraph', yesno: 'yes or no' } } } },
  },
  containers: { section: { description: 'Section (a titled group of related fields)', maxUses: 3, params: { title: { type: 'text', maxLength: 40, required: true, label: 'the section title' } } } },
  guidance: ['Group the fields in sections only when there are more than five.', 'Prefer a prepared part to a custom question; use a custom question only for something no part asks.'],
  limits: { maxParts: 10, maxDepth: 2 },
})
intake.rows = false

// previous pages: `section{title=Trip}(dates,amount)`; wants: one or more acceptable results; titles: words each section title must contain, in page order
const CONTAINER = [
  ['c1', 'contact dates amount approver details', 'Put the dates and amount in a Trip section, and the approver and contact in an Approval section',
    ['section(dates,amount) section(approver,contact) details', 'section(dates,amount) section(contact,approver) details', 'section(contact,approver) section(dates,amount) details', 'section(approver,contact) section(dates,amount) details'], null],
  ['c2', 'section{title=Trip}(dates,amount) details', 'Move the details into the Trip section', ['section(dates,amount,details)'], ['trip']],
  ['c3', 'section{title=Trip}(dates,amount,details)', 'Take the details out of the section and put them below it', ['section(dates,amount) details'], ['trip']],
  ['c4', 'section{title=Trip}(dates,amount) section{title=Approval}(approver,contact)', 'Remove the sections but keep their fields', ['dates amount approver contact'], []],
  ['c5', 'section{title=Trip}(dates,amount) section{title=Approval}(approver)', 'Move the amount to the Approval section', ['section(dates) section(approver,amount)', 'section(dates) section(amount,approver)'], ['trip', 'approval']],
  ['c6', 'dates place details contact', 'Group the dates and the place in a section called Where and when', ['section(dates,place) details contact'], ['where']],
  ['c7', 'section{title=Trip}(dates,amount) contact', 'Add an approver field to the Trip section', ['section(dates,amount,approver) contact'], ['trip']],
  ['c8', 'section{title=Trip}(dates,amount) contact approver', 'Put the contact and approver in a section titled People', ['section(dates,amount) section(contact,approver)'], ['trip', 'people']],
  ['c9', 'section{title=Details}(details,attachments) contact', 'Unwrap the Details section', ['details attachments contact'], []],
  ['c10', 'section{title=Trip}(dates,amount) section{title=Approval}(approver,contact)', 'Rename the Trip section to Travel', ['section(dates,amount) section(approver,contact)'], ['travel', 'approval']],
]
const PLAIN = [
  ['r1', 'contact dates details', 'Put the dates first', ['dates contact details']],
  ['r2', 'contact dates details', 'Add attachments at the bottom', ['contact dates details attachments']],
  ['r3', 'contact dates details', 'Remove the contact', ['dates details']],
  ['r4', 'dates amount', 'Make the dates a range', ['dates{mode=range} amount']],
  ['r5', 'section{title=Trip}(dates,amount) details', 'Add an urgency field at the top of the page', ['urgency section(dates,amount) details']],
  ['r6', 'section{title=Trip}(dates,amount) details', 'Add attachments below the details', ['section(dates,amount) details attachments']],
  ['r7', 'section{title=Trip}(dates,amount) details', 'Remove the amount', ['section(dates) details']],
]
const ext = fromResearch(EXT)
const CASES = [
  ...CONTAINER.map(([id, prev, prompt, wants, titles]) => ({ id, set: 'container', cat: intake, prev, prompt, wants, titles })),
  ...PLAIN.map(([id, prev, prompt, wants]) => ({ id, set: 'plain', cat: intake, prev, prompt, wants })),
  ...EDIT_CASES.map((k) => ({ id: k.id, set: 'research', cat: ext, prev: k.prev, prompt: k.prompt, wants: [k.want] })),
].filter((k) => !ONLY || ONLY.split(',').includes(k.id))

const transport = chatCompletions({ baseURL: `${OLLAMA}/v1`, body: { temperature: 0, reasoning_effort: 'none' } })
const names = { ok: 'page.REPLY', error: 'page.FAILED', delta: 'page.DELTA', key: 'compose' }
const leaves = (l) => Object.entries(l.nodes).filter(([, n]) => !n.slots).map(([k, n]) => [k, n.part])
const titlesOf = (l) => { const out = []; const go = (k) => { const n = l.nodes[k]; if (n.part === 'section') out.push(String(n.params?.title ?? '')); for (const s of Object.values(n.slots || {})) s.forEach(go) }; go(l.root); return out }

async function one(variant, k) {
  const b = llm({ model: MODEL, containers: variant, timeoutMs: 0 })   // false: the research's ops2; true: wrap / unwrap / into
  const prev = finish(k.cat, fromTree(k.cat, tree(k.prev)), {})
  const { request, pending } = b.start({ catalog: k.cat, state: {}, prompt: k.prompt, previous: prev, names })
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 180000)
  const t0 = Date.now()
  let text = '', finishReason, stopped = null, err = null
  try {
    for await (const ev of transport.stream(request, ac.signal)) {
      if (ev.type === 'text') {
        text += ev.delta
        const d = b.delta({ catalog: k.cat, state: {}, pending, delta: { text } })
        if (d?.reply !== undefined) { stopped = d.reply; ac.abort(); break }
      } else if (ev.type === 'finish') finishReason = ev.reason
    }
  } catch (e) { if (!stopped) err = String(e.message ?? e) }
  clearTimeout(timer)
  const ms = Date.now() - t0
  const r = err ? { error: err } : b.reply({ catalog: k.cat, state: {}, pending, reply: stopped ?? { text, finishReason } })
  const layout = r.error ? null : r.unavailable ? prev : r.layout
  const got = layout ? str(k.cat, layout) : `ERROR ${r.error}`
  const exact = !!layout && k.wants.some((w) => want(k.cat, w) === got)
  const titles = !k.titles || !layout ? null : (() => { const ts = titlesOf(layout).map((t) => t.toLowerCase()); return ts.length === k.titles.length && k.titles.every((w, i) => ts[i].includes(w)) })()
  // keys: every leaf part in both the previous page and the result keeps its key
  const before = leaves(prev), after = layout ? leaves(layout) : []
  const kept = before.filter(([key, part]) => after.some(([, p]) => p === part)).every(([key, part]) => layout.nodes[key]?.part === part)
  return { id: k.id, set: k.set, variant: variant === true ? 'ops' : String(variant), ms, exact, titles, kept, got, wants: k.wants, stopped: stopped?.stopped ?? r.decisions?.repairs?.find?.((x) => x.kind === 'stopped')?.detail ?? null, finishReason, reply: stopped ? JSON.stringify(stopped.value) : text, ops: r.decisions?.ops }
}

for (const v of VARIANTS) {
  const rows = []
  for (let run = 0; run < RUNS; run++) for (const k of CASES) {
    const r = await one(v, k)
    rows.push(r)
    console.log(`${(v === true ? 'ops' : String(v)).padEnd(5)} ${r.id.padEnd(8)} ${r.exact ? 'EXACT' : '  -  '} ${r.titles === null ? '    ' : r.titles ? 'T ok' : 'T no'} ${r.kept ? 'keys' : 'KEYS'} ${String(r.ms).padStart(6)}ms ${r.stopped ? `[stopped: ${r.stopped}] ` : ''}${r.got}`)
  }
  const by = (set) => rows.filter((r) => r.set === set)
  const sum = (rs) => `${rs.filter((r) => r.exact).length}/${rs.length} exact, keys kept ${rs.filter((r) => r.kept).length}/${rs.length}, median ${rs.map((r) => r.ms).sort((a, b) => a - b)[rs.length >> 1] ?? 0} ms, max ${Math.max(0, ...rs.map((r) => r.ms))} ms`
  console.log(`== ${v === true ? 'ops' : v}: container ${sum(by('container'))}; plain ${sum(by('plain'))}; research ${sum(by('research'))}`)
  writeFileSync(`${arg('out', '.')}/results-${v === true ? 'ops' : v}.json`, JSON.stringify({ model: MODEL, variant: v, date: new Date().toISOString(), rows }, null, 1))
}
