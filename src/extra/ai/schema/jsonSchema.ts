/*
 * PLAN-6 A-1 (D262, 0-S4 §4): plain JSON Schema as a tool `input` (or a chat `output`), only
 * through `jsonSchema(json[, { validate }])`. It returns a Standard Schema that is also a
 * Standard JSON Schema, so it takes the same path as Zod / Valibot / ArkType. Without
 * `validate`, a subset validator checks the value: type (integer and type arrays too), enum,
 * const, required, properties, additionalProperties (false or a schema), items, prefixItems,
 * anyOf / oneOf, minLength / maxLength, pattern, minimum / maximum, minItems / maxItems and local
 * `$ref`s (`#`, `#/$defs/…`, `#/definitions/…`). format, allOf, not, if/then/else, multipleOf,
 * uniqueItems, exclusive* and the rest are accepted unchecked. `{ validate: s }` keeps a
 * library's own validation (Zod Mini: `jsonSchema(z.toJSONSchema(s), { validate: s })`).
 * A separate module: tree-shaken unless imported.
 */
import type {Issue} from './index'

const T = (v: any) => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v
const is = (t: string, v: any) => t == 'integer' ? Number.isInteger(v) : t == 'number' ? typeof v == 'number' && isFinite(v) : T(v) == t
const S = JSON.stringify

/** the subset check: the issues of `v` against `s` (empty when valid) */
export function check(s: any, v: any, root: any = s, path: PropertyKey[] = [], out: Issue[] = []): Issue[] {
  const bad = (message: string) => (out.push({message, path}), out)
  if (s === false) return bad('no value allowed')
  if (!s || s === true) return out
  if (s.$ref) return check(s.$ref == '#' ? root : root.$defs?.[s.$ref.slice(8)] ?? root.definitions?.[s.$ref.slice(14)], v, root, path, out)
  const types = [].concat(s.type ?? []) as string[]
  if (types.length && !types.some(t => is(t, v))) return bad(`expected ${types.join(' or ')}, got ${T(v)}`)
  if (s.enum && !s.enum.some((e: any) => S(e) == S(v))) return bad(`expected one of ${S(s.enum)}`)
  if ('const' in s && S(s.const) != S(v)) return bad(`expected ${S(s.const)}`)
  const any = s.anyOf ?? s.oneOf
  if (any && !any.some((b: any) => !check(b, v, root, path).length)) return bad('matches no alternative')
  if (typeof v == 'string') {
    if (v.length < (s.minLength ?? 0)) bad(`at least ${s.minLength} characters`)
    if (v.length > (s.maxLength ?? Infinity)) bad(`at most ${s.maxLength} characters`)
    if (s.pattern && !new RegExp(s.pattern, 'u').test(v)) bad(`must match ${s.pattern}`)
  }
  if (typeof v == 'number') {
    if (v < (s.minimum ?? -Infinity)) bad(`at least ${s.minimum}`)
    if (v > (s.maximum ?? Infinity)) bad(`at most ${s.maximum}`)
  }
  if (Array.isArray(v)) {
    if (v.length < (s.minItems ?? 0)) bad(`at least ${s.minItems} items`)
    if (v.length > (s.maxItems ?? Infinity)) bad(`at most ${s.maxItems} items`)
    const pre = s.prefixItems ?? []
    v.forEach((x, i) => check(i < pre.length ? pre[i] : s.items, x, root, [...path, i], out))
  } else if (T(v) == 'object') {
    for (const k of s.required ?? []) if (!(k in v)) bad(`${k} is required`)
    const p = s.properties ?? {}
    for (const k in v) check(k in p ? p[k] : s.additionalProperties, v[k], root, [...path, k], out)
  }
  return out
}

/**
 * A plain JSON Schema as a Standard Schema with Standard JSON Schema: the schema goes to the
 * model as is (normalized), and the subset validator (or `options.validate`, a Standard Schema)
 * checks the value
 */
export function jsonSchema(schema: any, options: {validate?: any} = {}): any {
  const own = options.validate?.['~standard']
  const out = () => schema
  return {
    '~standard': {
      version: 1,
      vendor: 'sygnal',
      validate: own ? (v: any) => own.validate(v) : (value: any) => {
        const issues = check(schema, value)
        return issues.length ? {issues} : {value}
      },
      jsonSchema: {input: out, output: out},
    },
  }
}
