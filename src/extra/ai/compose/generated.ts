/*
 * compose.generated(runtime, { data, emits, … }) (experimental, outside semver; research:
 * dev-plans/research/compose-sandbox): a catalog part whose component the model writes, run in
 * sygnal/sandbox. PLAN-9's rule "the model only chooses from components the app wrote" is relaxed
 * inside the box only: the code reads only the data the app declares and sends only the events it
 * declares, each one checked against its schema. Never in a catalog by default: an app adds
 * `gen.part` to the catalog it means.
 *
 *   const gen = compose.generated(generatedRuntime({ kernel, compile }), { data, emits })
 *   const catalog = defineCatalog({ parts: { revenue: {...}, custom: gen.part } })
 *   Dashboard.uses = { page: compose(catalog, { backend: compose.llm({ instructions: gen.instructions }) }), fix: gen.repair() }
 *   Dashboard.intent = ({ CHILD }) => ({ OPEN_CUSTOMER: gen.events(CHILD, 'OPEN_CUSTOMER') })
 *
 * - The model writes one node per generated part in the same structured reply: `{ part: 'custom',
 *   params: { title, reads, code } }`. `code` is a `format: 'code'` text param, last in the
 *   schema, capped at maxCode + 1 (compose cuts a text param at its maxLength; one character more
 *   keeps cut code "too long" instead of mounting it truncated).
 * - The part (GeneratedHost) is trusted app code: a <section> with the title and the runtime's
 *   Box. A node mounts only once its JSON object closes (compose.llm's preview prunes open
 *   leaves), and keeps its node key from the preview to the final layout, so it mounts once.
 * - Its input is `{ [key]: data[key].from(state) }` for the keys the node `reads` (others are
 *   ignored). Its accepted events go up as `{ kind: 'emit', node, type, data }`; `gen.events(CHILD,
 *   type)` turns them into `{ node, ...data }` for the host's own action.
 * - Failures go up as reports; `gen.repair()` (a behavior) answers each with one small LLM
 *   request (the code and one line naming the error, never the page), and the fix is an overlay
 *   (`patches[hash(code)] = fixed`) the part's props follow, so a layout that arrives after the
 *   fix, an edit or a restored page get it too. A chain that reaches maxAttempts is 'gave-up':
 *   that part shows a fallback, nothing else changes.
 * - `gen.card(type)`: the same part as a result part of a chat card (`chat({ ask: { catalog } })`):
 *   the code's `type` event is the card's answer. A `render_component` card is the one-part case.
 */
import {createElement as h} from '../../../pragma/index'
import {defineBehavior} from '../../behaviors'
import {ABORT} from '../../../shared'
import {jsonSchema} from '../schema/jsonSchema'

/** FNV-1a, 32 bits: the identity of a piece of code (patches and attempts are keyed by it) */
export function hash(s: string): string {
  let x = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) }
  return (x >>> 0).toString(16).padStart(8, '0')
}

/** the code that runs for `code`: its repairs followed (bounded) */
export function patched(code: string, fix: any): string {
  let c = code
  for (let i = 0; i < 8 && fix?.patches; i++) {
    const n = fix.patches[hash(c)]
    if (typeof n != 'string') break
    c = n
  }
  return c
}
const rootOf = (h0: string, fix: any) => { let r = h0; for (let i = 0; i < 8 && fix?.parents?.[r]; i++) r = fix.parents[r]; return r }

/** a Standard Schema's JSON Schema for the prompt (Standard JSON Schema, e.g. zod 4), else null */
function schemaText(schema: any): string | null {
  try {
    const js = schema?.['~standard']?.jsonSchema?.output?.({target: 'draft-2020-12'})
    if (js) { delete js.$schema; return JSON.stringify(js) }
  } catch (_) { /* not expressible: the description only */ }
  return null
}

const CODE_RULES = (o: any) => `Custom parts: when no prepared part shows what the request asks for, add a part "${o.id}" and write its code in "code". At most ${o.maxUses} of them per page; prefer prepared parts.
"code" is one ES module with JSX: a Sygnal component (model-view-intent), at most ${o.maxCode} characters:
  import { ABORT, classes } from 'sygnal'            // the only import allowed
  export default function Name({ state }) { return <div className="card">...</div> }   // a pure view of state
  Name.initialState = { ... }                        // required
  Name.intent = ({ DOM, PROPS }) => ({ DATA: PROPS.stream, PICK: DOM.select('.row').events('click').map((e) => +e.target.dataset.id) })
  Name.model = { DATA: (state, data) => ({ ...state, ...data }), PICK: { EVENTS: (state, id) => ({ type: 'TYPE', data: { id } }) } }
- Every intent action needs a model entry. No hooks, no event handlers in JSX (no onClick): events come from DOM.select(selector).events(type) in intent. A reducer returns the new state (ABORT for no change).
- There is no document, window, fetch, localStorage or timers over a second. Libraries can't be imported. Data comes only from PROPS.
- PROPS.stream emits an object with the keys listed in "reads" (only these exist):
${Object.entries<any>(o.data).map(([k, d]) => `  ${k}: ${d.description}${d.shape ? `; shape ${d.shape}` : ''}`).join('\n') || '  (none)'}
- To tell the app something, send EVENTS { type, data } with one of these types; data must match its JSON Schema, anything else is dropped:
${Object.entries<any>(o.emits).map(([k, e]) => { const js = schemaText(e.schema); return `  ${k}: ${e.description ?? k}${js ? `; data ${js}` : ''}` }).join('\n') || '  (none: the part only displays)'}
- Style with these classes: ${o.classes}; inline style objects are allowed (no url()).`

/** a failure report as the repair request words it (the core's dev text around a guest's exception dropped) */
export function describe(r: any): string {
  const e = r.error
  if (r.kind == 'rejected') {
    return `the app dropped an event ${e.type}: ${e.reason}${e.reason == 'undeclared' && e.declared ? ` (it takes only ${e.declared.join(', ')})` : ''}${e.issues?.length ? ' (' + e.issues.map((i: any) => `${(i.path || []).join('.') || 'data'}: ${i.message}`).join('; ') + ')' : ''}`
  }
  if (typeof e != 'object' || !e) return String(e)
  let m = String(e.message ?? '')
  const core = /^\[Sygnal (SYG\d+)\][^:]*:\s*([^;.]*)[\s\S]*?https:\/\/\S+\s*([\s\S]*)$/.exec(m)
  if (core) m = `${core[2].trim().toLowerCase()} (${core[1]}): ${core[3].trim()}`
  return `${e.reason}: ${m.replace(/^Error: /, '')}`
}

/** the code in a repair reply: {"code": …} (a fence or prose around it tolerated), or a bare module in a fence */
export function codeOf(text: any): string | null {
  if (typeof text != 'string') return null
  const t = text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1')
  for (const c of [t, (/\{[\s\S]*\}/.exec(t) || [])[0]]) {
    try { const v = JSON.parse(c!); if (typeof v?.code == 'string' && v.code.trim()) return v.code } catch (_) { /* not JSON */ }
  }
  const m = /```(?:jsx|js|javascript)?\s*([\s\S]*?)```/.exec(text)
  return m && /export\s+default/.test(m[1]) ? m[1] : null
}

const isSchema = (s: any) => !!s && typeof s == 'object' && typeof s['~standard']?.validate == 'function'

export function generated(runtime: any, decl: any = {}): any {
  if (!runtime || typeof runtime.Box != 'function') throw new TypeError("[Sygnal] compose.generated: the first argument is a runtime from generatedRuntime({ kernel, compile }) ('sygnal/sandbox')")
  const id = decl.id ?? 'custom'
  const data = decl.data ?? {}
  const emits = decl.emits ?? {}
  for (const k in emits) if (!isSchema(emits[k]?.schema)) throw new TypeError(`[Sygnal] compose.generated: emits.${k} needs \`schema\`, a Standard Schema for its data (zod, valibot, …)`)
  const maxCode = decl.maxCode ?? 4000
  const maxUses = decl.maxUses ?? 3
  const repairKey = decl.repairKey ?? 'fix'
  const isolation = decl.isolation ?? 'worker'
  const classes = decl.classes ?? 'card, stack, row, muted, badge, btn, btn-primary, table'
  const schemas = Object.fromEntries(Object.entries<any>(emits).map(([k, e]) => [k, e.schema]))
  const Box = runtime.Box

  function GeneratedHost({state, title, code, input, node, repair}: any) {
    const note = repair == 'gave-up' ? h('p', {className: 'gen-note gen-gave-up'}, decl.fallback ?? "This part couldn't be built.")
      : state.status == 'failed' ? h('p', {className: 'gen-note gen-fixing'}, repair == 'repairing' ? 'Fixing this part…' : 'This part hit an error.')
        : null
    return h('section', {className: 'gen-part', 'data-node': node, 'data-status': state.status},
      title ? h('h3', {className: 'gen-title'}, title) : null,
      note,
      repair == 'gave-up' ? null : h(Box, {className: 'gen-box', code, input, emits: schemas, maxCode, isolation, limits: decl.limits, policy: decl.policy, capabilities: decl.capabilities, checks: decl.check !== false}))
  }
  const report = (kind: string) => (_s: any, d: any, _n: any, p: any) => ({kind, node: p.node, code: p.code, ...(kind == 'emit' ? {type: d.type, data: d.data} : kind == 'ready' ? {stats: d} : {error: d})})
  const emitReport = report('emit')
  GeneratedHost.intent = ({DOM}: any) => {
    const box = DOM.select('.gen-box')
    return {
      READY: box.events('sandboxready').detail(),
      FAILED: box.events('sandboxerror').detail(),
      REJECTED: box.events('sandboxreject').detail(),
      EMIT: box.events('emit').detail(),
    }
  }
  GeneratedHost.model = {
    READY: {STATE: (s: any, d: any) => ({...s, status: 'ok', tier: d.tier, readyMs: d.readyMs, error: null}), PARENT: report('ready')},
    FAILED: {STATE: (s: any, e: any) => ({...s, status: 'failed', error: e}), PARENT: report('failed')},
    // a rejected event is a bug in the code, but the part still works: reported, not shown
    REJECTED: {PARENT: report('rejected')},
    // a card's answer type answers the card (compose.answer's shape); the rest is the host's
    EMIT: {PARENT: (s: any, d: any, n: any, p: any) => p.answerType === d.type && p.scope !== undefined ? {scope: p.scope, node: p.node, value: d.data} : emitReport(s, d, n, p)},
  }

  const makePart = (answerType?: string) => ({
    component: GeneratedHost,
    description: decl.description ?? 'Custom part (one you write yourself as code, for what no other part shows)',
    params: {
      title: {type: 'text', maxLength: 60, label: 'its heading'},
      reads: {type: 'list', items: {maxLength: 40}, max: Math.max(1, Object.keys(data).length), label: `the data it reads, any of: ${Object.keys(data).join(', ') || 'none'}`},
      code: {type: 'text', format: 'code', maxLength: maxCode + 1, required: true, label: 'its source code (see "Custom parts")'},
    },
    local: {status: 'mounting', error: null, tier: null, readyMs: null},
    maxUses,
    ...(answerType && {result: true}),
    props: (params: any, state: any) => {
      const fix = state?.[repairKey]
      const code = patched(String(params.code ?? ''), fix)
      const input: any = {}
      for (const k of params.reads || []) if (Object.prototype.hasOwnProperty.call(data, k)) input[k] = data[k].from(state)
      const root = fix ? rootOf(hash(code), fix) : null
      return {title: params.title, code, input, repair: (root && fix?.status?.[root]) ?? null, ...(answerType && {answerType})}
    },
  })
  const part = makePart()
  /** the part as a chat card's result part: the code's `type` event answers the card */
  const card = (type: string) => {
    if (!Object.prototype.hasOwnProperty.call(emits, type)) throw new TypeError(`[Sygnal] compose.generated: card('${type}'): '${type}' is not one of the declared emits (${Object.keys(emits).join(', ') || 'none'})`)
    return makePart(type)
  }

  const instructions = CODE_RULES({id, maxCode, maxUses, data, emits, classes})

  /** the host's intent: a declared event type of any generated part, validated, as a stream of { node, ...data } */
  const events = (CHILD: any, type: string) => CHILD.select(GeneratedHost).filter((r: any) => r && r.kind == 'emit' && r.type === type).map((r: any) => ({node: r.node, ...r.data}))

  const REPAIR = `You fix the code of one custom part of a page. The user message has the code and what went wrong when it ran in the sandbox. Reply with JSON only: {"code": "<the whole fixed module>"}. Keep what the part does and change only what the error needs.\n\n${instructions}`

  const repair = defineBehavior({
    initialState: {patches: {}, parents: {}, attempts: {}, status: {}, pending: {}, log: []},
    intent: ({CHILD}: any) => ({REPORT: CHILD.select(GeneratedHost).filter((r: any) => r && r.kind && r.kind != 'emit')}),
    model: {
      REPORT: {
        STATE: (s: any, r: any, _n: any, _p: any, o: any) => {
          const h0 = hash(r.code), root = rootOf(h0, s), st = s.status[root]
          // a repaired chain whose code now boots is fixed
          if (r.kind == 'ready') return h0 !== root && st == 'patched' ? {...s, status: {...s.status, [root]: 'fixed'}} : ABORT
          if (st == 'repairing' || st == 'gave-up') return ABORT
          // a report about code that already has a fix is stale: the part re-renders with the fix
          if (s.patches[h0]) return ABORT
          const n = s.attempts[root] || 0
          const entry = {node: r.node, root, attempt: n + 1, kind: r.kind, reason: r.error?.reason ?? r.error?.type, message: String(r.error?.message ?? r.error?.reason ?? '').slice(0, 300)}
          if (n >= (o.maxAttempts ?? 2)) return {...s, status: {...s.status, [root]: 'gave-up'}, log: [...s.log, {...entry, gaveUp: true}]}
          return {...s, attempts: {...s.attempts, [root]: n + 1}, status: {...s.status, [root]: 'repairing'}, pending: {...s.pending, [h0]: root}, log: [...s.log, entry]}
        },
        [decl.sink ?? 'LLM']: (s: any, r: any, _n: any, p: any, o: any, k: string) => {
          if (r.kind == 'ready') return ABORT
          const h0 = hash(r.code), root = rootOf(h0, s)
          const before = p?.previousState?.[k]
          // only the report that started this repair (STATE moved its chain to 'repairing')
          if (s.status[root] != 'repairing' || before?.status?.[root] == 'repairing' || s.pending?.[h0] !== root) return ABORT
          return {
            key: 'fix:' + h0, latest: true, parse: false,
            ...(o.model && {model: o.model}),
            instructions: REPAIR,
            messages: [{role: 'user', content: `Code:\n${r.code}\n\nWhat went wrong: ${describe(r)}`}],
            output: jsonSchema({type: 'object', properties: {code: {type: 'string', maxLength: maxCode}}, required: ['code'], additionalProperties: false}),
            ok: k + '.REPLY', error: k + '.FAILED',
          }
        },
      },
      REPLY: (s: any, reply: any) => {
        const h0 = String(reply?.key ?? '').replace(/^fix:/, ''), root = s.pending?.[h0]
        if (!root) return ABORT
        const code = codeOf(reply?.text)
        const {[h0]: _, ...pending} = s.pending
        if (!code || hash(code) === h0) return {...s, pending, status: {...s.status, [root]: 'gave-up'}}
        return {...s, pending, patches: {...s.patches, [h0]: code}, parents: {...s.parents, [hash(code)]: h0}, status: {...s.status, [root]: 'patched'}}
      },
      FAILED: (s: any, e: any) => {
        const h0 = String(e?.key ?? '').replace(/^fix:/, ''), root = s.pending?.[h0]
        if (!root) return ABORT
        const {[h0]: _, ...pending} = s.pending
        return {...s, pending, status: {...s.status, [root]: 'gave-up'}}
      },
    },
  })

  return {id, part, card, Host: GeneratedHost, instructions, repairInstructions: REPAIR, events, repair, schemas, repairKey}
}
