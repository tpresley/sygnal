import {isStandardSchema, validateWith} from '../../standardSchema';

/*
 * PLAN-6 L-1 structured output (0-S4, G-604): a request's `output` is a Standard Schema with
 * Standard JSON Schema (or 1-A's jsonSchema()). The transport sends `outputJsonSchema(output)`;
 * the driver reads the reply text with `readOutput()` and puts the validated value on `ok`
 * (a failure is the `error` reply with `issues`).
 *
 * SEAM for 1-A (the A-1 schema module): `outputJsonSchema` below is a stub. It takes the
 * input-side Standard JSON Schema as is (draft 2020-12, `$schema` dropped) and wraps a non-object
 * root as `{ value }`. 1-A replaces its body with the portable normalization layer (oneOf → anyOf,
 * Zod's integer bounds, `$ref: '#'`, caching per schema object, SYG243 for lossy parts) and
 * jsonSchema()'s plain JSON Schema; the signature and `wrapped` stay.
 */

/** the JSON Schema a transport sends for `output`: `{ schema, wrapped }` (a non-object root wrapped as `{ value }`), or undefined */
export function outputJsonSchema(output: any): {schema: Record<string, any>; wrapped: boolean} | undefined {
  let s: any;
  try {
    const std = output && output['~standard'];
    s = std && std.jsonSchema && typeof std.jsonSchema.input == 'function'
      ? std.jsonSchema.input({target: 'draft-2020-12'})
      : output && output.jsonSchema;
  } catch (_) {
    return;
  }
  if (!s || typeof s != 'object') return;
  const {$schema, ...schema} = s;
  return schema.type === 'object'
    ? {schema, wrapped: false}
    : {schema: {type: 'object', properties: {value: schema}, required: ['value'], additionalProperties: false}, wrapped: true};
}

const invalid = (message: string) => Object.assign(new Error(message), {name: 'ValidationError', issues: [{message}]});

/**
 * the structured output in a reply's text: JSON (a ```json fence allowed), unwrapped from
 * `{ value }` when the schema was wrapped (a bare value accepted too), then validated
 */
export async function readOutput(output: any, text: string): Promise<any> {
  let v: any;
  const body = text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1');
  try { v = JSON.parse(body); } catch (_) { throw invalid(`The structured output is not JSON: ${body.length > 80 ? body.slice(0, 80) + '…' : body}`); }
  if (outputJsonSchema(output)?.wrapped && v && typeof v == 'object' && !Array.isArray(v) && Object.keys(v).length == 1 && 'value' in v) v = v.value;
  return isStandardSchema(output) ? validateWith(output, v) : v;
}
