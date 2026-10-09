/*
 * PLAN-6 L-3: the `chat` behavior, an in-app assistant that operates its host through the A-1
 * agent layer.
 *
 *   TodoApp.uses = { assistant: chat({ sink: 'LLM', form: '.ask', prompt: '.prompt', stop: '.stop',
 *     approve: '.approve', deny: '.deny', instructions: 'You manage this todo list.' }) }
 *
 * Slice (state.assistant): { messages, prompt, draft, status, pending, error }
 * - messages: AI SDK UIMessages (D252): the user's, and the model's replies with their
 *   `tool-<name>` parts (`output-available` with the A-1 result once the tool ran);
 * - draft: the text of the reply being streamed ('' otherwise);
 * - status: 'ready' | 'submitted' (sent, nothing received yet) | 'streaming' (receiving, or running
 *   the tools of a reply) | 'error';
 * - pending: the confirm info (AgentConfirmInfo) of a consequential tool call waiting for
 *   APPROVE / DENY, else null; error: the last failure's message, else null.
 *
 * Actions ('assistant.X'): SEND (the form's submit: the prompt; or a string as data), STOP (aborts
 * the stream, keeps the partial text), REGENERATE (replays the last user turn), APPROVE, DENY,
 * DONE (the turn is over: `{ message, text, finishReason, usage, steps }`; a host entry
 * 'assistant.DONE' runs after it, like 'form.DONE'). Internal: PROMPT (typing), DELTA / REPLY /
 * FAILED (the chat driver's reply actions), ASK (a consequential call waits), RESULTS (the tool
 * results of a reply). Selectors are the host's own: the markup is part of the host's view (SYG104).
 *
 * The tool loop: each request carries the tools of the host's `agent` declaration and its shown
 * descendants' (D249; `agent: false` none, `agent: [Comp, ...]` only those), as `{ name:
 * { description, inputSchema } }`, and their `read` projections as JSON after `instructions`. A
 * reply with tool calls runs them through A-1's `call()` (validation, repair, no-op detection,
 * cause 'agent', one at a time); a consequential one sets `pending` and waits for APPROVE / DENY;
 * the results go back as tool parts and the next request is sent, until a reply without tool calls
 * or `maxSteps` requests (default 8: the calls of a reply past it are closed as not run). A turn
 * stopped, failed or replaced closes its open tool parts too (providers need a result per call).
 *
 * How it reaches the runtime (0 core bytes): A-1 needs the app's runtime API and the host
 * instance, which a behavior's handlers don't get. The first chat() call adds a hook-layer
 * factory to the core bridge's `layers` (`globalThis.__SYGNAL_DIAGNOSTICS__.layers`, which every
 * App reads when it is constructed, as the dev entries do), so each app made after it hands the
 * layer its runtime API. The layer's onAction (called synchronously right before an action's
 * handlers) records the instance and its pre-action state; a chat handler takes them when its
 * `props.state` is that state (an app made before the first chat() call, e.g. a host loaded
 * lazily into a running app, never has a match: its host is reported as SYG442 and runs without
 * tools). Per (host instance, uses key) an engine holds the agentTools set (`from`: the host),
 * the step count, the turn (stale tool results are dropped) and the confirm resolver; the
 * layer's onDispose stops it. The engine dispatches RESULTS / ASK (cause 'reply') and DONE
 * ('next') to the host through the runtime API.
 */
import {defineBehavior} from '../../behaviors'
import {ABORT} from '../../../shared'
import {agentTools} from '../agent/index'
import {error as logError} from '../../diagnostics/legacy'

const G: any = globalThis
const CHAT = Symbol.for('sygnal.chat')

interface Ctx {api: any; iv: any; pre: any}
interface Engine {api: any; iv: any; k: string; o: any; tools?: any; turn: number; steps: number; answer?: (ok: boolean) => void; stop(): void}

/** the instance whose action is being handled (set by the layer's onAction; one object per app) */
let cur: Ctx | undefined
const engines = new WeakMap<any, Map<string, Engine>>()
/** the dispose$ of each chat host an app with the layer created (SYG442 otherwise) */
const known = new WeakSet<any>()
const isHost = (iv: any) => {
  const u = iv.def.view.uses
  for (const k in u) if (u[k]?.[CHAT]) return true
  return false
}

const layer = (api: any) => {
  const c: Ctx = {api, iv: null, pre: null}
  return {
    onCreate: (iv: any) => { if (isHost(iv)) known.add(iv.sources.dispose$) },
    onAction: (iv: any) => { c.iv = iv; c.pre = iv.state; cur = c },
    onDispose: (iv: any) => { engines.get(iv)?.forEach(e => e.stop()) },
  }
}
const install = () => {
  const D = G.__SYGNAL_DIAGNOSTICS__ ||= {}, L = D.layers ||= new Set()
  if (L.add) L.add(layer)
  else if (!L.includes(layer)) L.push(layer)
}

/** the engine of the host whose action runs now (undefined when the app has no layer) */
function engineOf(props: any, k: string, o: any): Engine | undefined {
  const c = cur
  if (!c || !props || props.state !== c.pre || c.iv.disposed) return
  const iv = c.iv
  let m = engines.get(iv)
  if (!m) engines.set(iv, m = new Map())
  let e = m.get(k)
  if (!e) {
    const en: Engine = e = {api: c.api, iv, k, o, turn: 0, steps: 0, stop() { en.turn++; en.answer?.(false); en.tools?.stop() }}
    m.set(k, en)
  }
  return e
}
const dispatch = (e: Engine, type: string, data: any, cause: string) => e.api.dispatch(e.iv.id, e.k + '.' + type, data, cause)

const toolsOf = (e: Engine) => e.o.agent === false ? null : e.tools ||= agentTools(e.api, {
  from: e.iv.id,
  ...(Array.isArray(e.o.agent) && {components: e.o.agent}),
  // a consequential call: `pending` until APPROVE / DENY (STOP and dispose decline)
  confirm: (info: any) => new Promise<boolean>(resolve => {
    const turn = e.turn
    e.answer = ok => { e.answer = undefined; resolve(ok) }
    turn === e.turn ? dispatch(e, 'ASK', info, 'reply') : e.answer(false)
  }),
})

// ------------------------------------------------------------------ messages
const isTool = (p: any) => typeof p?.type == 'string' && p.type.startsWith('tool-')
const openCalls = (m: any): any[] => (m?.parts || []).filter((p: any) => isTool(p) && p.state == 'input-available')
/** the last message with its open tool parts closed (a turn stopped, failed or capped) */
const closeOpen = (msgs: any[], why: string) => {
  const m = msgs[msgs.length - 1]
  if (!openCalls(m).length) return msgs
  return [...msgs.slice(0, -1), {...m, parts: m.parts.map((p: any) => isTool(p) && p.state == 'input-available' ? {...p, state: 'output-error', errorText: why} : p)}]
}
const user = (text: string) => ({role: 'user', parts: [{type: 'text', text}]})
const busy = (s: any) => s.status == 'submitted' || s.status == 'streaming'
const lastUser = (msgs: any[]) => { for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role == 'user') return i; return -1 }

/** one step's outcome per (slice, data): STATE and the LLM sink of an action read the same one */
const memo = (f: (s: any, d: any, e?: Engine) => any) => {
  let l: any[] = []
  return (s: any, d: any, e?: Engine) => l[0] === s && l[1] === d && l[2] === e ? l[3] : (l = [s, d, e, f(s, d, e)])[3]
}

const textOf = (d: any) => typeof d == 'string' ? d : d && typeof d == 'object' && typeof d.text == 'string' && !('target' in d) ? d.text : undefined
const sendStep = memo((s, d) => {
  const given = textOf(d), text = given ?? s.prompt
  if (busy(s) || typeof text != 'string' || !text.trim()) return
  return {...s, messages: [...closeOpen(s.messages, 'not run: a new message was sent'), user(text)], prompt: given === undefined ? '' : s.prompt, draft: '', status: 'submitted', error: null, pending: null}
})
const regenStep = memo(s => {
  const i = lastUser(s.messages)
  if (busy(s) || i < 0) return
  return {...s, messages: s.messages.slice(0, i + 1), draft: '', status: 'submitted', error: null, pending: null}
})
// a reply: run its open tool calls (status stays streaming), or the turn is over (DONE). Past
// maxSteps the open calls are closed as not run
const replyStep = memo((s, d, e) => {
  const m = d?.message
  if (!m) return
  const calls = openCalls(m), run = calls.length > 0 && !!e && e.steps < (e.o.maxSteps ?? 8)
  const msg = calls.length && !run ? closeOpen([m], `not run: the step limit (maxSteps ${e?.o.maxSteps ?? 8}) was reached`)[0] : m
  return {s: {...s, messages: [...s.messages, msg], draft: '', status: run ? 'streaming' : 'ready'}, calls: run ? calls : null, msg}
})
const resultsStep = memo((s, d, e) => {
  if (!e || d?.turn !== e.turn) return
  const out = new Map(d.results.map((r: any) => [r.id, r]))
  const msgs = s.messages.map((m: any) => m.role == 'assistant' && m.parts?.some((p: any) => out.has(p.toolCallId)) ? {...m, parts: m.parts.map((p: any) => {
    const r: any = isTool(p) && p.state == 'input-available' && out.get(p.toolCallId)
    return !r ? p : 'error' in r ? {...p, state: 'output-error', errorText: r.error} : {...p, state: 'output-available', output: r.output}
  })} : m)
  return {...s, messages: msgs, status: 'submitted'}
})

/** the request for the conversation `messages`: tools and read context of now; `fresh`: a new turn */
function request(e: Engine | undefined, o: any, k: string, messages: any[], fresh: boolean) {
  const t = e && toolsOf(e)
  if (e) {
    if (fresh) { e.turn++; e.steps = 0; e.answer?.(false) }
    e.steps++
  }
  const list = t ? t.list() : [], ctx = t ? t.context() : {}
  const instructions = [o.instructions, Object.keys(ctx).length && "The app's current state (JSON):\n" + JSON.stringify(ctx)].filter(Boolean).join('\n\n')
  return {
    ...o.transportOptions,
    messages,
    ...(instructions && {instructions}),
    ...(list.length && {tools: Object.fromEntries(list.map((x: any) => [x.name, {description: x.description, inputSchema: x.inputSchema}]))}),
    ...(o.model && {model: o.model}),
    key: k, delta: k + '.DELTA', ok: k + '.REPLY', error: k + '.FAILED',
  }
}

/** run a reply's tool calls one at a time; RESULTS when all are done (dropped if the turn moved on) */
async function runTools(e: Engine, calls: any[]) {
  const turn = e.turn, t = toolsOf(e), results: any[] = []
  for (const p of calls) {
    let r: any
    try { r = t ? {output: await t.call(p.type.slice(5), p.input)} : {output: {ok: false, error: 'tools are off (agent: false)'}} } catch (err: any) { r = {error: String(err?.message ?? err)} }
    if (turn !== e.turn) return
    results.push({id: p.toolCallId, ...r})
  }
  dispatch(e, 'RESULTS', {turn, results}, 'reply')
}

let warned = 0
/**
 * The chat behavior (PLAN-6 L-3): `uses = { assistant: chat({ sink, form, prompt, stop, approve,
 * deny, instructions, model, agent, maxSteps, transportOptions }) }`. Types: src/ai.d.ts.
 */
export const chat = (options: any = {}): any => {
  install()
  const {sink = 'LLM', form, prompt, stop, approve, deny, regenerate} = options
  const on = (DOM: any, sel: any, ev = 'click', o?: any) => DOM.select(sel).events(ev, o)
  const E = (props: any, k: string, o: any) => engineOf(props, k, o)
  const b = defineBehavior({
    initialState: {messages: [], prompt: '', draft: '', status: 'ready', pending: null, error: null},
    intent: (so: any) => {
      const {DOM} = so
      // SYG442: an app made before the first chat() call has no layer: no tools, no loop
      if (!known.has(so.dispose$) && !warned++) logError('SYG442', 'chat', 'the chat behavior has no connection to its app (the app was started before the first chat() call): it sends no tools and runs no tool calls', 'Call chat() in a module imported before run(), not only in a component loaded later')
      return {
        ...(prompt && {PROMPT: on(DOM, prompt, 'input').map((ev: any) => ev.target.value)}),
        ...(form && {SEND: on(DOM, form, 'submit', {preventDefault: true})}),
        ...(stop && {STOP: on(DOM, stop)}),
        ...(approve && {APPROVE: on(DOM, approve)}),
        ...(deny && {DENY: on(DOM, deny)}),
        ...(regenerate && {REGENERATE: on(DOM, regenerate)}),
      }
    },
    model: {
      PROMPT: (s: any, p: any) => typeof p == 'string' && p !== s.prompt ? {...s, prompt: p} : ABORT,
      SEND: {
        STATE: (s: any, d: any) => sendStep(s, d) || ABORT,
        [sink]: (s: any, d: any, _n: any, p: any, o: any, k: string) => { const n = sendStep(s, d); return n ? request(E(p, k, o), o, k, n.messages, true) : ABORT },
      },
      REGENERATE: {
        STATE: (s: any) => regenStep(s, 0) || ABORT,
        [sink]: (s: any, _d: any, _n: any, p: any, o: any, k: string) => { const n = regenStep(s, 0); return n ? request(E(p, k, o), o, k, n.messages, true) : ABORT },
      },
      DELTA: (s: any, d: any) => ({...s, draft: d?.text ?? s.draft, status: 'streaming'}),
      REPLY: {
        STATE: (s: any, d: any, _n: any, p: any, o: any, k: string) => replyStep(s, d, E(p, k, o))?.s || ABORT,
        // the turn is over: DONE in the same flush (a host entry 'assistant.DONE' runs after it)
        EFFECT: (s: any, d: any, next: any, p: any, o: any, k: string) => {
          const e = E(p, k, o), r = replyStep(s, d, e)
          if (!r) return
          const done = {message: r.msg, text: d.text, finishReason: d.finishReason, usage: d.usage, steps: e?.steps ?? 1}
          if (r.calls) void runTools(e!, r.calls)
          else if (e) dispatch(e, 'DONE', done, 'next')
          else next('DONE', done, 0)
        },
      },
      RESULTS: {
        STATE: (s: any, d: any, _n: any, p: any, o: any, k: string) => resultsStep(s, d, E(p, k, o)) || ABORT,
        [sink]: (s: any, d: any, _n: any, p: any, o: any, k: string) => { const e = E(p, k, o), n = resultsStep(s, d, e); return n ? request(e, o, k, n.messages, false) : ABORT },
      },
      ASK: (s: any, info: any) => ({...s, pending: info}),
      APPROVE: {
        STATE: (s: any) => s.pending ? {...s, pending: null} : ABORT,
        EFFECT: (_s: any, _d: any, _n: any, p: any, o: any, k: string) => { E(p, k, o)?.answer?.(true) },
      },
      DENY: {
        STATE: (s: any) => s.pending ? {...s, pending: null} : ABORT,
        EFFECT: (_s: any, _d: any, _n: any, p: any, o: any, k: string) => { E(p, k, o)?.answer?.(false) },
      },
      STOP: {
        STATE: (s: any) => busy(s) ? {
          ...s, draft: '', status: 'ready', pending: null,
          messages: [...closeOpen(s.messages, 'not run: stopped by the user'), ...(s.draft ? [{role: 'assistant', parts: [{type: 'text', text: s.draft}]}] : [])],
        } : ABORT,
        [sink]: (s: any, _d: any, _n: any, _p: any, _o: any, k: string) => busy(s) ? {abort: k} : ABORT,
        // the turn moves on: a waiting confirm is declined, tool results still to come are dropped
        EFFECT: (s: any, _d: any, _n: any, p: any, o: any, k: string) => { const e = busy(s) && E(p, k, o); if (e) { e.turn++; e.answer?.(false) } },
      },
      FAILED: {
        STATE: (s: any, d: any) => ({...s, messages: closeOpen(s.messages, 'not run: the request failed'), draft: '', status: 'error', pending: null, error: d?.error?.message ?? String(d?.error ?? 'error')}),
        EFFECT: (_s: any, _d: any, _n: any, p: any, o: any, k: string) => { const e = E(p, k, o); if (e) { e.turn++; e.answer?.(false) } },
      },
      // (REPLY already set ready: a host entry gets the finished state)
      DONE: (s: any) => s.status == 'ready' ? ABORT : {...s, status: 'ready'},
    },
  })(options)
  // the `prompt` option is a selector, not the slice's start value (defineBehavior's option override)
  b.state = {...b.state, prompt: ''}
  b[CHAT] = true
  return b
}
