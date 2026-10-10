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
 *        output, SYG233 (warn, once per key): the schema strips it (zod's z.object does). G-377:
 *        only when every output key is a values key (an output with other keys reshapes: a rename)
 *   235  (field, request) a check's request with `ok` / `error` / `latest` keys, which the form
 *        overwrites: SYG235 (warn, once per field)
 *   234  (submit, key) G-577: a valid submit whose `submit` names one of the form's own actions,
 *        so it dispatched '<key>.<submit>' instead of the host's action: SYG234 (warn, once per
 *        key and name), at the submit (the form's own action then often throws: SYG214 / SYG216)
 * Host checks (onModel, once per component name), for each `uses` entry made by form():
 *   SYG234 (warn) `submit` missing, not a host model entry, or one of the form's own action names
 *          (G-577: every action in that form's model, CHECKED_<field> included)
 *   SYG235 (warn) a `check` key that isn't a field of `values`
 *   SYG236 (warn) an array of objects in `values` with a row without an `id`
 *   SYG237 (warn) two form uses of one host with the same form selector (G-374)
 *   SYG245 (error, reported) PLAN-6 A-3 (D291): a `tool` option not made by formTool() (no `$`
 *          hook: a plain object); the form offers no tool
 */
import type {DiagnosticCheck} from '../index'
import {devReport, once, nameOf} from './shared'
import {docsUrlFor} from '../codes'
import {hasField} from '../../formHelpers'

// the form's own action names (G-577: read from the form's model, so CHECKED_<field> counts)
const ownActions = (b: any): string[] => Object.keys(b?.model || {})
const SUBMIT_FIX = (key: string, a: string, own: string[]) =>
  `Name the submit after a host action the form doesn't define (not ${own.join(', ')}): submit: 'SAVE', and rename the model entry '${a}' to SAVE: { HTTP: (state, values) => ({ url, json: values, ok: '${key}.DONE', error: '${key}.ERRORS' }) }`
const RESERVED = ['ok', 'error', 'latest']

const what = (v: any): string =>
  v === null || v === undefined ? String(v)
  : typeof v == 'function' ? 'a function'
  : Array.isArray(v) ? 'an array'
  : typeof v == 'object' ? `an object without ~standard.validate${typeof v.parse == 'function' ? ' (a validator from before Standard Schema?)' : ''}`
  : `a ${typeof v}`

export function reportForm(code: number, a?: any, b?: any, c?: any): any {
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
      message: `form: a submit was dropped: ${a?.submitting ? 'the previous submit is still being sent (no form.DONE / form.ERRORS yet)' : 'a submit is already queued, waiting for an async check or an async schema'}`,
      fix: `Disable the submit button while state.form.submitting (or queued) is true; answer the submit with ok: 'form.DONE', error: 'form.ERRORS'`,
    })
  } else if (code == 233) {
    if (!b || typeof b != 'object' || Object.keys(b).some(k => !(k in (a || {})))) return
    for (const k of Object.keys(a || {})) {
      if (!(k in b) && once(`SYG233:${k}`)) devReport('SYG233', {
        component: 'form',
        message: `form: values.${k} is not in the schema's output (stripped or renamed), so the submit action doesn't get it under that name (a schema strips keys it doesn't declare)`,
        fix: `Declare '${k}' in the schema (or make the schema keep unknown keys), or remove it from values; if the schema renames it on purpose, ignore this`,
        data: {key: k},
      })
    }
  } else if (code == 234) {
    if (!once(`SYG234:run:${b}:${a}`)) return
    devReport('SYG234', {
      component: 'form',
      message: `form '${b}': a valid submit dispatched '${b}.${a}' (the form's own ${a} action), not the host's '${a}': submit: '${a}' names one of the form's own actions, which next() prefers`,
      fix: SUBMIT_FIX(b, a, ownActions(c)),
      data: {key: b, submit: a},
    })
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
    const name = nameOf(component), sels: Record<string, string> = {}
    for (const key of Object.keys(uses)) {
      const b = uses[key]
      if (!b?.form) continue
      // G-374: each form listens on its selector inside the host, so two with one selector hear
      // each other's fields and submits
      const sel = b.options?.form || 'form'
      if (sel in sels) {
        if (once(`SYG237:${name}:${sel}`)) devReport('SYG237', {
          component,
          message: `${name}'s forms '${sels[sel]}' and '${key}' both listen on '${sel}', so each hears the other's fields and submits`,
          fix: `Give each form element its own class and pass it: ${sels[sel]}: form(schema, { ..., form: '.${sels[sel]}' }), ${key}: form(schema, { ..., form: '.${key}' })`,
          data: {keys: [sels[sel], key], form: sel},
        })
      } else sels[sel] = key
      if (!once(`SYG23x:${name}:${key}`)) continue
      const o = b.options || {}, values = o.values || {}
      if (o.tool && typeof o.tool.$ != 'function') devReport('SYG245', {
        component,
        message: `${name}'s form '${key}': the tool option is ${typeof o.tool == 'object' ? 'a plain object' : what(o.tool)}, not made by formTool(), so the form isn't offered to the browser's agent`,
        fix: `Wrap it: import { formTool } from 'sygnal/ai', then form(schema, { ..., tool: formTool({ name: '${o.tool?.name || 'sign_up'}', description: '...' }) })`,
        data: {key, tool: o.tool},
      })
      const model = Object.keys(view.model || {}).map(a => a.split('|')[0].trim()), own = ownActions(b)
      const clash = own.includes(o.submit)
      if (typeof o.submit != 'string' || !model.includes(o.submit) || clash) {
        devReport('SYG234', {
          component,
          message: typeof o.submit != 'string' ? `${name}'s form '${key}' has no submit action, so a valid submit dispatches nothing`
            : clash ? `${name}'s form '${key}' names submit: '${o.submit}', one of the form's own actions; a valid submit dispatches the form's '${key}.${o.submit}'${model.includes(o.submit) ? `, never ${name}'s '${o.submit}' entry` : ''}`
            : `${name}'s form '${key}' dispatches '${o.submit}' on a valid submit, but ${name} has no model entry '${o.submit}'`,
          fix: clash ? SUBMIT_FIX(key, o.submit, own)
            : `Name a host action and add it to the model: submit: 'SIGN_UP', model: { SIGN_UP: { HTTP: (state, values) => ({ url, json: values, ok: '${key}.DONE', error: '${key}.ERRORS' }) } }`,
          data: {key, submit: o.submit},
        })
      }
      for (const f of Object.keys(o.check || {})) {
        if (!hasField(values, f)) devReport('SYG235', {
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
