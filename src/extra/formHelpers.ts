/*
 * PLAN-5 F-1: form helpers. The `form` behavior (./form.ts) is built on them, and they are
 * exported as the escape hatch for a form written with plain model actions (D193, shape B).
 * Pure functions over a plain `values` object, for model reducers; 0 B core.
 *
 * Field names: a field's `name=` attribute is its path in `values`, dot-separated. A segment
 * inside an array of objects is the row's `id` (not its index), so touched/errors follow a row
 * when another row is removed: `addresses.7.street` is `values.addresses.find(r => r.id == 7).street`.
 * An array of non-objects (or rows without an id) uses the index.
 *
 * Validation: any Standard Schema (`schema['~standard'].validate`: zod, valibot, arktype, a
 * hand-written object), no dependency. A sync schema validates inside reducers; an async one
 * (validate returns a Promise) returns a Promise here, for an EFFECT.
 */
import type {SchemaIssue} from './standardSchema'
import {focusWithin} from './focusWithin'
import {ABORT} from '../shared'

export type FieldErrors = Record<string, string>
export type FormCheck = {errors: FieldErrors; value: any}

const isRow = (r: any) => r?.id != null
// the key of segment `s` in `v`: an array's row with that id (else the index), an object's key
const key = (v: any, s: string): any => {
  if (!Array.isArray(v)) return s
  const i = v.findIndex(r => isRow(r) && r.id + '' == s)
  return i < 0 ? +s : i
}

/** the field name (id-based path) of a schema issue path (index-based) */
export const fieldName = (values: any, path: ReadonlyArray<any> = []): string => {
  let v = values
  return path.map(p => {
    p = p?.key ?? p
    const r = Array.isArray(v) && isRow(v[p]) ? v[p].id : p
    v = v?.[p]
    return r
  }).join('.')
}

/** the value at a field name (undefined when there is none) */
export const getField = (values: any, name: string): any =>
  name.split('.').reduce((v, s) => v?.[key(v, s)], values)

/** `values` with the field at `name` set to `value` (immutable; an unknown row is left alone) */
export const setField = (values: any, name: string, value: any): any => {
  const [s, ...rest] = name.split('.'), k = key(values, s), a = Array.isArray(values)
  const x = rest.length ? setField(values?.[k] ?? {}, rest.join('.'), value) : value
  if (x === values?.[k] || a && !(k in values)) return values
  const c = a ? values.slice() : {...values}
  c[k] = x
  return c
}

/**
 * every field name of `values`, in object order: each leaf, and each array itself (for an
 * array-level error such as "at least one address"); a row's `id` is not a field
 */
export const fieldNames = (v: any, at = '', row?: boolean): string[] => {
  if (!v || typeof v != 'object') return at ? [at] : []
  const a = Array.isArray(v), out = a ? [at] : []
  for (const k in v) {
    const x = (v as any)[k]
    if (!row || k != 'id') out.push(...fieldNames(x, (at && at + '.') + (a && isRow(x) ? x.id : k), a))
  }
  return out
}

const errorsOf = (values: any, issues: ReadonlyArray<SchemaIssue> = []): FieldErrors => {
  const e: FieldErrors = {}
  for (const i of issues) {
    const n = fieldName(values, i.path)
    n in e || (e[n] = i.message)
  }
  return e
}

/**
 * Validates `values` with a Standard Schema: `{ errors, value }` (errors by field name, '' for
 * a form-level issue, the first message per field; `value` is the schema's output, transformed,
 * when there are none). A Promise of it when the schema is async. `schema` must be a Standard
 * Schema object (the `form` behavior reports SYG231 in dev).
 */
export const checkForm = (schema: any, values: any): FormCheck | Promise<FormCheck> => {
  const r = schema['~standard'].validate(values)
  const done = (r: any): FormCheck => ({errors: errorsOf(values, r.issues), value: r.issues ? undefined : r.value})
  return r.then ? r.then(done) : done(r)
}

/** the errors only, by field name ({} when valid); a Promise of them for an async schema */
export const formErrors = (schema: any, values: any): any => {
  const r: any = checkForm(schema, values)
  return r.then ? r.then((x: FormCheck) => x.errors) : r.errors
}

/**
 * Server errors as field errors: an error reply (a driver's `{ error, status?, body?, request }`
 * or `{ status, body }`; the body `{ errors }` or the map itself), a map `{ name: message |
 * messages }`, or a list of Standard-Schema-like issues `[{ path, message }]` (index paths
 * become field names with `values`). With `values`, a message for a name that isn't one of its
 * fields (`message`, `error`) is the form-level message (''); a reply without any becomes
 * 'Request failed (status)' under ''.
 */
export const replyErrors = (reply: any, values?: any): FieldErrors => {
  let e = reply && ('request' in reply || 'body' in reply && 'status' in reply) ? reply.body : reply
  e = e?.errors ?? e
  const out: FieldErrors = Array.isArray(e) ? errorsOf(values, e) : {}
  if (e && typeof e == 'object' && !Array.isArray(e)) for (const k in e) {
    const m = [].concat(e[k])[0] + ''
    k && values && getField(values, k) === undefined ? out[''] ||= m : out[k] = m
  }
  return Object.keys(out).length ? out : {'': 'Request failed' + (reply?.status ? ` (${reply.status})` : '')}
}

/**
 * An ELEMENT command that focuses the first field, in DOM order, whose `name` is one of `names`
 * (a list, or an errors map: its names with a message; '' is skipped), anywhere in the sender's view, fields
 * of child components and Collection items included (`focusWithin`, D194). ABORT when there is
 * nothing to focus: `ELEMENT: (state) => focusInvalid(state.errors)`.
 */
export const focusInvalid = (names: string[] | FieldErrors): any => {
  const list = (Array.isArray(names) ? names : Object.keys(names).filter(n => names[n])).filter(n => n)
  return list.length ? {focus: focusWithin(list.map(n => `[name=${JSON.stringify(n)}]`).join())} : ABORT
}
