// A `generated` part kind for sygnal/ai's compose, built only on public API (no src/ change):
//
//   const gen = generated(runtime, {
//     data:  { orders: { description: 'recent orders', shape: '[{ id, customer, total, status }]', from: (s) => s.orders } },
//     emits: { OPEN_ORDER: { description: 'the user picked an order', schema: z.object({ id: z.number().int() }) } },
//   })
//   const catalog = defineCatalog({ parts: { revenue: {...}, orders: {...}, custom: gen.part } })
//   Dashboard.uses = { page: compose(catalog, { backend: compose.llm({ instructions: gen.instructions }) }), fix: gen.repair() }
//   Dashboard.intent = ({ CHILD }) => ({ OPEN_ORDER: gen.events(CHILD, 'OPEN_ORDER') })
//
// What the model writes: one node `{ part: 'custom', params: { title, reads, code } }` per
// generated part, inside the same structured-output layout as every other part (compose.llm's
// schema: `code` is a text param, so the schema caps its length). Everything else is the app's:
//
// - The part is an ordinary catalog part whose component (GeneratedHost) is trusted app code. It
//   mounts <Sandboxed> with the code, the data the node `reads` (only keys the app declared in
//   `data`, JSON only, computed from the host state by the app's own `from`) and the `emits`
//   schemas. The model never names a host action: an event is one of the declared types, its
//   data passes the schema, and the host's intent turns it into the host's own action.
// - The generated code's limits: `maxCode` characters (the schema's maxLength is maxCode + 1, so
//   a reply the provider didn't cap, or that finish() cut at the limit, is "too long", never
//   silently truncated code), imports only from 'sygnal' (the kernel's whitelist), no fetch unless
//   the app passes a capability.
// - Failures (compile, boot, a view or reducer that throws, an empty render, a rejected event,
//   a timeout / memory kill) go up as PARENT reports; `gen.repair()` turns each into one
//   small LLM request (the failing code and the error, not the page), and the reply's code is an
//   overlay: patches[hash(failing code)] = fixed code. The layout keeps the model's code, so a
//   final reply arriving after a repair (streaming) or a restored layout gets the fix too.
import {createElement as h, defineBehavior, ABORT, jsonSchema} from 'sygnal'
import {makeSandboxed} from './Sandboxed.js'

/** FNV-1a, 32 bits: the identity of a piece of code (patches and attempts are keyed by it) */
export function hash(s) {
  let x = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) }
  return (x >>> 0).toString(16).padStart(8, '0')
}

/** the code to run for `code`: its repairs followed (bounded) */
export function patched(code, slice) {
  let c = code
  for (let i = 0; i < 8 && slice?.patches; i++) {
    const n = slice.patches[hash(c)]
    if (typeof n !== 'string') break
    c = n
  }
  return c
}
const rootOf = (h0, slice) => { let r = h0; for (let i = 0; i < 8 && slice.parents[r]; i++) r = slice.parents[r]; return r }

/** a Standard Schema's JSON Schema, for the prompt (Standard JSON Schema, e.g. zod 4); else the description only */
function schemaText(schema) {
  try {
    const js = schema?.['~standard']?.jsonSchema?.output?.({target: 'draft-2020-12'})
    if (js) { delete js.$schema; return JSON.stringify(js) }
  } catch (_) { /* a schema that can't be expressed: description only */ }
  return null
}

export const CODE_RULES = (o) => `Custom parts: when no prepared part shows what the request asks for, add a part "${o.id}" and write its code in "code". At most ${o.maxUses} of them per page; prefer prepared parts.
"code" is one ES module with JSX: a Sygnal component (model-view-intent), at most ${o.maxCode} characters:
  import { ABORT, classes } from 'sygnal'            // the only import allowed
  export default function Name({ state }) { return <div className="card">...</div> }   // a pure view of state
  Name.initialState = { ... }                        // required
  Name.intent = ({ DOM, PROPS }) => ({ DATA: PROPS.stream, PICK: DOM.select('.row').events('click').map((e) => +e.target.dataset.id) })
  Name.model = { DATA: (state, data) => ({ ...state, ...data }), PICK: { EVENTS: (state, id) => ({ type: 'TYPE', data: { id } }) } }
- No hooks, no event handlers in JSX (no onClick): events come from DOM.select(selector).events(type) in intent. A reducer returns the new state (ABORT for no change).
- There is no document, window, fetch, localStorage or timers over a second. Libraries can't be imported. Data comes only from PROPS.
- PROPS.stream emits an object with the keys listed in "reads" (only these exist):
${Object.entries(o.data).map(([k, d]) => `  ${k}: ${d.description}${d.shape ? `; shape ${d.shape}` : ''}`).join('\n') || '  (none)'}
- To tell the app something, send EVENTS { type, data } with one of these types; data must match its JSON Schema, anything else is dropped:
${Object.entries(o.emits).map(([k, e]) => `  ${k}: ${e.description}${schemaText(e.schema) ? `; data ${schemaText(e.schema)}` : ''}`).join('\n') || '  (none: the part only displays)'}
- Style with these classes: ${o.classes}; inline style objects are allowed (no url()).`

export function generated(runtime, decl = {}) {
  const id = decl.id ?? 'custom'
  const data = decl.data ?? {}
  const emits = decl.emits ?? {}
  const maxCode = decl.maxCode ?? 6000
  const maxUses = decl.maxUses ?? 10
  const repairKey = decl.repairKey ?? 'fix'
  const isolation = decl.isolation ?? 'worker'
  const classes = decl.classes ?? 'card, stack, row, muted, badge, btn, btn-primary, table'
  const schemas = Object.fromEntries(Object.entries(emits).map(([k, e]) => [k, e.schema]))
  const Sandboxed = makeSandboxed(runtime, {warn: decl.warn})

  function GeneratedHost({state, title, code, input, node, repair}) {
    const note = repair === 'gave-up' ? h('p', {className: 'gen-note gen-gave-up'}, "This part couldn't be built.")
      : state.status === 'failed' ? h('p', {className: 'gen-note gen-fixing'}, repair === 'repairing' ? 'Fixing this part…' : 'This part hit an error.')
        : null
    return h('section', {className: 'gen-part', 'data-node': node, 'data-status': state.status},
      title ? h('h3', {className: 'gen-title'}, title) : null,
      note,
      repair === 'gave-up' ? null : h(Sandboxed, {className: 'gen-box', code, input, emits: schemas, maxCode, isolation, limits: decl.limits, policy: decl.policy, capabilities: decl.capabilities}))
  }
  const report = (kind) => (_s, d, _n, p) => ({kind, node: p.node, code: p.code, ...(kind === 'emit' ? {type: d.type, data: d.data} : kind === 'ready' ? {stats: d} : {error: d})})
  GeneratedHost.intent = ({DOM}) => {
    const box = DOM.select('.gen-box')
    return {
      READY: box.events('sandboxready').detail(),
      FAILED: box.events('sandboxerror').detail(),
      REJECTED: box.events('sandboxreject').detail(),
      EMIT: box.events('emit').detail(),
    }
  }
  GeneratedHost.model = {
    READY: {STATE: (s, d) => ({...s, status: 'ok', tier: d.tier, readyMs: d.readyMs}), PARENT: report('ready')},
    FAILED: {STATE: (s, e) => ({...s, status: 'failed', error: e}), PARENT: report('failed')},
    // a rejected event is a bug in the code, but the part still works: reported, not shown
    REJECTED: {PARENT: report('rejected')},
    EMIT: {PARENT: report('emit')},
  }

  const part = {
    component: GeneratedHost,
    description: decl.description ?? 'Custom part (one you write yourself as code, for what no other part shows)',
    params: {
      title: {type: 'text', maxLength: 60, label: 'its heading'},
      reads: {type: 'list', items: {maxLength: 40}, max: Math.max(1, Object.keys(data).length), label: `the data it reads, any of: ${Object.keys(data).join(', ') || 'none'}`},
      // format: 'code' is read only with patches/compose-code-param.patch (README §7); ignored otherwise
      code: {type: 'text', format: 'code', maxLength: maxCode + 1, required: true, label: 'its source code (see "Custom parts" below)'},
    },
    local: {status: 'mounting', error: null, tier: null, readyMs: null},
    maxUses,
    props: (params, state) => {
      const fix = state?.[repairKey]
      const code = patched(String(params.code ?? ''), fix)
      const input = {}
      for (const k of params.reads || []) if (Object.prototype.hasOwnProperty.call(data, k)) input[k] = data[k].from(state)
      const root = fix ? rootOf(hash(code), fix) : null
      return {title: params.title, code, input, repair: fix?.status?.[root] ?? null}
    },
  }

  const instructions = CODE_RULES({id, maxCode, maxUses, data, emits, classes})

  /** the host's intent: a declared event type of any generated part, validated, as a stream of { node, data } */
  const events = (CHILD, type) => CHILD.select(GeneratedHost).filter((r) => r.kind === 'emit' && r.type === type).map((r) => ({node: r.node, ...r.data}))

  const REPAIR = `You fix the code of one custom part of a page. The user message has the code and what went wrong when it ran in the sandbox. Reply with JSON only: {"code": "<the whole fixed module>"}. Keep what the part does and change only what the error needs.\n\n${instructions}`

  /** gen.repair({ maxAttempts, model, sink }): the repair loop as a behavior (uses = { fix: gen.repair() }) */
  const repair = defineBehavior({
    initialState: {patches: {}, parents: {}, attempts: {}, status: {}, pending: {}, log: []},
    intent: ({CHILD}) => ({REPORT: CHILD.select(GeneratedHost).filter((r) => r.kind !== 'emit')}),
    model: {
      REPORT: {
        STATE: (s, r, _n, _p, o) => {
          const h0 = hash(r.code), root = rootOf(h0, s), st = s.status[root]
          // a repaired chain whose code now boots is fixed
          if (r.kind === 'ready') return h0 !== root && st === 'patched' ? {...s, status: {...s.status, [root]: 'fixed'}} : ABORT
          if (st === 'repairing' || st === 'gave-up') return ABORT
          // a report about code that already has a fix is stale: the part re-renders with the fix
          if (s.patches[h0]) return ABORT
          const n = (s.attempts[root] || 0)
          const entry = {node: r.node, root, attempt: n + 1, kind: r.kind, reason: r.error?.reason ?? r.error?.type, message: String(r.error?.message ?? r.error?.reason ?? '').slice(0, 300)}
          if (n >= (o.maxAttempts ?? 2)) return {...s, status: {...s.status, [root]: 'gave-up'}, log: [...s.log, {...entry, gaveUp: true}]}
          return {...s, attempts: {...s.attempts, [root]: n + 1}, status: {...s.status, [root]: 'repairing'}, pending: {...s.pending, [h0]: root}, log: [...s.log, entry]}
        },
        [decl.sink ?? 'LLM']: (s, r, _n, p, o, k) => {
          if (r.kind === 'ready') return ABORT
          const h0 = hash(r.code), root = rootOf(h0, s)
          const before = p?.previousState?.[k]
          // only when this report started the repair (STATE moved the chain to 'repairing')
          if (s.status[root] !== 'repairing' || before?.status?.[root] === 'repairing' || s.pending?.[h0] !== root) return ABORT
          const error = describe(r)
          return {
            key: 'fix:' + h0, latest: true, parse: false,
            ...(o.model && {model: o.model}),
            instructions: REPAIR,
            messages: [{role: 'user', content: `Code:\n${r.code}\n\nWhat went wrong: ${error}`}],
            output: jsonSchema({type: 'object', properties: {code: {type: 'string', maxLength: maxCode}}, required: ['code'], additionalProperties: false}),
            ok: k + '.REPLY', error: k + '.FAILED',
          }
        },
      },
      REPLY: (s, reply) => {
        const h0 = String(reply?.key ?? '').replace(/^fix:/, ''), root = s.pending?.[h0]
        if (!root) return ABORT
        const code = codeOf(reply?.text)
        const {[h0]: _, ...pending} = s.pending
        if (!code || hash(code) === h0) return {...s, pending, status: {...s.status, [root]: 'gave-up'}}
        return {...s, pending, patches: {...s.patches, [h0]: code}, parents: {...s.parents, [hash(code)]: h0}, status: {...s.status, [root]: 'patched'}}
      },
      FAILED: (s, e) => {
        const h0 = String(e?.key ?? '').replace(/^fix:/, ''), root = s.pending?.[h0]
        if (!root) return ABORT
        const {[h0]: _, ...pending} = s.pending
        return {...s, pending, status: {...s.status, [root]: 'gave-up'}}
      },
    },
  })

  return {id, part, Host: GeneratedHost, Sandboxed, instructions, events, repair, schemas}
}

/**
 * a failure report as the repair request words it: the reason, then what the model can act on
 * (the core's dev text around a guest's exception is dropped: '[Sygnal SYG406] X: View threw; … https://… TypeError: …')
 */
export function describe(r) {
  const e = r.error
  if (r.kind === 'rejected') return `the app dropped an event ${e.type}: ${e.reason}${e.declared ? ` (it takes only ${e.declared.join(', ')})` : ''}${e.issues?.length ? ' (' + e.issues.map((i) => `${i.path.join('.') || 'data'}: ${i.message}`).join('; ') + ')' : ''}`
  if (typeof e !== 'object' || !e) return String(e)
  let msg = String(e.message ?? '')
  const core = /^\[Sygnal (SYG\d+)\][^:]*:\s*([^;.]*)[\s\S]*?https:\/\/\S+\s*([\s\S]*)$/.exec(msg)
  if (core) msg = `${core[2].trim().toLowerCase()} (${core[1]}): ${core[3].trim()}`
  return `${e.reason}: ${msg.replace(/^Error: /, '')}`
}

/** the code in a repair reply: {"code": …} (a fence or prose around it tolerated), or a bare module in a fence */
export function codeOf(text) {
  if (typeof text !== 'string') return null
  const t = text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1')
  for (const c of [t, (/\{[\s\S]*\}/.exec(t) || [])[0]]) {
    try { const v = JSON.parse(c); if (typeof v?.code === 'string' && v.code.trim()) return v.code } catch (_) { /* not JSON */ }
  }
  const m = /```(?:jsx|js|javascript)?\s*([\s\S]*?)```/.exec(text)
  return m && /export\s+default/.test(m[1]) ? m[1] : null
}
