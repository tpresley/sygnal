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
 * Options: `values` (the start values), `submit` (host action), `check` (async per-field checks
 * through a driver: a request with a reply action, `latest`), `show` ('blur' default: a schema
 * error shows once its field was blurred; 'input'; 'submit'), `form` (selector), `http` (the
 * driver sink of the checks, 'HTTP').
 *
 * Slice (state.form): values, initial, errors (all current schema errors by name), touched,
 * server (server errors), remote (async check results: '' passed), pending (name -> value being
 * checked), submitting, submitted, submitCount, queued (a submit waits for a check or an async
 * schema), validating
 * (an async schema runs); calculated: fields (per name: { name, value, error, invalid, touched,
 * dirty, pending }; `error` is what to show), valid, dirty, error (form-level message).
 *
 * Actions: form.CHANGE ({ name, value }), form.BLUR (name), form.SUBMIT, form.ADD ({ field,
 * value }), form.REMOVE ({ field, id }), form.ERRORS (an error reply or a map: server errors),
 * form.DONE (saved), form.RESET (values?); internal: form.RESULT (an async schema's result),
 * form.CHECKED_<name> (a check's reply; a failed check passes: the server checks on submit).
 *
 * Each action is one step function, `(slice, data, key) => outcome | null` (null: no change),
 * the outcome `{ s: new slice, focus: ELEMENT command, req: a check request, send: 1 (dispatch
 * submit), wait: { values, submit? } (an async schema to await) }`. Its sinks (STATE, EFFECT,
 * ELEMENT, and the checks' driver) read that outcome, computed once per (slice, data). D197:
 * the handlers get the `uses` key, which names the reply actions.
 *
 * Dev diagnostics (checks/forms.ts, through the core bridge's `form` hook; nothing in
 * production): SYG230 a field name not in values, SYG231 not a Standard Schema (throws), SYG232
 * a submit dropped, SYG233 a values key missing from the schema's output, SYG235 a check request
 * that sets reply fields. The host checks (SYG234 submit, SYG235 check names, SYG236 row ids)
 * run when the host is created.
 */
import {defineBehavior} from './behaviors'
import {ABORT} from '../shared'
import {isStandardSchema} from './standardSchema'
import {checkForm, fieldNames, getField, setField, replyErrors, focusInvalid} from './formHelpers'

const dev = (...a: any[]): any => (globalThis as any).__SYGNAL_DIAGNOSTICS__?.form?.(...a)
const keys = (o: any) => Object.keys(o).filter(k => o[k])
const drop = (o: any, p: string) => {
  const r: any = {}
  for (const k in o) if (k != p && !k.startsWith(p + '.')) r[k] = o[k]
  return r
}

export const form = (schema: any, o: any = {}): any => {
  isStandardSchema(schema) || dev(231, schema)
  const {values = {}, submit, check: checks = {}, show = 'blur', http = 'HTTP'} = o
  const cache = new WeakMap(), checked = Object.keys(checks)
  // the schema's result, once per values object; an async one replaces its Promise when it settles
  const v = (vals: any): any => {
    let r = cache.get(vals)
    if (!r) {
      cache.set(vals, r = checkForm(schema, vals))
      r.then?.((x: any) => cache.set(vals, x))
    }
    return r
  }
  const known = (s: any, n: any) => {
    const k = n && getField(s.values, n) !== undefined
    n && !k && dev(230, n, s.values)
    return k
  }
  // new values: errors now (sync schema), or after the schema's Promise (RESULT)
  const edit = (s: any, vals: any, x?: any) => {
    const r = v(vals), a = !!r.then
    return {s: {...s, ...x, values: vals, validating: a, ...(!a && {errors: r.errors})}, wait: a && {values: vals}}
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
    return bad.length ? {s: {...s, queued: false}, focus: focusInvalid(bad)}
      : f ? ask(s, f, k, true)
      : Object.keys(s.pending).length ? {s: {...s, queued: true}}
      : {s: {...s, queued: false, submitting: true}, send: 1}
  }
  const fresh = (vals: any) => edit({initial: vals, touched: {}, server: {}, remote: {}, pending: {},
    submitting: false, submitted: false, submitCount: 0, queued: false, errors: {}}, vals)

  const steps: Record<string, (s: any, d: any, k: string) => any> = {
    CHANGE: (s, d) => known(s, d?.name) ? edit(s, setField(s.values, d.name, d.value), {
      server: drop(drop(s.server, d.name), ''), remote: drop(s.remote, d.name), pending: drop(s.pending, d.name), queued: false,
      touched: show == 'input' ? {...s.touched, [d.name]: true} : s.touched,
    }) : null,
    BLUR: (s, n, k) => {
      if (!known(s, n)) return null
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
      const n = {...s, errors: v(d.values).errors, validating: false}
      return d.submit && !s.submitting ? attempt(n, k) : {s: n}
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
      return {s: {...s, server: e, submitting: false, queued: false}, focus: focusInvalid(e)}
    },
    DONE: (s) => ({s: {...s, submitting: false, submitted: true, initial: s.values, server: {}, touched: {}}}),
    RESET: (s, d) => fresh(d && typeof d == 'object' ? d : s.initial),
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
    const out = (s: any, d: any, k: string) => last[0] === s && last[1] === d ? last[2] : (last = [s, d, steps[a](s, d, k)])[2]
    model[a] = {
      STATE: (s: any, d: any, _n: any, _p: any, _o: any, k: string) => out(s, d, k)?.s || ABORT,
      EFFECT: (s: any, d: any, next: any, _p: any, _o: any, k: string) => {
        const x = out(s, d, k), w = x?.wait
        if (x?.send) {
          const r = v(x.s.values).value
          dev(233, s.values, r)
          next(submit, r, 0)
        }
        w && Promise.resolve(v(w.values)).then(() => next('RESULT', w, 0))
      },
      ELEMENT: (s: any, d: any, _n: any, _p: any, _o: any, k: string) => out(s, d, k)?.focus || ABORT,
      ...(checked.length && {[http]: (s: any, d: any, _n: any, _p: any, _o: any, k: string) => out(s, d, k)?.req || ABORT}),
    }
  }

  return defineBehavior({
    form: schema,
    initialState: {...fresh(values).s, validating: false},
    intent: ({DOM}: any) => {
      const f = DOM.select(o.form || 'form')
      return {
        CHANGE: f.events('input').map(({target: t}: any) => ({name: t.name, value: t.type == 'checkbox' ? t.checked : t.value})),
        BLUR: f.events('focusout').map((e: any) => e.target.name),
        SUBMIT: f.events('submit', {preventDefault: true}),
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
      valid: (s: any) => !keys(s.errors).length && !keys(s.remote).length,
      dirty: (s: any) => JSON.stringify(s.values) != JSON.stringify(s.initial),
      error: (s: any) => s.server[''] || (s.submitCount && s.errors['']) || '',
    },
  })(o)
}
