import {resolve} from './index';

/*
 * PLAN-6 L-2 (0-S4 layer 2, D266): the opt-in strict schema layer of the OpenAI-shaped transports
 * (`strict: true` on openResponses / chatCompletions). Only those transports import strictify, so
 * apps that never use them pay nothing; unstrict is also used by the chat driver's structured
 * output (./chat/output.ts), where it is always safe (see unstrict).
 *
 * strictify(schema) turns a portable tool / output schema (./index.ts normalize) into OpenAI's
 * strict subset (developers.openai.com structured outputs, "Supported schemas", 2026-10):
 * - `additionalProperties: false` on every object, every property required, the optional ones
 *   made nullable (a type array + null in the enum, or `anyOf [..., { type: 'null' }]`);
 * - unsupported keywords and formats moved into the description as JSON (the model still reads
 *   them; validation still enforces them), a tuple's `prefixItems` turned into `items: { anyOf }`.
 * It returns `errors` when the schema has no strict form (a record: `additionalProperties` with a
 * schema; a non-object root): the transport then sends that tool non-strict (SYG675, dev info).
 *
 * unstrict(value, schema) drops the nulls a strict schema forced the model to send for keys the
 * original schema leaves optional and doesn't allow null for, so validation sees the original
 * shape. The transports run it on every tool call they sent strict.
 */

const DROP = ['allOf', 'not', 'if', 'then', 'else', 'dependentRequired', 'dependentSchemas', 'patternProperties',
  'unevaluatedProperties', 'propertyNames', 'minProperties', 'maxProperties', 'unevaluatedItems', 'contains',
  'minContains', 'maxContains', 'uniqueItems', 'default', 'examples', 'title'];
const FORMATS = ['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'ipv4', 'ipv6', 'uuid'];

const nullable = (p: any): any => {
  const t = p.type, withEnum = (o: any) => p.enum ? {...o, enum: [...p.enum, null]} : o;
  if (Array.isArray(t)) return t.includes('null') ? p : withEnum({...p, type: [...t, 'null']});
  if (typeof t == 'string' && !p.$ref) return withEnum({...p, type: [t, 'null']});
  if (p.anyOf) return p.anyOf.some((b: any) => b.type == 'null') ? p : {...p, anyOf: [...p.anyOf, {type: 'null'}]};
  const {description, ...rest} = p;
  return {anyOf: [rest, {type: 'null'}], ...(description && {description})};
};

// every subschema, bottom-up; the values of `properties` / `$defs` maps are schemas, the maps
// themselves aren't (a property named `title` or `default` stays a property)
const MAPS = /^(properties|\$defs|definitions|patternProperties|dependentSchemas)$/;
const each = (s: any, f: (o: any) => any): any => {
  if (Array.isArray(s)) return s.map(x => each(x, f));
  if (!s || typeof s != 'object') return s;
  const o: any = {};
  for (const k in s) o[k] = MAPS.test(k) && s[k] && typeof s[k] == 'object'
    ? Object.fromEntries(Object.entries(s[k]).map(([n, v]) => [n, each(v, f)])) : each(s[k], f);
  return f(o);
};

/** `{ schema, errors }`: OpenAI's strict form of a portable schema, or why there is none */
export function strictify(schema: any): {schema: any; errors: string[]} {
  const errors: string[] = [];
  if (schema?.type != 'object') errors.push('the root is not an object');
  const out = each(schema, o => {
    const moved: any = {};
    for (const k of DROP) if (k in o) { moved[k] = o[k]; delete o[k]; }
    if (o.format && !FORMATS.includes(o.format)) { moved.format = o.format; delete o.format; }
    if (o.prefixItems) { moved.prefixItems = 'tuple'; o.items = {anyOf: o.prefixItems}; delete o.prefixItems; }
    if (o.items === false) delete o.items;
    if (o.type == 'object' || o.properties) {
      if (o.additionalProperties && o.additionalProperties !== false) errors.push('a record (additionalProperties with a schema) has no strict form');
      const props = o.properties ||= {}, req = new Set(o.required || []);
      for (const k in props) if (!req.has(k)) props[k] = nullable(props[k]);
      o.required = Object.keys(props);
      o.additionalProperties = false;
    }
    if (Object.keys(moved).length) {
      const hint = JSON.stringify(moved);
      o.description = o.description ? o.description + ' ' + hint : hint;
    }
    return o;
  });
  return {schema: out, errors};
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
