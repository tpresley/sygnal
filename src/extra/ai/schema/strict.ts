import {resolve, walk, isObj} from './index';

/*
 * PLAN-6 L-2 (0-S4 layer 2, D266, D285): the opt-in strict schema layer of the OpenAI- and
 * Anthropic-backed transports. Apps opt in with an import (`openResponses({ strict:
 * strictSchemas })`), so the transports don't carry it otherwise (≈ 1.1 KB, D285); unstrict is
 * also used by the chat driver's structured output (./chat/output.ts), where it is always safe.
 *
 * strictSchemas(schema, dialect) turns a portable tool / output schema (./index.ts normalize)
 * into a provider's strict subset; both walk with A-1's map-aware `walk` (G-629):
 * - 'openai' (developers.openai.com structured outputs, "Supported schemas", 2026-10):
 *   `additionalProperties: false` on every object, every property required, the optional ones
 *   made nullable (a type array + null in the enum, or `anyOf [..., { type: 'null' }]`);
 *   unsupported keywords and formats moved into the description as JSON (the model still reads
 *   them; validation still enforces them), a tuple's `prefixItems` turned into `items: { anyOf }`.
 * - 'anthropic' (platform.claude.com structured outputs; the subset @anthropic-ai/sdk's
 *   transformJSONSchema keeps): `additionalProperties: false` on every object, `required` as is
 *   (optional keys stay optional), and only type, anyOf (oneOf), allOf, $ref/$defs, enum, const,
 *   description, title, properties, required, items, the supported formats and `minItems` 0/1
 *   kept; the rest (numeric and string bounds, pattern, other array constraints) moved into the
 *   description. A recursive schema or an untyped (any) value has no strict form.
 * Both return `errors` when the schema has no strict form (a record: `additionalProperties` with a
 * schema; a non-object root): the transport then sends that tool non-strict (SYG675, dev info),
 * and `optional` / `unions` (the counts Anthropic limits per request, G-609).
 *
 * unstrict(value, schema) drops the nulls a strict schema forced the model to send for keys the
 * original schema leaves optional and doesn't allow null for, so validation sees the original
 * shape. The transports run it on every tool call they sent strict.
 */

export type StrictDialect = 'openai' | 'anthropic';
export interface Strictified {schema: any; errors: string[]; optional: number; unions: number}
/** what a request has left of a provider's per-request strict limits (Anthropic, G-609) */
export interface StrictLimits {tools: number; optional: number; unions: number}

const DROP = ['allOf', 'not', 'if', 'then', 'else', 'dependentRequired', 'dependentSchemas', 'patternProperties',
  'unevaluatedProperties', 'propertyNames', 'minProperties', 'maxProperties', 'unevaluatedItems', 'contains',
  'minContains', 'maxContains', 'uniqueItems', 'default', 'examples', 'title'];
const FORMATS = ['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'ipv4', 'ipv6', 'uuid'];
// Anthropic's subset (the keywords @anthropic-ai/sdk's transformJSONSchema keeps)
const KEEP = /^(type|anyOf|allOf|\$ref|\$defs|enum|const|description|title|properties|required|additionalProperties|items)$/;
const ANT_FORMATS = /^(date-time|time|date|duration|email|hostname|uri|ipv4|ipv6|uuid)$/;

/** one schema object into Anthropic's subset, in place (oneOf -> anyOf): the keywords it moved out */
export function anthropicKeywords(o: any): any {
  const moved: any = {};
  if (o.oneOf && !o.anyOf) { o.anyOf = o.oneOf; delete o.oneOf; }
  for (const k in o) if (k == 'format' ? !ANT_FORMATS.test(o[k]) : k == 'minItems' ? o[k] > 1 : !KEEP.test(k)) { moved[k] = o[k]; delete o[k]; }
  return moved;
}

// the moved keywords as JSON at the end of the description: the model still reads them, validation still enforces them
const describe = (o: any, moved: any) => {
  if (Object.keys(moved).length) {
    const hint = JSON.stringify(moved);
    o.description = o.description ? o.description + ' ' + hint : hint;
  }
  return o;
};

/**
 * G-635: the light, always-on pass anthropicMessages() runs on a non-strict `output` schema
 * (`output_config.format` is always constrained decoding, and a keyword outside Anthropic's subset
 * is a 400): Anthropic's keywords only (the rest moved into the description), and
 * `additionalProperties: false` on every object that isn't a record. No limits, no errors.
 */
export const anthropicCompatible = (schema: any): any => walk(schema, o => {
  const moved = anthropicKeywords(o);
  if ((o.type == 'object' || o.properties) && !isObj(o.additionalProperties)) o.additionalProperties = false;
  return describe(o, moved);
});

const nullable = (p: any): any => {
  const t = p.type, withEnum = (o: any) => p.enum ? {...o, enum: [...p.enum, null]} : o;
  if (Array.isArray(t)) return t.includes('null') ? p : withEnum({...p, type: [...t, 'null']});
  if (typeof t == 'string' && !p.$ref) return withEnum({...p, type: [t, 'null']});
  if (p.anyOf) return p.anyOf.some((b: any) => b.type == 'null') ? p : {...p, anyOf: [...p.anyOf, {type: 'null'}]};
  const {description, ...rest} = p;
  return {anyOf: [rest, {type: 'null'}], ...(description && {description})};
};

// a `$defs` entry that reaches itself through `$ref`s (or a `#` root reference)
const recursive = (s: any): boolean => {
  const defs = s.$defs || {}, refs = (x: any): string[] => [...JSON.stringify(x ?? null).matchAll(/"\$ref":"#(?:\/\$defs\/([^"]*))?"/g)].map(m => m[1] ?? '#');
  const to = (a: string, b: string, seen: Set<string>): boolean => !seen.has(a) && (seen.add(a), refs(defs[a]).some(n => n == b || (n in defs && to(n, b, seen))));
  return refs(s).includes('#') || Object.keys(defs).some(k => to(k, k, new Set()));
};

/**
 * `{ schema, errors, optional, unions }`: a provider's strict form of a portable schema, or why
 * there is none. `left` (the transports'): what the request has left of the provider's
 * per-request limits; a schema that fits is counted against it (`tool`: it is a tool), one that
 * doesn't gets an error
 */
export function strictSchemas(schema: any, dialect: StrictDialect = 'openai', left?: StrictLimits, tool?: boolean): Strictified {
  const errors: string[] = [], ant = dialect == 'anthropic';
  let optional = 0, unions = 0;
  if (schema?.type != 'object') errors.push('the root is not an object');
  if (ant && schema && recursive(schema)) errors.push('a recursive schema has no strict form');
  const out = walk(schema, o => {
    let moved: any = {};
    if (ant) {
      moved = anthropicKeywords(o);
      if (!o.type && !o.anyOf && !o.allOf && !o.$ref && !o.enum && !('const' in o) && !o.properties) errors.push('a value of any type has no strict form');
    } else {
      for (const k of DROP) if (k in o) { moved[k] = o[k]; delete o[k]; }
      if (o.format && !FORMATS.includes(o.format)) { moved.format = o.format; delete o.format; }
      if (o.prefixItems) { moved.prefixItems = 'tuple'; o.items = {anyOf: o.prefixItems}; delete o.prefixItems; }
    }
    if (o.items === false) delete o.items;
    if (o.type == 'object' || o.properties) {
      if (o.additionalProperties && o.additionalProperties !== false) errors.push('a record (additionalProperties with a schema) has no strict form');
      const props = o.properties ||= {}, req = new Set(o.required || []);
      for (const k in props) {
        const p = props[k];
        if (p?.anyOf || Array.isArray(p?.type)) unions++;
        if (!req.has(k)) { optional++; if (!ant) props[k] = nullable(p); }
      }
      if (!ant) o.required = Object.keys(props);
      o.additionalProperties = false;
    }
    return describe(o, moved);
  });
  if (left && !errors.length) {
    if ((tool && left.tools < 1) || left.optional < optional || left.unions < unions) errors.push('over the per-request strict limits (20 tools, 24 optional and 16 union-typed parameters)');
    else { if (tool) left.tools--; left.optional -= optional; left.unions -= unions; }
  }
  return {schema: out, errors, optional, unions};
}

const acceptsNull = (p: any, root: any): boolean => {
  p = p?.$ref ? resolve(p, root) : p;
  return !!p && (p.type == 'null' || (Array.isArray(p.type) && p.type.includes('null')) || (p.enum || []).includes(null) ||
    p.const === null || (p.anyOf || p.oneOf || []).some((b: any) => acceptsNull(b, root)));
};

/** strict-mode JSON -> what the original schema accepts: nulls for optional, non-nullable keys dropped */
export function unstrict(value: any, schema: any, root: any = schema): any {
  if (schema?.$ref) schema = resolve(schema, root);
  if (!schema || value == null || typeof value != 'object') return value;
  if (Array.isArray(value)) return schema.items ? value.map(x => unstrict(x, schema.items, root)) : value;
  const out = {...value};
  for (const b0 of schema.anyOf || schema.oneOf || [schema]) {
    const b = b0?.$ref ? resolve(b0, root) : b0, req = new Set(b?.required || []);
    for (const k in b?.properties) {
      if (!(k in out)) continue;
      if (out[k] === null && !req.has(k) && !acceptsNull(b.properties[k], root)) delete out[k];
      else out[k] = unstrict(out[k], b.properties[k], root);
    }
  }
  return out;
}
