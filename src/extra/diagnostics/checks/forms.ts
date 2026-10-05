/**
 * PLAN-5 F-1: `form` behavior diagnostics (dev entry; src/extra/form.ts carries no text).
 *
 * The form module calls `__SYGNAL_DIAGNOSTICS__.form(code, ...args)`:
 *   231  form(schema) with a schema that isn't a Standard Schema: throws the SYG231 Error (in
 *        production the first validation throws a plain TypeError)
 *   230  (name, values) an input / focusout from a named field whose name isn't in `values`:
 *        SYG230 (warn, once per name); the event is ignored
 *   232  (slice) a submit while submitting or while a queued submit waits for a check: SYG232
 *        (info, every time); the submit is dropped
 *   233  (values, output) a valid submit: each top-level `values` key missing from the schema's
 *        output, SYG233 (warn, once per key): the schema strips it (zod's z.object does)
 *   235  (field, request) a check's request with `ok` / `error` / `latest` keys, which the form
 *        overwrites: SYG235 (warn, once per field)
 * Host checks (onModel, once per component name), for each `uses` entry made by form():
 *   SYG234 (warn) `submit` missing, not a host model entry, or one of the form's own action names
 *   SYG235 (warn) a `check` key that isn't a field of `values`
 *   SYG236 (warn) an array of objects in `values` with a row without an `id`
 */
import type {DiagnosticCheck} from '../index'
import {devReport, once, nameOf} from './shared'
import {docsUrlFor} from '../codes'
import {getField} from '../../formHelpers'

const FORM_ACTIONS = ['CHANGE', 'BLUR', 'SUBMIT', 'ADD', 'REMOVE', 'ERRORS', 'DONE', 'RESET', 'RESULT']
const RESERVED = ['ok', 'error', 'latest']

const what = (v: any): string =>
  v === null || v === undefined ? String(v)
  : typeof v == 'function' ? 'a function'
  : Array.isArray(v) ? 'an array'
  : typeof v == 'object' ? `an object without ~standard.validate${typeof v.parse == 'function' ? ' (a validator from before Standard Schema?)' : ''}`
  : `a ${typeof v}`

export function reportForm(code: number, a?: any, b?: any): any {
  if (code == 231) {
    const err: any = new TypeError(`[Sygnal SYG231] form(schema, options): the schema is ${what(a)}, not a Standard Schema. ` +
      `Pass a Standard Schema object: a zod, valibot or arktype schema, or an object with '~standard': { version: 1, vendor, validate }. ${docsUrlFor('SYG231')}`)
    err.code = 'SYG231'
    throw err
  }
  if (code == 230) {
    if (!once(`SYG230:${a}`)) return
    devReport('SYG230', {
      component: 'form',
      message: `form: a field named '${a}' changed, but '${a}' isn't a field of the form's values (${Object.keys(b || {}).join(', ') || 'none'}); the change is ignored`,
      fix: `Name the input after a path in values (name="email", name="addresses.<row id>.city"), add '${a}' to values, or move the input out of the form element`,
      data: {name: a},
    })
  } else if (code == 232) {
    devReport('SYG232', {
      component: 'form',
      message: `form: a submit was dropped: ${a?.submitting ? 'the previous submit is still being sent (no form.DONE / form.ERRORS yet)' : 'a submit is already queued, waiting for an async check'}`,
      fix: `Disable the submit button while state.form.submitting (or queued) is true; answer the submit with ok: 'form.DONE', error: 'form.ERRORS'`,
    })
  } else if (code == 233) {
    for (const k of Object.keys(a || {})) {
      if (b && typeof b == 'object' && !(k in b) && once(`SYG233:${k}`)) devReport('SYG233', {
        component: 'form',
        message: `form: values.${k} is not in the schema's output, so the submit action doesn't get it (the schema strips keys it doesn't declare)`,
        fix: `Declare '${k}' in the schema (or make the schema keep unknown keys), or remove it from values`,
        data: {key: k},
      })
    }
  } else if (code == 235) {
    const set = RESERVED.filter(k => b && k in b)
    if (set.length && once(`SYG235:req:${a}`)) devReport('SYG235', {
      component: 'form',
      message: `form: the check for '${a}' returns a request with ${set.map(k => `'${k}'`).join(', ')}; the form sets them itself (its reply action and latest: true), so they are replaced`,
      fix: `Return only the request: check: { ${a}: { request: (v) => ({ url, query }), error: (body) => message } }`,
      data: {field: a, keys: set},
    })
  }
}

/** row ids missing in `values`: the names of the arrays of objects that have a row without an id */
const missingIds = (v: any, at = '', out: string[] = []): string[] => {
  if (v && typeof v == 'object') {
    if (Array.isArray(v) && v.some(r => r && typeof r == 'object' && !Array.isArray(r) && r.id == null)) out.push(at)
    for (const k in v) missingIds(v[k], at ? `${at}.${k}` : k, out)
  }
  return out
}

export const formsCheck: DiagnosticCheck = {
  id: 'forms',

  onModel(component) {
    const view = component?.view, uses = view?.uses
    if (!uses || typeof uses != 'object') return
    const name = nameOf(component)
    for (const key of Object.keys(uses)) {
      const b = uses[key]
      if (!b?.form || !once(`SYG23x:${name}:${key}`)) continue
      const o = b.options || {}, values = o.values || {}
      const model = Object.keys(view.model || {}).map(a => a.split('|')[0].trim())
      if (typeof o.submit != 'string' || !model.includes(o.submit) || FORM_ACTIONS.includes(o.submit)) {
        devReport('SYG234', {
          component,
          message: typeof o.submit != 'string' ? `${name}'s form '${key}' has no submit action, so a valid submit dispatches nothing`
            : FORM_ACTIONS.includes(o.submit) ? `${name}'s form '${key}' names submit: '${o.submit}', one of the form's own actions; the submit would dispatch '${key}.${o.submit}'`
            : `${name}'s form '${key}' dispatches '${o.submit}' on a valid submit, but ${name} has no model entry '${o.submit}'`,
          fix: `Name a host action and add it to the model: submit: 'SIGN_UP', model: { SIGN_UP: { HTTP: (state, values) => ({ url, json: values, ok: '${key}.DONE', error: '${key}.ERRORS' }) } }`,
          data: {key, submit: o.submit},
        })
      }
      for (const f of Object.keys(o.check || {})) {
        if (getField(values, f) === undefined) devReport('SYG235', {
          component,
          message: `${name}'s form '${key}' has a check for '${f}', which isn't a field of its values; it never runs`,
          fix: `Use a field name from values (${Object.keys(values).join(', ')})`,
          data: {key, field: f},
        })
      }
      for (const at of missingIds(values)) devReport('SYG236', {
        component,
        message: `${name}'s form '${key}': values.${at} has rows without an id, so its fields are named by index and errors, touched state and focus don't follow a row when another is removed`,
        fix: `Give each row a unique id: ${at}: [{ id: 1, ... }] (form.ADD numbers new rows itself)`,
        data: {key, field: at},
      })
    }
  },
}

/** Install the `form` hook on the core bridge (form.ts calls it). */
export function installFormHooks(): () => void {
  const c = (globalThis as any).__SYGNAL_DIAGNOSTICS__
  if (!c) return () => {}
  c.form = reportForm
  return () => { if (c.form === reportForm) c.form = undefined }
}
