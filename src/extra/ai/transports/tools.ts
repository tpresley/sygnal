import {outputJsonSchema} from '../chat/output';
import {unstrict} from '../schema/strict';
import type {StrictDialect, Strictified, StrictLimits} from '../schema/strict';
import {dev} from './shared';

/*
 * PLAN-6 L-2: a request's tools and structured output for the OpenAI- and Anthropic-backed
 * transports (openResponses, chatCompletions, anthropicMessages), with the opt-in strict layer
 * (D266, D285, 0-S4):
 * - `strict` off (default): each tool's portable `inputSchema` as is, `strict: false` (OpenAI's
 *   Responses API defaults function tools to strict, which rejects most portable schemas);
 * - `strict: strictSchemas` (imported from sygnal/ai, so apps that don't use it don't carry it):
 *   each schema through it in the transport's dialect; one that has no strict form (a record, a
 *   non-object root; for Anthropic also a recursive or untyped one, or one over Anthropic's
 *   per-request limits, G-609) is sent non-strict on its own (SYG675, dev info, once per tool and
 *   transport), the others strict. Tool calls on strict tools go through unstrict() before the
 *   driver sees them; the structured output's nulls are dropped by the driver (chat/output.ts).
 * - `strict: true` (anything that isn't the strictSchemas function) is SYG672 (dev, once per
 *   transport): the request goes non-strict.
 */

export type StrictOption = ((schema: any, dialect?: StrictDialect, left?: StrictLimits, tool?: boolean) => Strictified) | boolean | undefined;

export interface Prepared {
  tools: Array<{name: string; description?: string; parameters: any; strict: boolean}>;
  output?: {schema: any; strict: boolean};
  /** a tool call's arguments as the original schema expects them */
  input(name: string, input: any): any;
}

const EMPTY = {type: 'object', properties: {}};

export function prepare(req: any, strict: StrictOption, seen: Set<string>, transport: string, dialect: StrictDialect = 'openai', limits?: StrictLimits): Prepared {
  const sent: Record<string, any> = {};
  if (strict && typeof strict != 'function' && !seen.has('')) { seen.add(''); dev('SYG672', req, {transport}); }
  const fn = typeof strict == 'function' ? strict : undefined;
  // what the request has left of `limits` (strictSchemas counts it down)
  const left = limits && {...limits};
  const conv = (what: string, schema: any) => {
    if (!fn) return {schema, strict: false};
    const s = fn(schema, dialect, left, what != '(output)');
    if (!s.errors.length) return {schema: s.schema, strict: true};
    if (!seen.has(what)) { seen.add(what); dev('SYG675', req, {tool: what, errors: s.errors}); }
    return {schema, strict: false};
  };
  // the output first: it is the whole reply, the tools are options
  const o = req.output !== undefined ? outputJsonSchema(req.output) : undefined;
  const output = o && conv('(output)', o.schema);
  const tools = Object.entries(req.tools || {}).map(([name, t]: [string, any]) => {
    const c = conv(name, t?.inputSchema || EMPTY);
    if (c.strict) sent[name] = t.inputSchema;
    return {name, ...(t?.description && {description: t.description}), parameters: c.schema, strict: c.strict};
  });
  return {
    tools,
    ...(output && {output}),
    input: (name, input) => sent[name] ? unstrict(input, sent[name]) : input,
  };
}
