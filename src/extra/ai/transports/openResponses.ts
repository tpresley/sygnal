import {post, sse, json, usageOf, partsOf, toolName, toolOutput} from './shared';
import type {HttpOptions} from './shared';
import {prepare} from './tools';
import type {StrictOption} from './tools';

/*
 * PLAN-6 L-2: openResponses({ baseURL?, model, headers?, fetch?, body?, strict?,
 * dangerouslyAllowBrowser? }), a chat transport for the Open Responses spec (openresponses.org)
 * and OpenAI's Responses API: Ollama, vLLM, OpenRouter, OpenAI. POST `${baseURL}/responses`
 * (baseURL default '/v1', the app's own origin) with `stream: true`.
 *
 * Request: `instructions`, `input` items from the messages (text and file parts as message
 * content, `tool-<name>` parts as `function_call` items followed by their `function_call_output`
 * when they have a result; reasoning, data and source parts stay in the app), `tools` as
 * function tools, `output` as `text.format` json_schema; `body` (transport and request) merged in.
 *
 * Events: output_text deltas (and refusal deltas) -> text; reasoning_text and
 * reasoning_summary_text deltas -> reasoning; a function_call item -> one tool call when its
 * arguments are done (`function_call_arguments.done` or `output_item.done`, whichever is first);
 * response.completed / incomplete -> finish (reason, usage); response.failed and error -> a
 * thrown Error. Every other event is ignored, as the spec requires.
 */

export interface OpenResponsesOptions extends HttpOptions {
  baseURL?: string;
  model?: string;
  strict?: StrictOption;
}

const REASONING = /^response\.reasoning(_summary)?_text\.delta$/;

/** a message's parts as Open Responses input items */
export function toItems(m: any): any[] {
  const out: any[] = [];
  let content: any[] = [];
  const flush = () => {
    if (!content.length) return;
    out.push({role: m.role, content: content.every(c => c.type != 'input_image' && c.type != 'input_file') ? content.map(c => c.text).join('') : content});
    content = [];
  };
  for (const p of partsOf(m)) {
    const name = toolName(p);
    if (p.type == 'text') content.push({type: m.role == 'assistant' ? 'output_text' : 'input_text', text: p.text});
    else if (p.type == 'file' && m.role == 'user') content.push(p.mediaType?.startsWith('image/') ? {type: 'input_image', image_url: p.url} : {type: 'input_file', file_url: p.url, ...(p.filename && {filename: p.filename})});
    else if (name && p.input !== undefined) {
      flush();
      out.push({type: 'function_call', call_id: p.toolCallId, name, arguments: JSON.stringify(p.input ?? {})});
      const o = toolOutput(p);
      if (o !== undefined) out.push({type: 'function_call_output', call_id: p.toolCallId, output: o});
    }
  }
  flush();
  return out;
}

export function openResponses(options: OpenResponsesOptions = {}) {
  const seen = new Set<string>();
  return {
    async *stream(req: any, signal: AbortSignal): AsyncGenerator<any, void, any> {
      const p = prepare(req, options.strict, seen, 'openResponses');
      const res = await post((options.baseURL ?? '/v1').replace(/\/$/, '') + '/responses', {
        model: req.model ?? options.model,
        stream: true,
        ...(req.instructions && {instructions: req.instructions}),
        input: req.messages.flatMap(toItems),
        ...(p.tools.length && {tools: p.tools.map(t => ({type: 'function', ...t}))}),
        ...(p.output && {text: {format: {type: 'json_schema', name: 'output', schema: p.output.schema, strict: p.output.strict}}}),
      }, req, signal, options, 'openResponses');
      // function_call items by item id; `done` once yielded
      const calls: Record<string, any> = {};
      let called = 0;
      const call = (id: string, item: any, args?: string) => {
        const c = calls[id] ||= {...item};
        if (c.done) return;
        c.done = 1;
        called++;
        const name = c.name ?? item?.name;
        return {type: 'tool-call', id: c.call_id ?? item?.call_id ?? id, name, input: p.input(name, json(args ?? item?.arguments ?? c.args))};
      };
      for await (const {data} of sse(res)) {
        if (data == '[DONE]') break;
        const e = json(data), t = e?.type;
        if (typeof t != 'string') continue;
        if (t == 'response.output_text.delta' || t == 'response.refusal.delta' || REASONING.test(t)) {
          yield {type: t.includes('reasoning') ? 'reasoning' : 'text', delta: e.delta};
        } else if (t == 'response.created') {
          if (e.response?.id) yield {type: 'start', id: e.response.id};
        } else if (t == 'response.output_item.added' && e.item?.type == 'function_call') {
          calls[e.item.id] = {...e.item, args: e.item.arguments || ''};
        } else if (t == 'response.function_call_arguments.delta' && calls[e.item_id]) {
          calls[e.item_id].args += e.delta;
        } else if (t == 'response.function_call_arguments.done' || (t == 'response.output_item.done' && e.item?.type == 'function_call')) {
          const ev = call(e.item_id ?? e.item.id, e.item, e.arguments);
          if (ev) yield ev;
        } else if (t == 'response.completed' || t == 'response.incomplete') {
          const why = e.response?.incomplete_details?.reason;
          yield {type: 'finish', reason: t == 'response.completed' ? (called ? 'tool-calls' : 'stop') : why == 'content_filter' ? 'content-filter' : why == 'max_output_tokens' ? 'length' : 'other', usage: usageOf(e.response?.usage)};
        } else if (t == 'response.failed' || t == 'error') {
          const err = e.response?.error ?? e.error ?? e;
          throw Object.assign(new Error('openResponses: ' + (err.message ?? 'the response failed')), {code: err.code});
        }
      }
    },
  };
}
