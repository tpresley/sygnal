/*
 * PLAN-6 M-3: the `commandBar` behavior, "do one thing in this app" from one line of text, on a
 * decision model instead of a chat model (Experiment 5: 8/8 with local `nimble`, ~570 ms).
 *
 *   TodoApp.uses = { cmd: commandBar({ input: '.command', decide: { url: '/api/decide', model: 'jev-latest' },
 *     below: 0.6, escalate: 'assistant', approve: '.cmd-approve', deny: '.cmd-deny' }) }
 *
 * Slice (state.cmd): { text, status, command, pending, unsure, result, error }
 * - text: the input's value (cleared when a command ran);
 * - status: 'ready' | 'deciding' (the decision request is out) | 'running' (the action runs, or
 *   waits for APPROVE / DENY) | 'error' (the decision request failed: `error`);
 * - command: the command being handled (null when ready);
 * - pending: the confirm info (AgentConfirmInfo) of a consequential action, else null;
 * - unsure: why the last command wasn't run, for the view: `{ command, reason, tool, description,
 *   target, label, confidence }` with reason 'confidence' (below `below`), 'no-action' (the model
 *   picked "none of these"), 'target' (an item action without a clear item) or 'input' (the
 *   action needs an argument the bar can't fill); null otherwise. With `escalate` the command
 *   goes to the chat behavior instead (`result.escalated`);
 * - result: the last outcome, `{ command, tool, input, ...AgentResult }` (ok, error, state, ...),
 *   or `{ command, escalated: '<chat key>', reason, confidence }`; error: the last failure, else null.
 *
 * Actions ('cmd.X'): RUN (the input's Enter, or the form's submit; a string as data runs that
 * command), APPROVE, DENY, DONE (a command ran: the result; a host entry 'cmd.DONE' runs after it).
 * Internal: INPUT (typing), DECIDED / FAILED (the fetch driver's reply actions), ASK.
 *
 * One decision request per command (through the app's fetch driver, `decide()`), two questions:
 * - action: a `choice` over the host's and its shown descendants' `agent` actions (D249; `agent:
 *   [Comp, …]` narrows), keyed by tool name, described by the action's description, plus
 *   `none` ("none of these"). An action whose input is one enum (or boolean) field becomes one
 *   option per value (`todos_set_filter=done`), so the model picks the argument too;
 * - target (only when an item action exists): a `choice` over the live Collection item keys,
 *   described by `agent.label` (D258), plus `none`.
 * The decision `state` is `{ command, app }`, `app` being the `read` projections (A-1's context).
 * Then the call runs through A-1's `call()` (validation, repair, no-op detection, cause 'agent',
 * `confirm` → `pending` for a consequential action).
 *
 * Free text arguments (ADD's text): a decision model only picks among options, so the text is
 * taken from the command by a heuristic, documented as one: a quoted part ("…", '…', “…”) if
 * there is one, else the command minus its first word ("add walk the dog" → "walk the dog"). It is
 * validated like any agent input. `freeText: (command, tool) => string | undefined` replaces it;
 * undefined means "can't tell": the command is escalated (or `unsure`, reason 'input'). Actions with
 * other inputs (numbers, several fields) are offered too, and escalated / unsure when picked: a
 * chat model fills arguments, a decision model doesn't.
 *
 * It reaches the runtime through the shared link (./link.ts, D283), as `chat` does.
 */
import {defineBehavior} from '../behaviors'
import {ABORT} from '../../shared'
import {agentTools} from './agent/index'
import {decide as decideRequest} from './decide'
import {linked, engineOf, checkLinked} from './link'

interface Opt {tool: string; args?: any; free?: string; needs?: 1; description: string}
interface Asked {command: string; opts: Map<string, Opt>; targets: Map<string, {name: string; id: any; label?: string}>; items: Map<string, {key: string; name: string}>}
interface Engine {api: any; iv: any; k: string; o: any; tools?: any; asked?: Asked; turn: number; answer?: (ok: boolean) => void; stop(): void}

const engineFor = (props: any, k: string, o: any): Engine | undefined => engineOf<Engine>(props, k, (api, iv) => {
  const en: Engine = {api, iv, k, o, turn: 0, stop() { en.turn++; en.answer?.(false); en.tools?.stop() }}
  return en
})
const dispatch = (e: Engine, type: string, data: any, cause: string) => e.api.dispatch(e.iv.id, e.k + '.' + type, data, cause)

const toolsOf = (e: Engine) => e.tools ||= agentTools(e.api, {
  from: e.iv.id,
  ...(Array.isArray(e.o.agent) && {components: e.o.agent}),
  confirm: (info: any) => new Promise<boolean>(resolve => {
    const turn = e.turn
    e.answer = ok => { e.answer = undefined; resolve(ok) }
    turn === e.turn ? dispatch(e, 'ASK', info, 'reply') : e.answer(false)
  }),
})

/** the documented heuristic: a quoted part, else the command minus its first word */
export const freeText = (command: string): string | undefined => {
  const q = /"([^"]+)"|“([^”]+)”|'([^']+)'/.exec(command)
  const t = q ? q[1] ?? q[2] ?? q[3] : command.trim().replace(/^\S+\s*/, '')
  return t.trim() || undefined
}

/** the questions for `command` over the live tools; `e.asked` maps the answers back */
function ask(e: Engine, command: string) {
  const t = toolsOf(e), opts = new Map<string, Opt>(), items = new Map<string, {key: string; name: string}>()
  const groups = new Map<string, string>()
  for (const g of t.groups()) for (const n of g.tools) groups.set(n, g.name)
  const targets = t.targets()
  const itemNames = new Set(targets.map((x: any) => x.name))
  for (const tool of t.list()) {
    if (tool.annotations.readOnlyHint) continue
    const s = tool.inputSchema || {}, name = groups.get(tool.name) || ''
    const props = {...s.properties}, req = new Set<string>(s.required || [])
    if (itemNames.has(name) && s.required?.[0] && props[s.required[0]]?.enum) {
      const key = s.required[0]
      items.set(tool.name, {key, name})
      delete props[key]
      req.delete(key)
    }
    const fields = Object.keys(props), base = {tool: tool.name, description: tool.description}
    const f = fields.length == 1 ? fields[0] : '', p = f && props[f]
    // one option per value: an enum, a boolean, or `anyOf` consts (described literals: their own descriptions)
    const values: any[] | null = !p ? null : Array.isArray(p.enum) ? p.enum.map((v: any) => [v]) : p.type == 'boolean' ? [[true], [false]]
      : Array.isArray(p.anyOf) && p.anyOf.every((x: any) => x && 'const' in x) ? p.anyOf.map((x: any) => [x.const, x.description]) : null
    if (!fields.length || (!req.size && !values)) opts.set(tool.name, {...base, args: {}})
    else if (values) for (const [v, d] of values) opts.set(`${tool.name}=${v}`, {...base, args: {[f]: v}, description: d || `${tool.description}: ${v}`})
    else if (p && p.type == 'string') opts.set(tool.name, {...base, free: f})
    else opts.set(tool.name, {...base, needs: 1})
  }
  const many = new Set(targets.map((x: any) => x.name)).size > 1, tmap = new Map<string, any>()
  for (const x of targets) tmap.set(many ? `${x.name} ${x.id}` : String(x.id), x)
  const kinds = [...new Set(targets.map((x: any) => x.name))]
  const questions: any = {
    action: {type: 'choice', instructions: 'Which app action does the command ask for?',
      criteria: {...Object.fromEntries([...opts].map(([k, v]) => [k, v.description])), none: 'None of these actions'}},
  }
  if (items.size && tmap.size) {
    const what = kinds.length == 1 ? kinds[0] : 'item'
    questions.target = {type: 'choice', instructions: `Which existing ${what} does the command refer to (none if it names no existing ${what})?`,
      criteria: {none: `No existing ${what}`, ...Object.fromEntries([...tmap].map(([k, x]) => [k, x.label ?? `${x.name} ${x.id}`]))}}
  }
  e.asked = {command, opts, targets: tmap, items}
  const ctx = t.context()
  return {questions, state: Object.keys(ctx).length ? {command, app: ctx} : {command}}
}

/** one step's outcome per (slice, data): STATE and the sink / EFFECT of an action read the same one */
const memo = (f: (s: any, d: any, e?: Engine) => any) => {
  let l: any[] = []
  return (s: any, d: any, e?: Engine) => l[0] === s && l[1] === d && l[2] === e ? l[3] : (l = [s, d, e, f(s, d, e)])[3]
}
const busy = (s: any) => s.status == 'deciding' || s.status == 'running'
const commandOf = (s: any, d: any) => (typeof d == 'string' ? d : s.text).trim()

const runStep = /*#__PURE__*/ memo((s, d, e) => {
  const command = commandOf(s, d)
  if (busy(s) || !command) return
  const next = {...s, status: 'deciding', command, unsure: null, error: null, pending: null}
  if (!e) return {s: {...next, status: 'error', command: null, error: 'the command bar is not connected to its app (SYG442)'}}
  e.turn++
  return {s: next, ...ask(e, command)}
})

/** what a decision means: run a tool, or why not */
const planStep = /*#__PURE__*/ memo((s, d, e) => {
  const asked = e?.asked
  if (s.status != 'deciding' || !asked || asked.command !== s.command) return
  const o = e!.o, below = o.below ?? 0.6, command = asked.command
  const a = d?.answers?.action, tg = d?.answers?.target
  const opt = a && asked.opts.get(a.choice)
  const item = opt && asked.items.get(opt.tool)
  const target = item && tg && asked.targets.get(tg.choice)
  let reason: string | undefined, args: any
  if (!opt) reason = 'no-action'
  else if (!(a.confidence >= below)) reason = 'confidence'
  else if (item && (!target || target.name !== item.name || !(tg.confidence >= below))) reason = 'target'
  else if (opt.needs) reason = 'input'
  else if (opt.free) {
    const x = o.freeText ? o.freeText(command, opt.tool) : freeText(command)
    if (typeof x != 'string' || !x) reason = 'input'
    else args = {[opt.free]: x}
  } else args = opt.args
  const why = {tool: opt?.tool ?? null, description: opt?.description ?? null, target: target?.id ?? null, label: target?.label ?? null,
    confidence: reason == 'target' ? tg?.confidence ?? 0 : a?.confidence ?? 0}
  if (reason) {
    return o.escalate
      ? {s: {...s, status: 'ready', command: null, result: {command, escalated: o.escalate, reason, ...why}}, escalate: command}
      : {s: {...s, status: 'ready', command: null, unsure: {command, reason, ...why}}}
  }
  if (item) args = {...args, [item.key]: target!.id}
  return {s: {...s, status: 'running'}, call: {tool: opt.tool, input: args}}
})

async function runCall(e: Engine, command: string, c: {tool: string; input: any}) {
  const turn = e.turn
  let r: any
  try { r = await toolsOf(e).call(c.tool, c.input) } catch (err: any) { r = {ok: false, error: String(err?.message ?? err)} }
  if (turn === e.turn) dispatch(e, 'DONE', {command, ...c, ...r}, 'reply')
}

/**
 * The command bar behavior (PLAN-6 M-3): `uses = { cmd: commandBar({ input, form, decide, below,
 * escalate, agent, sink, approve, deny, freeText }) }`. Types: src/ai.d.ts.
 */
export const commandBar = (options: any = {}): any => {
  const {sink = 'HTTP', input, form, approve, deny} = options
  const on = (DOM: any, sel: any, ev = 'click', o?: any) => DOM.select(sel).events(ev, o)
  const E = engineFor
  const b = defineBehavior({
    initialState: {text: '', status: 'ready', command: null, pending: null, unsure: null, result: null, error: null},
    intent: (so: any) => {
      const {DOM} = so
      checkLinked(so, 'commandBar', 'it runs no commands')
      return {
        ...(input && {INPUT: on(DOM, input, 'input').map((ev: any) => ev.target.value)}),
        // Enter in the field runs it (a form's submit instead when `form` is given)
        ...(form ? {RUN: on(DOM, form, 'submit', {preventDefault: true})}
          : input && {RUN: on(DOM, input, 'keydown').filter((ev: any) => ev.key === 'Enter' && !ev.isComposing).map((ev: any) => { ev.preventDefault?.(); return typeof ev.target?.value == 'string' ? ev.target.value : undefined })}),
        ...(approve && {APPROVE: on(DOM, approve)}),
        ...(deny && {DENY: on(DOM, deny)}),
      }
    },
    model: {
      INPUT: (s: any, v: any) => typeof v == 'string' && v !== s.text ? {...s, text: v} : ABORT,
      RUN: {
        STATE: (s: any, d: any, _n: any, p: any, o: any, k: string) => runStep(s, d, E(p, k, o))?.s || ABORT,
        [sink]: (s: any, d: any, _n: any, p: any, o: any, k: string) => {
          const r = runStep(s, d, E(p, k, o))
          if (!r?.questions) return ABORT
          const keys = {ok: k + '.DECIDED', error: k + '.FAILED'}
          return typeof o.decide == 'function' ? {...o.decide({state: r.state, questions: r.questions}), ...keys}
            : decideRequest({...o.decide, state: r.state, questions: r.questions, ...keys})
        },
      },
      DECIDED: {
        STATE: (s: any, d: any, _n: any, p: any, o: any, k: string) => planStep(s, d, E(p, k, o))?.s || ABORT,
        EFFECT: (s: any, d: any, next: any, p: any, o: any, k: string) => {
          const e = E(p, k, o), r = planStep(s, d, e)
          if (r?.call) void runCall(e!, s.command, r.call)
          else if (r?.escalate) next(o.escalate + '.SEND', r.escalate)
        },
      },
      FAILED: (s: any, d: any) => s.status == 'deciding' ? {...s, status: 'error', command: null, error: d?.error?.message ?? String(d?.error ?? 'error')} : ABORT,
      ASK: (s: any, info: any) => ({...s, pending: info}),
      APPROVE: {
        STATE: (s: any) => s.pending ? {...s, pending: null} : ABORT,
        EFFECT: (_s: any, _d: any, _n: any, p: any, o: any, k: string) => { E(p, k, o)?.answer?.(true) },
      },
      DENY: {
        STATE: (s: any) => s.pending ? {...s, pending: null} : ABORT,
        EFFECT: (_s: any, _d: any, _n: any, p: any, o: any, k: string) => { E(p, k, o)?.answer?.(false) },
      },
      // a command ran (or was refused): the result; the input is cleared when it was this command
      DONE: (s: any, d: any) => s.status != 'running' ? ABORT
        : {...s, status: 'ready', command: null, pending: null, result: d, text: d?.ok && s.text.trim() === d.command ? '' : s.text},
    },
  })(options)
  return linked(b)
}
