import {post, sse, json, usageOf, partsOf, toolName, toolOutput} from './shared';
import type {HttpOptions} from './shared';
import {prepare} from './tools';
import type {StrictOption} from './tools';

/*
 * PLAN-6 L-2: chatCompletions({ baseURL?, model, headers?, fetch?, body?, strict?,
 * dangerouslyAllowBrowser? }), a chat transport for OpenAI's Chat Completions SSE, the lowest
 * common denominator of local servers (Ollama, llama.cpp, LM Studio, vLLM). POST
 * `${baseURL}/chat/completions` (baseURL default '/v1') with `stream: true` and
 * `stream_options.include_usage`.
 *
 * Request: `instructions` as the first system message; each message as Chat Completions
 * messages (an assistant message's text and tool calls as one message per step, followed by a
 * `tool` message per result); `tools` as function tools; `output` as `response_format`
 * json_schema; `body` merged in.
 *
 * Events: `delta.content` -> text; `delta.reasoning_content` / `delta.reasoning` (vLLM,
 * DeepSeek, Ollama) -> reasoning; `delta.tool_calls` accumulated by `index`, yielded in index
 * order when the choice finishes (or the stream ends); the usage chunk (empty `choices`) and
 * `finish_reason` -> finish; an `error` chunk -> a thrown Error; `[DONE]` ends the stream.
 */

export interface ChatCompletionsOptions extends HttpOptions {
  baseURL?: string;
  model?: string;
  strict?: StrictOption;
}

const REASONS: Record<string, string> = {stop: 'stop', length: 'length', tool_calls: 'tool-calls', function_call: 'tool-calls', content_filter: 'content-filter'};

/** a message as Chat Completions messages */
export function toMessages(m: any): any[] {
  const out: any[] = [];
  let text = '', calls: any[] = [], results: any[] = [], content: any[] = [];
  const flush = () => {
    if (m.role == 'assistant') {
      if (text || calls.length) out.push({role: 'assistant', content: text || null, ...(calls.length && {tool_calls: calls})});
    } else if (text || content.length) {
      out.push({role: m.role, content: content.length ? [...(text ? [{type: 'text', text}] : []), ...content] : text});
    }
    out.push(...results);
    text = ''; calls = []; results = []; content = [];
  };
  for (const p of partsOf(m)) {
    const name = toolName(p);
    if (p.type == 'text') {
      if (calls.length) flush();
      text += p.text;
    } else if (p.type == 'file' && m.role == 'user') {
      content.push(p.mediaType?.startsWith('image/') ? {type: 'image_url', image_url: {url: p.url}} : {type: 'file', file: {file_data: p.url, ...(p.filename && {filename: p.filename})}});
    } else if (name && p.input !== undefined && m.role == 'assistant') {
      calls.push({id: p.toolCallId, type: 'function', function: {name, arguments: JSON.stringify(p.input ?? {})}});
      const o = toolOutput(p);
      if (o !== undefined) results.push({role: 'tool', tool_call_id: p.toolCallId, content: o});
    }
  }
  flush();
  return out;
}

export function chatCompletions(options: ChatCompletionsOptions = {}) {
  const seen = new Set<string>();
  return {
    async *stream(req: any, signal: AbortSignal): AsyncGenerator<any, void, any> {
      const p = prepare(req, options.strict, seen, 'chatCompletions');
      const res = await post((options.baseURL ?? '/v1').replace(/\/$/, '') + '/chat/completions', {
        model: req.model ?? options.model,
        stream: true,
        stream_options: {include_usage: true},
        messages: [...(req.instructions ? [{role: 'system', content: req.instructions}] : []), ...req.messages.flatMap(toMessages)],
        ...(p.tools.length && {tools: p.tools.map(({name, description, parameters, strict}) => ({type: 'function', function: {name, ...(description && {description}), parameters, ...(strict && {strict})}}))}),
        ...(p.output && {response_format: {type: 'json_schema', json_schema: {name: 'output', schema: p.output.schema, ...(p.output.strict && {strict: true})}}}),
      }, req, signal, options, 'chatCompletions');
      // tool calls by index, as their deltas arrive
      let calls: any[] = [], reason: any, usage: any, started = false;
      const done = function* () {
        for (const c of calls) if (c) yield {type: 'tool-call', id: c.id, name: c.name, input: p.input(c.name, json(c.args))};
        calls = [];
      };
      for await (const {data} of sse(res)) {
        if (data == '[DONE]') break;
        const e = json(data);
        if (!e || typeof e != 'object') continue;
        if (e.error) throw Object.assign(new Error('chatCompletions: ' + (e.error.message ?? e.error)), {code: e.error.code});
        if (!started && e.id) { started = true; yield {type: 'start', id: e.id}; }
        if (e.usage) usage = usageOf(e.usage);
        const ch = e.choices?.[0];
        if (!ch) continue;
        const d = ch.delta || {}, r = d.reasoning_content ?? d.reasoning;
        if (typeof r == 'string' && r) yield {type: 'reasoning', delta: r};
        if (typeof d.content == 'string' && d.content) yield {type: 'text', delta: d.content};
        for (const t of d.tool_calls || []) {
          const c = calls[t.index ?? 0] ||= {id: t.id, name: '', args: ''};
          if (t.id) c.id = t.id;
          if (t.function?.name) c.name = t.function.name;
          if (t.function?.arguments) c.args += t.function.arguments;
        }
        if (ch.finish_reason) { reason = REASONS[ch.finish_reason] ?? 'other'; yield* done(); }
      }
      yield* done();
      yield {type: 'finish', reason, usage};
    },
  };
}
