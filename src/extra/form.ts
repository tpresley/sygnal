/*
 * PLAN-5 F-1 (D193): the `form` behavior, the canonical form recipe.
 *
 *   Signup.uses = { form: form(signupSchema, {
 *     values: { email: '', password: '', addresses: [{ id: 1, street: '', city: '' }] },
 *     submit: 'SIGN_UP',             // the host action a valid submit dispatches (data: the schema's output)
 *     check: { email: { request: (email) => ({ url: '/api/email-free', query: { email } }), error: (body) => !body.free && 'Taken' } },
 *   }) }
 *
 * Fields are addressed by their `name=` attribute (the path in `values`; rows of an array by
 * id: `addresses.7.street`), heard on the form element (option `form`, default 'form'): input
 * and focusout bubble to it, also from fields rendered by Collection items. Nothing is wired per
 * field.
 *
 * Options: `values` (the start values; D239: or a function of the host's state, called when the
 * form starts), `submit` (host action), `check` (async per-field checks through a driver: a
 * request with a reply action, `latest`), `show` ('blur' default: a schema error shows once its
 * field was blurred; 'input'; 'submit'), `form` (selector), `http` (the driver sink of the
 * checks, 'HTTP'), `resetOnShow` (D239), `tool` (PLAN-6 A-3, experimental: the form as a declarative
 * WebMCP tool, formTool.ts).
 *
 * D239 (G-578): `resetOnShow: true` starts the form over (the start values, as a new form: touched,
 * errors, server errors, checks and the submit state cleared) each time it is shown: when its
 * host starts (VALIDATE: a component mounted again, a Switchable page made again for another
 * `instance`, a slice kept in the parent's state) and each time the form element appears again
 * in the host's DOM after being absent (a Switchable page shown again: hidden pages stay alive;
 * a form rendered conditionally). Re-renders while it is shown keep what the user typed. Off by
 * default: a wizard step keeps its values when the user comes back. Without a real DOM (the mock
 * DOM, SSR) only the host start counts. A `values` function is called with the host's state at
 * each start over (without resetOnShow: once, when the host starts with the slice untouched);
 * before that (a child's first render) the fields come from calling it with a blank state.
 *
 * Slice (state.form): values, initial, errors (all current schema errors by name), touched,
 * server (server errors), remote (async check results: '' passed), pending (name -> value being
 * checked), submitting, submitted, submitCount, queued (a submit waits for a check or an async
 * schema), validating (an async schema runs), validated (the schema has answered since the start
 * or the last reset); calculated: fields (per name: { name, value, error, invalid, touched,
 * dirty, pending }; `error` is what to show), valid (G-382: the last answer's, kept while an async
 * schema re-validates), dirty, error (form-level message).
 *
 * Actions: form.CHANGE ({ name, value, item? }: G-376: a checkbox gives `checked`, and `item`, its
 * value, which toggles membership when the field is an array; <select multiple> an array of the
 * selected values; type=file is ignored), form.BLUR (name), form.SUBMIT, form.ADD ({ field,
 * value }), form.REMOVE ({ field, id }), form.ERRORS (an error reply or a map: server errors),
 * form.DONE (saved), form.RESET (values?); internal: form.RESULT (an async schema's result),
 * form.CHECKED_<name> (a check's reply; a failed check passes: the server checks on submit),
 * form.VALIDATE (the first validation, when the host starts: G-375; `valid` is false until the
 * schema answered; with resetOnShow also each time the form element appears, D239).
 *
 * G-575 (D236): a valid submit is `submitting` (until form.DONE / form.ERRORS, a second submit
 * dropped) only when the host's submit entry has the `http` sink; any other submit (STATE, PARENT,
 * EVENTS, EFFECT, ...) sends no request and is done at once (submitted, as form.DONE would). A
 * slice kept in parent state from a host that unmounted mid-submit starts unstuck: VALIDATE (each
 * host start) clears submitting, queued and pending.
 *
 * Each action is one step function, `(slice, data, key) => outcome | null` (null: no change),
 * the outcome `{ s: new slice, focus: ELEMENT command, req: a check request, send: 1 (dispatch
 * submit), wait: { values, submit? } (an async schema to await) }`. Its sinks (STATE, EFFECT,
 * ELEMENT, and the checks' driver) read that outcome, computed once per (slice, data). D197:
 * the handlers get the `uses` key, which names the reply actions.
 *
 * Dev diagnostics (checks/forms.ts, through the core bridge's `form` hook; nothing in
 * production): SYG230 a field name not in values, SYG231 not a Standard Schema (throws), SYG232
 * a submit dropped, SYG233 a values key missing from the schema's output, SYG234 a submit that
 * dispatched one of the form's own actions (G-577), SYG235 a check request that sets reply
 * fields. The host checks (SYG234 submit, SYG235 check names, SYG236 row ids)
 * run when the host is created.
 */
import xs from './xstreamCompat'
import {defineBehavior} from './behaviors'
import {ABORT} from '../shared'
import {isStandardSchema} from './standardSchema'
import {checkForm, fieldNames, getField, hasField, setField, replyErrors, focusInvalid} from './formHelpers'
import {formTool} from './formTool'

const dev = (...a: any[]): any => (globalThis as any).__SYGNAL_DIAGNOSTICS__?.form?.(...a)
const keys = (o: any) => Object.keys(o).filter(k => o[k])
const drop = (o: any, p: string) => {
  const r: any = {}
  for (const k in o) if (k != p && !k.startsWith(p + '.')) r[k] = o[k]
  return r
}

export const form = (schema: any, o: any = {}): any => {
  isStandardSchema(schema) || dev(231, schema)
  const {values: vo = {}, submit, check: checks = {}, show = 'blur', http = 'HTTP', form: sel = 'form', resetOnShow: again, tool} = o
  // PLAN-6 A-3 (experimental, D241): a declarative WebMCP tool (formTool.ts)
  const ft = tool && formTool(tool, sel)
  // D239: `values` can be a function of the host's state, called when the form starts (and each
  // show, resetOnShow). Before that (the host's first render, before its first action) the
  // fields come from calling it with a blank state: every read gives '' in the result
  const fn = typeof vo == 'function', B: any = new Proxy(() => B, {get: (_, k) => k == Symbol.toPrimitive ? () => '' : B})
  const clean = (x: any): any => x === B ? '' : Array.isArray(x) ? x.map(clean) : x && typeof x == 'object' ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, clean(y)])) : x
  let values: any = vo
  if (fn) try { values = clean(vo(B)) } catch (_) { values = {} }
  const cache = new WeakMap(), checked = Object.keys(checks)
  // G-575: a submit is pending (until form.DONE / form.ERRORS) only when the host's submit entry
  // sends a request on the `http` sink; any other submit is done once its entry has run. Set when
  // the form merges into its host
  let req = true
  // the schema's result, once per values object; an async one replaces its Promise when it settles
  const v = (vals: any): any => {
    let r = cache.get(vals)
    if (!r) {
      cache.set(vals, r = checkForm(schema, vals))
      r.then?.((x: any) => cache.set(vals, x))
    }
    return r
  }
  // G-379: a field is a path of values (an undefined value too); `quiet`: no SYG230 (a focusout
  // from a named button)
  const known = (s: any, n: any, quiet?: any) => {
    const k = n && hasField(s.values, n)
    n && !k && !quiet && dev(230, n, s.values)
    return k
  }
  // new values: errors now (sync schema), or after the schema's Promise (RESULT)
  const edit = (s: any, vals: any, x?: any) => {
    const r = v(vals), a = !!r.then
    return {s: {...s, ...x, values: vals, validating: a, ...(!a && {errors: r.errors, validated: true})}, wait: a && {values: vals}}
  }
  // the first check due: no schema error, a value, and not checked or running for it
  const due = (s: any, only?: string) => checked.find(f => {
    const x = getField(s.values, f)
    return (!only || f == only) && !s.errors[f] && x !== '' && x != null && !(f in s.pending) && !(f in s.remote)
  })
  const ask = (s: any, f: string, k: string, queued: boolean) => {
    const x = getField(s.values, f), q = checks[f].request(x), ok = `${k}.CHECKED_${f}`
    dev(235, f, q)
    return {s: {...s, queued, pending: {...s.pending, [f]: x}}, req: {...q, ok, error: ok, latest: true}}
  }
  // a submit with s's errors: blocked (focus the first), a check to run or to wait for, or sent
  const attempt = (s: any, k: string) => {
    const bad = [...keys(s.errors), ...keys(s.remote)], f = due(s)
    return bad.length ? {s: {...s, queued: false}, focus: focusInvalid(bad, sel)}
      : f ? ask(s, f, k, true)
      : Object.keys(s.pending).length ? {s: {...s, queued: true}}
      : {s: req ? {...s, queued: false, submitting: true} : done({...s, queued: false}), send: 1}
  }
  const base = (vals: any) => ({initial: vals, values: vals, touched: {}, server: {}, remote: {}, pending: {},
    submitting: false, submitted: false, submitCount: 0, queued: false, errors: {}, validated: false})
  const fresh = (vals: any) => edit(base(vals), vals)
  const done = (s: any) => ({...s, submitting: false, submitted: true, initial: s.values, server: {}, touched: {}})
  const group = (cur: any, d: any) => {
    if (!Array.isArray(cur) || !('item' in d)) return d.value
    const r = cur.filter(x => x !== d.item)
    return d.value ? [...r, d.item] : r
  }

  const steps: Record<string, (s: any, d: any, k: string, h?: any) => any> = {
    // G-376: a checkbox (`item`: its value) on an array field is one of a group: checked adds
    // its value, unchecked removes it
    CHANGE: (s, d) => known(s, d?.name) ? edit(s, setField(s.values, d.name, group(getField(s.values, d.name), d)), {
      server: drop(drop(s.server, d.name), ''), remote: drop(s.remote, d.name), pending: drop(s.pending, d.name), queued: false,
      touched: show == 'input' ? {...s.touched, [d.name]: true} : s.touched,
    }) : null,
    BLUR: (s, n, k) => {
      if (!known(s, n, 1)) return null
      const t = show == 'submit' || s.touched[n] ? s.touched : {...s.touched, [n]: true}, x = {...s, touched: t}
      return due(s, n) ? ask(x, n, k, s.queued) : t != s.touched ? {s: x} : null
    },
    SUBMIT: (s, _, k) => {
      if (s.submitting || s.queued) return void dev(232, s)
      const n = {...s, submitCount: s.submitCount + 1}, r = v(s.values)
      // G-371: a submit waiting for an async schema is queued (a second one is dropped)
      return r.then ? {s: {...n, validating: true, queued: true}, wait: {values: s.values, submit: 1}} : attempt({...n, errors: r.errors}, k)
    },
    RESULT: (s, d, k) => {
      if (d.values !== s.values) return
      const n = {...s, errors: v(d.values).errors, validating: false, validated: true}
      // the submit it was queued for (G-575: a done local submit isn't `submitting`, so not that)
      return d.submit && s.queued ? attempt(n, k) : {s: n}
    },
    ADD: (s, {field, value}) => {
      const rows = getField(s.values, field) || []
      return edit(s, setField(s.values, field, [...rows, {id: rows.reduce((m: number, r: any) => Math.max(m, +r.id || 0), 0) + 1, ...value}]))
    },
    REMOVE: (s, {field, id}) => {
      const p = field + '.' + id
      return edit(s, setField(s.values, field, getField(s.values, field).filter((r: any) => r.id + '' != id)),
        {touched: drop(s.touched, p), server: drop(s.server, p)})
    },
    ERRORS: (s, d) => {
      const e = replyErrors(d, s.values)
      return {s: {...s, server: e, submitting: false, queued: false}, focus: focusInvalid(e, sel)}
    },
    DONE: (s) => ({s: done(s)}),
    RESET: (s, d) => fresh(d && typeof d == 'object' ? d : s.initial),
    // G-375: the first validation, when the host starts (form() doesn't validate at module load).
    // G-575: a slice kept in parent state from a host that unmounted mid-submit starts unstuck.
    // D239: with resetOnShow (also each time the form element appears again), or a `values`
    // function not called yet, the slice starts over from the start values (h: the host state)
    VALIDATE: (s, _, _k, h) => again || fn && s.values === values ? fresh(fn ? vo(h) : vo)
      : edit({...s, submitting: false, queued: false, pending: {}}, s.values),
  }
  // a check's reply (ok and error: an error reply carries an Error and passes)
  for (const f of checked) steps['CHECKED_' + f] = (s, d, k) => {
    if (!(f in s.pending)) return
    const n = {...s, pending: drop(s.pending, f), remote: {...s.remote, [f]: d?.error instanceof Error ? '' : checks[f].error?.(d) || ''}}
    return s.queued ? attempt(n, k) : {s: n}
  }

  const model: any = {}
  for (const a in steps) {
    let last: any[] = []
    // (HOST, with the host state h, always computes: one slice object starts every app's host)
    const out = (s: any, d: any, k: string, h?: any) => !h && last[0] === s && last[1] === d ? last[2] : (last = [s, d, steps[a](s, d, k, h)])[2]
    model[a] = {
      // VALIDATE: on the host's state (HOST), for a `values` function; the slice's own steps on it
      ...a == 'VALIDATE' ? {HOST: (h: any, d: any, _n: any, _p: any, _o: any, k: string) => { const x = out(h[k], d, k, h); return x ? {...h, [k]: x.s} : h }}
        : {STATE: (s: any, d: any, _n: any, _p: any, _o: any, k: string) => out(s, d, k)?.s || ABORT},
      EFFECT: (s: any, d: any, next: any, _p: any, _o: any, k: string) => {
        const x = out(s, d, k), w = x?.wait
        if (x?.send) {
          const r = v(x.s.values).value
          dev(233, s.values, r)
          // G-577: a submit named after one of the form's own actions goes to that one
          submit in steps && dev(234, submit, k, b)
          next(submit, r, 0)
        }
        w && Promise.resolve(v(w.values)).then(() => next('RESULT', w, 0))
      },
      ELEMENT: (s: any, d: any, _n: any, _p: any, _o: any, k: string) => out(s, d, k)?.focus || ABORT,
      ...(checked.length && {[http]: (s: any, d: any, _n: any, _p: any, _o: any, k: string) => out(s, d, k)?.req || ABORT}),
    }
  }

  const b = defineBehavior({
    form: schema,
    // validating until VALIDATE (sync) or its RESULT (async): not valid yet (G-375, not validated)
    initialState: {...base(values), validating: true},
    intent: ({DOM, STATE}: any) => {
      const f = DOM.select(sel), sub = f.events('submit', {preventDefault: true})
      let on = 0
      return {
        // D239: resetOnShow also starts over each time the form element appears again (a
        // Switchable page shown again: hidden pages stay alive; a form rendered again)
        VALIDATE: again ? xs.merge(xs.of(0), f.elements().filter((e: any) => { const r = e.length && !on; on = e.length; return r })) : xs.of(0),
        // G-376: a checkbox (native, or a hyphenated tag with a boolean `checked`: a
        // form-associated custom checkbox / switch) gives `checked` and its value as `item`; a
        // <select multiple> the selected values; type=file is left alone; others give `value`
        CHANGE: f.events('input').filter(({target: t}: any) => t.type != 'file').map(({target: t}: any) =>
          t.type == 'checkbox' || /-/.test(t.tagName) && typeof t.checked == 'boolean' ? {name: t.name, value: t.checked, item: t.value}
          : {name: t.name, value: t.type == 'select-multiple' ? [...t.selectedOptions].map((o: any) => o.value) : t.value}),
        BLUR: f.events('focusout').map((e: any) => e.target.name),
        SUBMIT: ft ? ft.submit(sub, STATE, v) : sub,
      }
    },
    model,
    calculated: {
      fields: (s: any) => {
        const out: any = {}
        for (const n of fieldNames(s.values)) {
          const value = getField(s.values, n)
          const error = s.server[n] || s.remote[n] || ((s.submitCount || show != 'submit' && s.touched[n]) && s.errors[n]) || ''
          out[n] = {name: n, value, error, invalid: !!error, touched: !!s.touched[n], dirty: value !== getField(s.initial, n), pending: n in s.pending}
        }
        return out
      },
      // G-382: an async schema re-validating keeps the last answer's validity (no flicker)
      valid: (s: any) => s.validated && !keys(s.errors).length && !keys(s.remote).length,
      dirty: (s: any) => JSON.stringify(s.values) != JSON.stringify(s.initial),
      error: (s: any) => s.server[''] || (s.submitCount && s.errors['']) || '',
    },
  })({...o, values}), merge = b.merge
  ft && (b.$tool = ft.$tool)
  b.merge = (c: any, k: string) => {
    const e = c.model?.[submit]
    req = !!e && typeof e == 'object' && http in e
    merge(c, k)
  }
  return b
}
