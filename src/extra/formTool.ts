/*
 * PLAN-6 A-3 (D241: experimental, outside semver until WebMCP's origin trial ends; D269, D270,
 * D291, G-598, G-602, G-603): `form(schema, { …, tool: formTool({ name, description, autosubmit }) })`
 * offers the form to the browser's agent as a declarative WebMCP tool (Chrome 153 with
 * `--enable-features=WebMCP`, or a polyfill).
 *
 * D291 (pay per use, as D285): `formTool` is exported from 'sygnal/ai' (and 'sygnal'); the form
 * behavior never imports this module, it only calls the `$(behavior, result)` hook of the object it
 * is given (`$`; a plain object as `tool` is SYG245 from the dev entry, and ignored). An app that uses
 * `form` without `formTool` carries none of this.
 *
 * Attributes. WebMCP reads attributes, and the pragma sends an unknown JSX key (`toolname`) to
 * props (G-598), so the behavior writes them itself into the vnode's `attrs` (what `attrs-toolname`
 * in JSX would give; 0 core bytes, D269): a post-processor of the core's registry (`posts.form`,
 * registered by the first `form()` with a `tool`) runs on the rendered vnode of each instance
 * whose template has a `<form>`, and for a host with a tool `form` use it copies (never mutates:
 * the vnodes may be cached) the matching `<form>` with `toolname` / `tooldescription` /
 * `toolautosubmit`, and each named field inside it (children's vnodes included) with
 * `toolparamdescription` from its wrapping `<label>`, a `<label for>` in the host's vnode, then
 * its `aria-label` (G-603: Chrome reads labels but not `aria-label`). Attributes the view writes
 * itself (`attrs-toolname`, `attrs-toolparamdescription`) win.
 *
 * Submit. An agent's submit (`SubmitEvent.agentInvoked`) is the form's usual SUBMIT (the same
 * validation, checks and async schema); in the submit listener (the intent's map runs inside the
 * DOM driver's delegated listener, after its preventDefault) the behavior calls
 * `event.respondWith(promise)`, and resolves the promise once the submit has an outcome and the
 * flush that renders it ran: `{ ok: true, values }` (the schema's output, what the host's submit
 * action got; a submit sent as a request waits for `form.DONE`) or `{ ok: false, errors }` (field
 * errors by name: schema, check and server errors; '' is form-level), `{ ok: false, error }` when
 * a submit is already running or the form went away first.
 * `autosubmit: false` (the default, D270): the agent's call fills the fields and stays pending
 * until the user submits (G-602); then the agent gets the same answer.
 * A user's submit is unchanged.
 */
import xs from './xstreamCompat'
import {posts} from '../core/registry'

export interface FormTool { name: string; description: string; autosubmit?: boolean }

const tagOf = (n: any) => n.sel.split(/[#.]/)[0].toLowerCase()
const at = (n: any, p: string, a = p) => n.data?.props?.[p] ?? n.data?.attrs?.[a]
const FIELD = /^(input|select|textarea|button)$/
const textOf = (n: any): string => n.text != null ? '' + n.text : n.sel && FIELD.test(tagOf(n)) ? '' : (n.children || []).map((c: any) => c ? textOf(c) : '').join('')
const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

// a simple selector (form, .signup, form#a.b) against a vnode; anything else matches every <form>
const matches = (n: any, s: string) => {
  const m = /^([a-z][\w-]*)?((?:[#.][\w-]+)*)$/i.exec(s)
  if (!m) return true
  if (m[1] && m[1].toLowerCase() != 'form') return false
  const d = n.data || {}, own = new Set(n.sel.split(/(?=[#.])/).slice(1))
  ;`${at(n, 'className', 'class') || ''}`.split(/\s+/).forEach(c => c && own.add('.' + c))
  for (const c in d.class) d.class[c] && own.add('.' + c)
  const id = at(n, 'id')
  id && own.add('#' + id)
  return (m[2].match(/[#.][\w-]+/g) || []).every(p => own.has(p))
}

const withAttrs = (n: any, a: any) => ({...n, data: {...n.data, attrs: {...a, ...n.data?.attrs}}})

/** posts.form: the tool attributes on a host's `<form>` and its named fields */
const post = (v: any, inst: any) => {
  const uses = inst.def?.view?.uses, tools: any[] = []
  for (const k in uses) uses[k]?.$tool && tools.push(uses[k].$tool)
  if (!tools.length) return v
  // <label for=id> anywhere in the host's vnode
  const labels: any = {}
  const scan = (n: any) => {
    if (!n) return
    if (n.sel && tagOf(n) == 'label') { const f = at(n, 'htmlFor', 'for'); f && (labels[f] = clean(textOf(n))) }
    n.children?.forEach(scan)
  }
  scan(v)
  const rw = (n: any, t: any, label: string): any => {
    // a fragment (no sel: a Collection's items) is walked through
    if (!n?.sel && !n?.children) return n
    const g = n.sel ? tagOf(n) : ''
    let a: any = null
    if (g == 'form' && !t) {
      const x = tools.find(([, sel]) => matches(n, sel))
      if (x) t = x[0], a = {toolname: t.name, tooldescription: t.description, ...(t.autosubmit && {toolautosubmit: ''})}
    } else if (t) {
      if (g == 'label') label = clean(textOf(n))
      else if ((/^(input|select|textarea)$/.test(g) || /-/.test(g)) && at(n, 'name')) {
        const d = label || labels[at(n, 'id')] || n.data?.attrs?.['aria-label']
        d && (a = {toolparamdescription: d})
      }
    }
    const c = n.children
    let o = c
    if (c) for (let i = 0; i < c.length; i++) {
      const y = rw(c[i], t, label)
      if (y !== c[i]) (o === c ? o = c.slice() : o)[i] = y
    }
    if (o !== c) n = {...n, children: o}
    return a ? withAttrs(n, a) : n
  }
  return rw(v, null, '')
}

/**
 * The submit stream wrapped so an agent's submit gets its answer (`result(values)`: the schema's
 * result for values, the form's own cached one)
 */
const answering = (sub: any, STATE: any, result: (vals: any) => any) => {
  let cur: any, pend: any, l: any
  // after the host's submit action (the form dispatches it with next(submit, data, 0): a
  // timer set before this one) and the flush that renders it
  const answer = (x: any) => { const p = pend; pend = null; p && Promise.resolve(x).then(y => setTimeout(p, 0, y)) }
  const watch = (s: any) => {
    cur = s
    if (!pend || !s || s.submitCount <= pend.c || s.queued || s.validating || s.submitting) return
    const errors: any = {}
    for (const m of [s.server, s.remote, s.errors]) for (const k in m) m[k] && !(k in errors) && (errors[k] = m[k])
    answer(Object.keys(errors).length ? {ok: false, errors} : Promise.resolve(result(s.values)).then(r => ({ok: true, values: r.value})))
  }
  const agent = (e: any) => {
    if (!e?.agentInvoked || typeof e.respondWith != 'function') return e
    let r: any
    try { e.respondWith(new Promise(x => r = x)) } catch (_) { return e }
    // a submit already running: the form drops this one (SYG232), the running call stays
    if (cur?.submitting || cur?.queued) r({ok: false, error: 'A submit is already running'})
    else answer({ok: false, error: 'Replaced by a later submit'}), pend = r, pend.c = cur?.submitCount || 0
    return e
  }
  // the slice, watched while the intent runs (a stream that never emits); a pending call is
  // answered when the host stops
  const w = xs.create({
    start: () => STATE?.stream.addListener(l = {next: watch, error: () => {}, complete: () => {}}),
    stop: () => { STATE?.stream.removeListener(l); answer({ok: false, error: 'The form was removed'}) },
  })
  return xs.merge(sub.map(agent), w)
}

/**
 * formTool({ name, description, autosubmit? }): the `tool` option of `form()`. form() calls its
 * `$(behavior, result)` hook once, with the behavior it made and its schema result function: the
 * hook registers the post-processor, marks the behavior for it (`$tool`: the spec and the form
 * selector, read from the host's `uses`) and wraps the behavior's intent so SUBMIT answers agents.
 */
export const formTool = (tool: FormTool) => ({...tool, $: (b: any, result: (vals: any) => any) => {
  posts.form = post
  b.$tool = [tool, b.options?.form || 'form']
  const intent = b.intent
  b.intent = (so: any, ...x: any[]) => {
    const i = intent(so, ...x)
    i.SUBMIT = answering(i.SUBMIT, so.STATE, result)
    return i
  }
}})
