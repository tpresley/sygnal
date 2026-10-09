import {outputJsonSchema} from '../chat/output';
import {strictify, unstrict} from '../schema/strict';
import {dev} from './shared';

/*
 * PLAN-6 L-2: a request's tools and structured output for the OpenAI-shaped transports
 * (openResponses, chatCompletions), with the opt-in strict layer (D266, 0-S4):
 * - `strict` off (default): each tool's portable `inputSchema` as is, `strict: false` (OpenAI's
 *   Responses API defaults function tools to strict, which rejects most portable schemas);
 * - `strict: true`: each schema through strictify(); one that has no strict form (a record, a
 *   non-object root) is sent non-strict on its own (SYG675, dev info, once per tool and
 *   transport), the others strict. Tool calls on strict tools go through unstrict() before the
 *   driver sees them; the structured output's nulls are dropped by the driver (chat/output.ts).
 */

export interface Prepared {
  tools: Array<{name: string; description?: string; parameters: any; strict: boolean}>;
  output?: {schema: any; strict: boolean};
  /** a tool call's arguments as the original schema expects them */
  input(name: string, input: any): any;
}

const EMPTY = {type: 'object', properties: {}};

export function prepare(req: any, strict: boolean | undefined, seen: Set<string>): Prepared {
  const sent: Record<string, any> = {};
  const conv = (what: string, schema: any) => {
    if (!strict) return {schema, strict: false};
    const s = strictify(schema);
    if (!s.errors.length) return {schema: s.schema, strict: true};
    if (!seen.has(what)) { seen.add(what); dev('SYG675', req, {tool: what, errors: s.errors}); }
    return {schema, strict: false};
  };
  const tools = Object.entries(req.tools || {}).map(([name, t]: [string, any]) => {
    const c = conv(name, t?.inputSchema || EMPTY);
    if (c.strict) sent[name] = t.inputSchema;
    return {name, ...(t?.description && {description: t.description}), parameters: c.schema, strict: c.strict};
  });
  const o = req.output !== undefined ? outputJsonSchema(req.output) : undefined;
  return {
    tools,
    ...(o && {output: conv('(output)', o.schema)}),
    input: (name, input) => sent[name] ? unstrict(input, sent[name]) : input,
  };
}
