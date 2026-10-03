/*
 * Standard Schema (https://standardschema.dev) without a dependency: any validator that exposes
 * `schema['~standard'].validate(value)` (zod, valibot, arktype, ...), sync or async.
 * Used by makeFetchDriver's `validate` (PLAN-3 §1.6, D80); PLAN-4's forms and server functions
 * reuse it.
 */

/** One validation failure, as the schema reports it */
export type SchemaIssue = {message: string; path?: ReadonlyArray<PropertyKey | {key: PropertyKey}>};

/** true for a Standard Schema object (it has `~standard.validate`) */
export const isStandardSchema = (schema: any): boolean =>
  !!schema && (typeof schema == 'object' || typeof schema == 'function') && typeof schema['~standard']?.validate == 'function';

/**
 * Validates `value`: resolves with the schema's (possibly transformed) value, or rejects with an
 * Error named 'ValidationError' whose `issues` are the schema's issues. A `schema` that isn't a
 * Standard Schema rejects with a TypeError.
 */
export const validateWith = async (schema: any, value: any): Promise<any> => {
  const r = await schema['~standard'].validate(value);
  if (!r.issues) return r.value;
  const e: any = new Error('Validation failed: ' + r.issues.map((i: SchemaIssue) => i.message).join('; '));
  e.name = 'ValidationError';
  e.issues = r.issues;
  throw e;
};
