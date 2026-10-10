import {post, sse, json, partsOf, toolName, toolOutput} from './shared';
import type {HttpOptions} from './shared';
import {prepare} from './tools';
import type {StrictOption} from './tools';
import {anthropicCompatible} from '../schema/strict';

/*
 * PLAN-6 L-2 (wave 2): anthropicMessages({ baseURL?, model, maxTokens?, headers?, fetch?, body?,
 * strict?, serverTools?, dangerouslyAllowBrowser? }), a chat transport for Anthropic's Messages
 * API SSE (checked against @anthropic-ai/sdk 0.131.0's types): Claude through the app's proxy,
 * or Ollama's Anthropic-compatible endpoint. POST `${baseURL}/messages` (baseURL default '/v1')
 * with `stream: true`, `anthropic-version: 2023-06-01` (and
 * `anthropic-dangerous-direct-browser-access` with dangerouslyAllowBrowser).
 *
 * Request: `instructions` and `system` messages as `system`; user / assistant messages as content
 * blocks (text; images and PDFs as image / document blocks from a URL or a data URL; signed
 * reasoning parts as thinking / redacted_thinking; a tool part with a result as a tool_use block
 * in the assistant message and a tool_result block in a user message after it, one assistant
 * message per step; a server tool part as server_tool_use + its result block as received;
 * consecutive messages of one role merged); `tools` as custom tools (`input_schema`), plus
 * `serverTools` (Anthropic server tools, e.g. `{ type: 'web_search_20260209', name: 'web_search' }`)
 * as is; `output` as `output_config.format` json_schema; `max_tokens` from the request's
 * `maxTokens`, the option, or 16000; `body` merged in.
 *
 * Strict (D266, D285): `strict: strictSchemas` sends tools `strict: true` with schemas in
 * Anthropic's subset and the `output` schema in it; a schema without a strict form, or one over
 * Anthropic's per-request limits (20 strict tools, 24 optional and 16 union-typed parameters
 * across the strict schemas, G-609), is sent non-strict on its own (SYG675).
 *
 * Compatibility (G-635, always on): `output_config.format` is always constrained decoding, so a
 * non-strict `output` schema goes through anthropicCompatible() (../schema/strict.ts): keywords
 * outside Anthropic's subset (numeric / string bounds, pattern, uniqueItems, not, if/then, ...)
 * move into the description, oneOf becomes anyOf, objects get `additionalProperties: false`. The
 * driver validates the reply against the original schema. Non-strict tools' `input_schema` is sent
 * as is: the API takes any JSON Schema (draft 2020-12) there, and the keywords guide the model
 * (A-1's normalization already makes the root an object, which the API requires).
 *
 * Events: message_start -> start (the message id, input usage); text_delta -> text;
 * thinking_delta -> reasoning, and its signature (signature_delta) closes the part with
 * `providerMetadata: { anthropic: { signature } }` (a redacted_thinking block: `{ redactedData }`)
 * so the next request can send it back (Claude requires it in a tool loop); tool_use with its
 * input_json_delta -> a tool call at content_block_stop; server_tool_use -> an `executed` tool
 * call, its `*_tool_result` block -> that call's result (the block itself); message_delta ->
 * the stop reason and output usage; message_stop (or the end of the stream) -> finish; an
 * `error` event -> a thrown Error. Citations and unknown events are ignored.
 */

export interface AnthropicMessagesOptions extends HttpOptions {
  baseURL?: string;
  model?: string;
  maxTokens?: number;
  strict?: StrictOption;
  serverTools?: any[];
}

const REASONS: Record<string, string> = {end_turn: 'stop', stop_sequence: 'stop', pause_turn: 'stop', tool_use: 'tool-calls', max_tokens: 'length', model_context_window_exceeded: 'length', refusal: 'content-filter'};
// G-609: platform.claude.com structured outputs, "Schema complexity limits"
const LIMITS = {tools: 20, optional: 24, unions: 16};
const DATA = /^data:([^;,]+)(;base64)?,(.*)$/;

const source = (url: string) => {
  const m = DATA.exec(url);
  return m && m[2] ? {type: 'base64', media_type: m[1], data: m[3]} : {type: 'url', url};
};

/** a message as Anthropic messages (an assistant message with tool results: one per step, results in user messages) */
export function toAnthropic(m: any): any[] {
  const out: any[] = [];
  let content: any[] = [], results: any[] = [];
  const flush = () => {
    if (content.length) out.push({role: m.role, content});
    if (results.length) out.push({role: 'user', content: results});
    content = []; results = [];
  };
  for (const p of partsOf(m)) {
    const name = toolName(p), meta = p.providerMetadata?.anthropic;
    if (results.length && !(name && p.input !== undefined)) flush();
    if (p.type == 'text') content.push({type: 'text', text: p.text});
    else if (p.type == 'file' && m.role == 'user') {
      const image = p.mediaType?.startsWith('image/');
      if (image || p.mediaType == 'application/pdf') content.push({type: image ? 'image' : 'document', source: source(p.url)});
    } else if (p.type == 'reasoning' && m.role == 'assistant' && meta) {
      if (meta.signature) content.push({type: 'thinking', thinking: p.text, signature: meta.signature});
      else if (meta.redactedData) content.push({type: 'redacted_thinking', data: meta.redactedData});
    } else if (name && p.input !== undefined && m.role == 'assistant') {
      if (p.providerExecuted) {
        content.push({type: 'server_tool_use', id: p.toolCallId, name, input: p.input});
        if (/_tool_result$/.test(p.output?.type)) content.push(p.output);
        continue;
      }
      const o = toolOutput(p);
      // a call with no result yet can't be sent: Anthropic needs its tool_result next
      if (o === undefined) continue;
      content.push({type: 'tool_use', id: p.toolCallId, name, input: p.input ?? {}});
      results.push({type: 'tool_result', tool_use_id: p.toolCallId, content: o, ...(p.state != 'output-available' && {is_error: true})});
    }
  }
  flush();
  return out;
}

export function anthropicMessages(options: AnthropicMessagesOptions = {}) {
  const seen = new Set<string>();
  const headers = async (req: any) => ({
    'anthropic-version': '2023-06-01',
    ...(options.dangerouslyAllowBrowser && {'anthropic-dangerous-direct-browser-access': 'true'}),
    ...(typeof options.headers == 'function' ? await options.headers(req) : options.headers),
  });
  return {
    async *stream(req: any, signal: AbortSignal): AsyncGenerator<any, void, any> {
      const p = prepare(req, options.strict, seen, 'anthropicMessages', 'anthropic', LIMITS);
      const system = [req.instructions, ...req.messages.filter((m: any) => m.role == 'system').map((m: any) => partsOf(m).filter(x => x.type == 'text').map(x => x.text).join(''))].filter(Boolean).join('\n\n');
      const messages: any[] = [];
      for (const m of req.messages.filter((m: any) => m.role != 'system').flatMap(toAnthropic)) {
        const last = messages[messages.length - 1];
        if (last?.role == m.role) last.content = [...last.content, ...m.content];
        else messages.push(m);
      }
      const tools = [...p.tools.map(({name, description, parameters, strict}) => ({name, ...(description && {description}), input_schema: parameters, ...(strict && {strict})})), ...(options.serverTools || [])];
      const res = await post((options.baseURL ?? '/v1').replace(/\/$/, '') + '/messages', {
        model: req.model ?? options.model,
        max_tokens: req.maxTokens ?? options.maxTokens ?? 16000,
        stream: true,
        ...(system && {system}),
        messages,
        ...(tools.length && {tools}),
        ...(p.output && {output_config: {format: {type: 'json_schema', schema: p.output.strict ? p.output.schema : anthropicCompatible(p.output.schema)}}}),
      }, req, signal, {...options, headers}, 'anthropicMessages');
      // content blocks by index: tool_use / server_tool_use input JSON, thinking signatures
      const blocks: any[] = [];
      // usage: message_start's, updated by message_delta's (cumulative counts)
      let reason: any, u: any, finished = false;
      const usage = () => {
        if (!u) return;
        const i = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), o = u.output_tokens ?? 0;
        return {inputTokens: i, outputTokens: o, totalTokens: i + o, ...(u.output_tokens_details?.thinking_tokens != null && {reasoningTokens: u.output_tokens_details.thinking_tokens})};
      };
      for await (const {data} of sse(res)) {
        const e = json(data), t = e?.type;
        if (typeof t != 'string') continue;
        if (t == 'message_start') {
          u = e.message?.usage;
          if (e.message?.id) yield {type: 'start', id: e.message.id};
        } else if (t == 'content_block_start') {
          const b = e.content_block || {};
          blocks[e.index] = {...b, json: ''};
          if (b.type == 'text' && b.text) yield {type: 'text', delta: b.text};
          else if (b.type == 'thinking' && b.thinking) yield {type: 'reasoning', delta: b.thinking};
          else if (b.type == 'redacted_thinking') yield {type: 'reasoning', delta: '', providerMetadata: {anthropic: {redactedData: b.data}}};
          else if (/_tool_result$/.test(b.type) && b.tool_use_id) yield {type: 'tool-result', id: b.tool_use_id, output: b};
        } else if (t == 'content_block_delta') {
          const d = e.delta || {}, b = blocks[e.index];
          if (d.type == 'text_delta') yield {type: 'text', delta: d.text};
          else if (d.type == 'thinking_delta') yield {type: 'reasoning', delta: d.thinking};
          else if (b && d.type == 'signature_delta') b.signature = d.signature;
          else if (b && d.type == 'input_json_delta') b.json += d.partial_json;
        } else if (t == 'content_block_stop') {
          const b = blocks[e.index];
          if (b?.type == 'thinking' && b.signature) yield {type: 'reasoning', delta: '', providerMetadata: {anthropic: {signature: b.signature}}};
          else if (b?.type == 'tool_use') yield {type: 'tool-call', id: b.id, name: b.name, input: p.input(b.name, b.json ? json(b.json) : b.input ?? {})};
          else if (b?.type == 'server_tool_use') yield {type: 'tool-call', id: b.id, name: b.name, input: b.json ? json(b.json) : b.input ?? {}, executed: true, providerExecuted: true};
        } else if (t == 'message_delta') {
          if (e.delta?.stop_reason) reason = REASONS[e.delta.stop_reason] ?? 'other';
          if (e.usage) u = {...u, ...e.usage};
        } else if (t == 'message_stop') {
          finished = true;
          yield {type: 'finish', reason, usage: usage()};
        } else if (t == 'error') {
          throw Object.assign(new Error('anthropicMessages: ' + (e.error?.message ?? 'the request failed')), {code: e.error?.type});
        }
      }
      if (!finished) yield {type: 'finish', reason, usage: usage()};
    },
  };
}
