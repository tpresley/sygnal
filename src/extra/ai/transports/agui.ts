import {post, sse, json, partsOf, toolName, toolOutput} from './shared';
import type {HttpOptions} from './shared';
import {outputJsonSchema} from '../chat/output';

/*
 * PLAN-6 L-2 (wave 2): agui(url, { threadId?, state?, context?, headers?, fetch?, body?,
 * dangerouslyAllowBrowser? }), a chat transport for an AG-UI agent endpoint (the Agent-User
 * Interaction protocol: TanStack AI, CopilotKit runtimes, LangGraph / Mastra / Pydantic AI
 * servers), checked against @ag-ui/core 1.0.2's types. POST `url` with a RunAgentInput, SSE back
 * (`data: <event JSON>`).
 *
 * Request (RunAgentInput): `threadId` (the request's `chatId`, the option, or one per transport),
 * a new `runId`, `state` (the request's `state`, else the latest state this transport saw, else
 * the option, else {}), `messages` (the instructions as a system message; user / assistant / tool
 * messages: an assistant message per step with its `toolCalls`, a `tool` message per result),
 * `tools` (`{ name, description, parameters }`: client tools the agent may call), `context` (the
 * option), `forwardedProps` (`{ model?, output? }`: the requested model and the `output` JSON
 * Schema, for servers that use them); `body` merged in.
 *
 * Events -> ChatEvents:
 * - TEXT_MESSAGE_START / CONTENT / CHUNK -> start (the first message id) and text (messages with a
 *   role other than assistant are skipped); REASONING_MESSAGE_CONTENT / CHUNK -> reasoning;
 * - TOOL_CALL_START / ARGS / END (or CHUNK) -> a tool call, held until the step ends: a call the
 *   agent answers (TOOL_CALL_RESULT) is yielded `executed` + its result (the app doesn't run it), a
 *   call still open at STEP_FINISHED / RUN_FINISHED / the end of the stream (or when a new message
 *   starts) is a client tool call (the `tool` reply);
 * - STATE_SNAPSHOT / STATE_DELTA (RFC 6902, applied here) -> a `data-agui-state` part (id
 *   'state', so it replaces the previous one) holding the agent's whole current state;
 *   MESSAGES_SNAPSHOT -> a `data-agui-messages` part (id 'messages') with the agent's messages as
 *   sent (the app decides whether to adopt them); ACTIVITY_SNAPSHOT -> a `data-agui-activity` part
 *   (id: its message id);
 * - RUN_FINISHED -> finish ('tool-calls' after client calls, 'other' for an interrupt outcome,
 *   else 'stop'; usage summed); RUN_ERROR -> a thrown Error. Everything else is ignored.
 */

export interface AguiOptions extends HttpOptions {
  threadId?: string;
  state?: unknown;
  context?: Array<{description: string; value: string}>;
}

let n = 0;
const uid = (p: string) => `${p}_${Date.now().toString(36)}_${++n}`;
const clone = (v: any) => v === undefined ? v : JSON.parse(JSON.stringify(v));

/** RFC 6902 JSON Patch (add, remove, replace, move, copy; test ignored) on a copy of `doc` */
export function applyPatch(doc: any, ops: any[]): any {
  let root = clone(doc ?? {});
  const keys = (p: string) => p.split('/').slice(1).map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  const get = (k: string[]) => k.reduce((o, x) => o?.[x], root);
  const set = (k: string[], v: any, insert: boolean) => {
    if (!k.length) { root = v; return; }
    const parent = get(k.slice(0, -1)), last = k[k.length - 1];
    if (Array.isArray(parent)) last == '-' ? parent.push(v) : insert ? parent.splice(+last, 0, v) : (parent[+last] = v);
    else if (parent && typeof parent == 'object') parent[last] = v;
  };
  const del = (k: string[]) => {
    const parent = get(k.slice(0, -1)), last = k[k.length - 1], v = parent?.[last];
    if (Array.isArray(parent)) parent.splice(+last, 1); else if (parent) delete parent[last];
    return v;
  };
  for (const op of ops || []) {
    const to = keys(String(op.path ?? ''));
    if (op.op == 'add') set(to, clone(op.value), true);
    else if (op.op == 'replace') set(to, clone(op.value), false);
    else if (op.op == 'remove') del(to);
    else if (op.op == 'move') set(to, del(keys(op.from)), true);
    else if (op.op == 'copy') set(to, clone(get(keys(op.from))), true);
  }
  return root;
}

const textOf = (m: any) => partsOf(m).filter(p => p.type == 'text').map(p => p.text).join('');

/** a message as AG-UI messages (an assistant message per step with its toolCalls, then a tool message per result) */
export function toAgui(m: any, i: number): any[] {
  const id = m.id ?? `m${i}`;
  if (m.role != 'assistant') {
    const files = partsOf(m).filter(p => p.type == 'file');
    const text = textOf(m);
    return [{id, role: m.role, content: files.length && m.role == 'user'
      ? [...(text ? [{type: 'text', text}] : []), ...files.map(p => ({type: p.mediaType?.startsWith('image/') ? 'image' : 'document', source: {type: 'url', value: p.url, mimeType: p.mediaType}}))]
      : text}];
  }
  const out: any[] = [];
  let text = '', calls: any[] = [], results: any[] = [], step = 0;
  const flush = () => {
    if (text || calls.length) out.push({id: step ? `${id}_${step}` : id, role: 'assistant', ...(text && {content: text}), ...(calls.length && {toolCalls: calls})});
    out.push(...results);
    if (text || calls.length) step++;
    text = ''; calls = []; results = [];
  };
  for (const p of partsOf(m)) {
    const name = toolName(p);
    if (p.type == 'text') { if (calls.length) flush(); text += p.text; }
    else if (name && p.input !== undefined) {
      calls.push({id: p.toolCallId, type: 'function', function: {name, arguments: JSON.stringify(p.input ?? {})}});
      const o = toolOutput(p);
      if (o !== undefined) results.push({id: `${p.toolCallId}_result`, role: 'tool', toolCallId: p.toolCallId, content: o, ...(p.state == 'output-error' && {error: p.errorText ?? 'error'})});
    }
  }
  flush();
  return out;
}

export function agui(url: string, options: AguiOptions = {}) {
  const thread = options.threadId ?? uid('thread');
  let state: any = options.state;
  const headers = async (req: any) => ({accept: 'text/event-stream', ...(typeof options.headers == 'function' ? await options.headers(req) : options.headers)});
  return {
    async *stream(req: any, signal: AbortSignal): AsyncGenerator<any, void, any> {
      const o = req.output !== undefined ? outputJsonSchema(req.output) : undefined;
      const res = await post(url, {
        threadId: req.chatId ?? thread,
        runId: uid('run'),
        state: req.state ?? state ?? {},
        messages: [...(req.instructions ? [{id: 'instructions', role: 'system', content: req.instructions}] : []), ...req.messages.flatMap(toAgui)],
        tools: Object.entries(req.tools || {}).map(([name, t]: [string, any]) => ({name, description: t?.description ?? '', parameters: t?.inputSchema ?? {type: 'object', properties: {}}})),
        context: options.context ?? [],
        forwardedProps: {...(req.model && {model: req.model}), ...(o && {output: o})},
      }, req, signal, {...options, headers}, 'agui');
      // tool calls by id as they stream; `open`: ended calls not yet answered, in order
      const calls: Record<string, any> = {}, roles: Record<string, string> = {};
      let open: any[] = [], last: any, started = false, called = 0;
      const start = function* (id: any) { if (!started && id) { started = true; yield {type: 'start', id}; } };
      const release = function* () { for (const c of open) { called++; yield c; } open = []; };
      const take = (id: string) => {
        const i = open.findIndex(c => c.id === id);
        return i < 0 ? [] : [{...open.splice(i, 1)[0], executed: true}];
      };
      const end = (id: string) => {
        const c = calls[id];
        if (!c || c.done) return;
        c.done = 1;
        open.push({type: 'tool-call', id, name: c.name, input: json(c.args || '{}')});
      };
      for await (const {data} of sse(res)) {
        const e = json(data), t = e?.type;
        if (typeof t != 'string') continue;
        if (t == 'TEXT_MESSAGE_START') { roles[e.messageId] = e.role ?? 'assistant'; yield* release(); yield* start(e.messageId); }
        else if (t == 'TEXT_MESSAGE_CONTENT' || t == 'TEXT_MESSAGE_CHUNK') {
          if (t == 'TEXT_MESSAGE_CHUNK' && e.role) roles[e.messageId] = e.role;
          if ((roles[e.messageId] ?? 'assistant') == 'assistant' && e.delta) { yield* release(); yield* start(e.messageId); yield {type: 'text', delta: e.delta}; }
        } else if (t == 'REASONING_MESSAGE_CONTENT' || t == 'REASONING_MESSAGE_CHUNK') { if (e.delta) yield {type: 'reasoning', delta: e.delta}; }
        else if (t == 'TOOL_CALL_START') { yield* start(e.parentMessageId); calls[e.toolCallId] = {name: e.toolCallName, args: ''}; last = e.toolCallId; }
        else if (t == 'TOOL_CALL_ARGS') { if (calls[e.toolCallId]) calls[e.toolCallId].args += e.delta ?? ''; }
        else if (t == 'TOOL_CALL_CHUNK') {
          const id = e.toolCallId ?? last;
          if (e.toolCallId && e.toolCallId != last) { if (last) end(last); yield* start(e.parentMessageId); }
          const c = calls[id] ||= {name: e.toolCallName, args: ''};
          if (e.toolCallName) c.name = e.toolCallName;
          c.args += e.delta ?? '';
          last = id;
        } else if (t == 'TOOL_CALL_END') end(e.toolCallId);
        else if (t == 'TOOL_CALL_RESULT') {
          end(e.toolCallId);
          yield* take(e.toolCallId);
          yield {type: 'tool-result', id: e.toolCallId, output: typeof e.content == 'string' ? json(e.content) : e.content};
        } else if (t == 'STATE_SNAPSHOT' || t == 'STATE_DELTA') {
          state = t == 'STATE_SNAPSHOT' ? e.snapshot : applyPatch(state, e.delta);
          yield {type: 'data-agui-state', id: 'state', data: state};
        } else if (t == 'MESSAGES_SNAPSHOT') yield {type: 'data-agui-messages', id: 'messages', data: e.messages};
        else if (t == 'ACTIVITY_SNAPSHOT') yield {type: 'data-agui-activity', id: e.messageId, data: {activityType: e.activityType, content: e.content}};
        else if (t == 'STEP_FINISHED') { if (last) end(last); yield* release(); }
        else if (t == 'RUN_FINISHED') {
          for (const id in calls) end(id);
          yield* release();
          const u = (e.usage || []).reduce((a: any, x: any) => ({inputTokens: a.inputTokens + (x.inputTokens ?? 0), outputTokens: a.outputTokens + (x.outputTokens ?? 0), totalTokens: a.totalTokens + (x.totalTokens ?? (x.inputTokens ?? 0) + (x.outputTokens ?? 0))}), {inputTokens: 0, outputTokens: 0, totalTokens: 0});
          yield {type: 'finish', reason: e.outcome?.type == 'interrupt' ? 'other' : called ? 'tool-calls' : 'stop', ...(e.usage?.length && {usage: u})};
          return;
        } else if (t == 'RUN_ERROR') throw Object.assign(new Error('agui: ' + (e.message ?? 'the run failed')), {code: e.code});
      }
      for (const id in calls) end(id);
      yield* release();
    },
  };
}
