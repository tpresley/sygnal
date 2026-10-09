import {isStandardSchema, validateWith} from '../../standardSchema';
import {toJsonSchema} from '../schema/index';
import {unstrict} from '../schema/strict';

/*
 * PLAN-6 L-1 structured output (0-S4, G-604): a request's `output` is a Standard Schema with
 * Standard JSON Schema (or 1-A's jsonSchema()). The transport sends `outputJsonSchema(output)`;
 * the driver reads the reply text with `readOutput()` and puts the validated value on `ok`
 * (a failure is the `error` reply with `issues`).
 *
 * The JSON Schema comes from A-1's schema module (toJsonSchema: the portable normalization,
 * cached per schema object, `{ value }` wrapping; jsonSchema() for plain JSON Schema).
 */

/** the JSON Schema a transport sends for `output`: `{ schema, wrapped }` (a non-object root wrapped as `{ value }`), or undefined */
export function outputJsonSchema(output: any): {schema: Record<string, any>; wrapped: boolean} | undefined {
  const c = toJsonSchema(output);
  return c.schema ? {schema: c.schema, wrapped: !!c.wrapped} : undefined;
}

const invalid = (message: string) => Object.assign(new Error(message), {name: 'ValidationError', issues: [{message}]});

/**
 * the structured output in a reply's text: JSON (a ```json fence allowed), unwrapped from
 * `{ value }` when the schema was wrapped (a bare value accepted too), then validated. Nulls for
 * keys the schema leaves optional and doesn't allow null for are dropped first (L-2: a transport's
 * strict mode makes the model send them; small models send them too), as `undefined` would be
 */
export async function readOutput(output: any, text: string): Promise<any> {
  let v: any;
  const body = text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1');
  try { v = JSON.parse(body); } catch (_) { throw invalid(`The structured output is not JSON: ${body.length > 80 ? body.slice(0, 80) + '…' : body}`); }
  const js = outputJsonSchema(output);
  if (js) v = unstrict(v, js.schema);
  if (js?.wrapped && v && typeof v == 'object' && !Array.isArray(v) && Object.keys(v).length == 1 && 'value' in v) v = v.value;
  return isStandardSchema(output) ? validateWith(output, v) : v;
}
