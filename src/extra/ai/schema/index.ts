/*
 * PLAN-6 A-1 (0-S4): the input contract of agent tools and of structured chat output.
 *
 * An `input` (or a chat request's `output`) is a Standard Schema that also implements Standard
 * JSON Schema (Zod 4.2+, ArkType 2.1.28+, Valibot through `toStandardJsonSchema()`), or a plain
 * JSON Schema wrapped by `jsonSchema()` (./jsonSchema.ts, D262). The model always gets the
 * INPUT-side JSON Schema (it produces what `validate` receives), after the portable
 * normalization below, which every consumer (the agent layer, WebMCP, the chat behavior, the
 * chat driver's `output`, t.tools()) shares:
 * - `$schema` / `$id` dropped, `oneOf` -> `anyOf`, Zod's safe-integer bounds dropped, a closed
 *   tuple's `items: false` -> `maxItems` (Ollama rejects boolean subschemas);
 * - a root self-reference (`"$ref": "#"`, Zod's recursion) moved into `$defs.__root` (Ollama
 *   rejects `#`, and wrapping changes what it means); ArkType's `$ref`-only root inlined;
 * - a non-object root wrapped as `{ value }` (`required`, `additionalProperties: false`); the
 *   unwrap is lenient: arguments without a `value` key are taken as the value itself (0-S4: both
 *   local models sent a wrapped object union bare).
 * A schema part with no JSON Schema form (refinements, a Date) is retried with the library's
 * lossy option (`lossy`: SYG243, a dev warning; validation still enforces it); no form at all is
 * `error` (SYG240). Conversions are cached by schema object (ArkType rebuilds `~standard` on
 * every read, G-608). The strict layer for OpenAI / Anthropic is the transports' (Phase 2).
 */

/** The result of converting a schema: the tool schema, or why there is none (SYG240) */
export interface Converted {
  /** the normalized, input-side JSON Schema; always an object root */
  schema?: any
  /** the root was wrapped as `{ value }` */
  wrapped?: boolean
  /** a lossy conversion (SYG243): what the library couldn't express */
  lossy?: string
  /** no JSON Schema form (SYG240) */
  error?: string
}

// each library's "give me what you can" switch (Standard JSON Schema's libraryOptions)
const LOSSY: Record<string, any> = {zod: {unrepresentable: 'any'}, valibot: {errorMode: 'ignore'}, arktype: {fallback: (c: any) => c.base}}
const SAFE = 9007199254740991
const cache = new WeakMap<object, Converted>()

const msg = (e: any) => String(e?.message || e).split('\n')[0].slice(0, 200)
export const isObj = (x: any): boolean => !!x && typeof x == 'object' && !Array.isArray(x)

/**
 * The JSON Schema a model gets for `schema` (a Standard Schema with Standard JSON Schema, or
 * `jsonSchema()`): `{ schema, wrapped, lossy? }`, or `{ error }` when it has no JSON Schema form.
 * Cached by schema object.
 */
export function toJsonSchema(input: any): Converted {
  if (!input || (typeof input != 'object' && typeof input != 'function')) return {error: 'not a Standard Schema'}
  let c = cache.get(input)
  if (!c) cache.set(input, c = convert(input))
  return c
}

function convert(input: any): Converted {
  const st = input['~standard']
  if (typeof st?.validate != 'function') return {error: input.type || input.properties || input.anyOf || input.enum ? 'a plain JSON Schema: wrap it with jsonSchema()' : 'not a Standard Schema'}
  const conv = st.jsonSchema?.input, v = st.vendor
  if (typeof conv != 'function') return {error: `the ${v} schema has no JSON Schema form` + (v == 'valibot' ? ': wrap it with toStandardJsonSchema() from @valibot/to-json-schema' : v == 'zod' ? ' (Zod Mini): use jsonSchema(z.toJSONSchema(s), { validate: s })' : '')}
  let js: any, lossy: string | undefined
  try { js = conv({target: 'draft-2020-12'}) } catch (e) {
    try { if (!LOSSY[v]) throw 0; js = conv({target: 'draft-2020-12', libraryOptions: LOSSY[v]}) } catch (_) { return {error: 'no JSON Schema form: ' + msg(e)} }
    lossy = msg(e)
  }
  return {...normalize(js), ...(lossy && {lossy})}
}

const walk = (s: any, f: (o: any) => any): any => {
  if (Array.isArray(s)) return s.map(x => walk(x, f))
  if (!s || typeof s != 'object') return s
  const o: any = {}
  for (const k in s) o[k] = walk(s[k], f)
  return f(o)
}
const rewriteRefs = (s: any, to: string) => walk(s, o => {
  const r = o.$ref
  if (typeof r == 'string' && (r == '#' || r[1] == '/') && !/^#\/(\$defs|definitions)\//.test(r)) o.$ref = to + r.slice(1)
  return o
})

/** the portable normalization (see the header): `{ schema, wrapped }` */
export function normalize(schema: any): {schema: any; wrapped: boolean} {
  let {$schema, $id, ...s} = walk(schema, o => {
    if ('oneOf' in o && !('anyOf' in o)) { o.anyOf = o.oneOf; delete o.oneOf }
    if (o.type == 'integer' && o.minimum == -SAFE && o.maximum == SAFE) { delete o.minimum; delete o.maximum }
    if (o.prefixItems && o.items === false) { delete o.items; o.maxItems ??= o.prefixItems.length }
    return o
  })
  const m = typeof s.$ref == 'string' && /^#\/\$defs\/(.+)$/.exec(s.$ref)
  if (m && s.$defs?.[m[1]]?.type == 'object' && Object.keys(s).length == 2) s = {...s.$defs[m[1]], $defs: s.$defs}
  const {$defs, description, ...rest} = s
  const defs: any = {...$defs}
  const selfRef = /"\$ref":"#(?!\/\$defs\/|\/definitions\/)/.test(JSON.stringify(s))
  if (selfRef) {
    for (const k in defs) defs[k] = rewriteRefs(defs[k], '#/$defs/__root')
    defs.__root = rewriteRefs(rest, '#/$defs/__root')
  }
  if (s.type == 'object') return {schema: selfRef ? {...defs.__root, ...(description && {description}), $defs: defs} : s, wrapped: false}
  let value = selfRef ? {$ref: '#/$defs/__root'} : rest
  if (description) value = {...value, description}
  const out: any = {type: 'object', properties: {value}, required: ['value'], additionalProperties: false}
  if (Object.keys(defs).length) out.$defs = defs
  return {schema: out, wrapped: true}
}

const resolve = (s: any, root: any) => {
  const m = /^#\/\$defs\/(.+)$/.exec(s.$ref)
  return m ? root.$defs?.[m[1]] : s.$ref == '#' ? root : s
}

/**
 * D264: small local models send "3" for an integer and "true" for a boolean. Where the JSON
 * Schema says number / integer / boolean (and not string), a string that parses as one becomes
 * one. Nothing else changes; validation still decides.
 */
export function repair(value: any, schema: any, root: any = schema): any {
  if (schema?.$ref) schema = resolve(schema, root)
  if (!schema) return value
  const types = [].concat(schema.type ?? []) as string[]
  if (typeof value == 'string' && !types.includes('string')) {
    const t = value.trim()
    if ((types.includes('integer') || types.includes('number')) && /^-?\d+(\.\d+)?$/.test(t)) {
      const n = Number(t)
      if (types.includes('number') || Number.isInteger(n)) return n
    }
    if (types.includes('boolean') && (t == 'true' || t == 'false')) return t == 'true'
  }
  if (Array.isArray(value)) return value.map((x, i) => repair(x, schema.prefixItems?.[i] ?? schema.items, root))
  if (isObj(value)) {
    const o = {...value}
    for (const b of schema.anyOf || [schema]) {
      const bb = b?.$ref ? resolve(b, root) : b
      for (const k in bb?.properties) if (k in o) o[k] = repair(o[k], bb.properties[k], root)
    }
    return o
  }
  if (typeof value == 'string' && schema.anyOf) for (const b of schema.anyOf) { const r = repair(value, b, root); if (r !== value) return r }
  return value
}

/** One validation failure: the schema's message and the path as keys */
export interface Issue {message: string; path?: PropertyKey[]}

/**
 * A model's arguments for `schema` -> the validated value: the lenient `{ value }` unwrap,
 * `repair` (unless `repair: false`), then the schema's own validation. Resolves with
 * `{ value }` (the schema's output), `{ issues }`, or `{ error }` (no JSON Schema form)
 */
export async function parseInput(schema: any, args: any, options: {repair?: boolean} = {}): Promise<{value?: any; issues?: Issue[]; error?: string}> {
  const c = toJsonSchema(schema)
  if (c.error) return {error: c.error}
  let v = c.wrapped && isObj(args) && 'value' in args ? args.value : args
  if (options.repair !== false) v = repair(v, c.wrapped ? c.schema.properties.value : c.schema, c.schema)
  const r = await schema['~standard'].validate(v)
  return r.issues ? {issues: r.issues.map((i: any) => ({message: i.message, ...(i.path && {path: i.path.map((p: any) => isObj(p) ? p.key : p)})}))} : {value: r.value}
}
