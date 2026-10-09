// PROTOTYPE provider adapters for makeLLMDriver: each is `{ stream(request, signal) }` yielding
// normalized events. Three kinds are tried here:
//   1. native wire adapters (fetch + SSE, no dependency): anthropic(), openaiResponses()
//   2. a library bridge: fromAISDK(streamText, model) (Vercel AI SDK's fullStream)
//   3. a non-chat shape: typesafeDecision(client) (TypeSafe Jev: state + questions -> answers)

/** SSE frames from a fetch Response body: { event, data } */
export async function* sse(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const {value, done} = await reader.read();
    if (done) break;
    buf += dec.decode(value, {stream: true});
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i); buf = buf.slice(i + 2);
      let event = 'message', data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (data && data !== '[DONE]') yield {event, data: JSON.parse(data)};
    }
  }
}

const post = async (url, headers, body, signal) => {
  const res = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json', ...headers}, body: JSON.stringify(body), signal});
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), {status: res.status, body: await res.text()});
  return res;
};

// framework messages: { role: 'user'|'assistant'|'tool', content: string } or { role, parts: [...] }
const partsOf = m => m.parts ?? [{type: 'text', text: m.content}];

export function anthropic({baseURL, headers = {}, model, maxTokens = 1024}) {
  const toAnthropic = m => m.role === 'tool'
    ? {role: 'user', content: partsOf(m).map(p => ({type: 'tool_result', tool_use_id: p.id, content: JSON.stringify(p.output)}))}
    : {role: m.role, content: partsOf(m).map(p => p.type === 'tool-call'
      ? {type: 'tool_use', id: p.id, name: p.name, input: p.input}
      : {type: 'text', text: p.text})};
  return {
    async *stream(req, signal) {
      const res = await post(`${baseURL}/v1/messages`, {'anthropic-version': '2023-06-01', ...headers}, {
        model: req.model ?? model, max_tokens: req.maxTokens ?? maxTokens, stream: true,
        system: req.system, messages: req.messages.map(toAnthropic),
        tools: req.tools && Object.entries(req.tools).map(([name, t]) => ({name, description: t.description, input_schema: t.parameters})),
      }, signal);
      const tools = {};
      for await (const {data: e} of sse(res)) {
        if (e.type === 'content_block_start' && e.content_block.type === 'tool_use') tools[e.index] = {id: e.content_block.id, name: e.content_block.name, json: ''};
        else if (e.type === 'content_block_delta' && e.delta.type === 'text_delta') yield {type: 'text', delta: e.delta.text};
        else if (e.type === 'content_block_delta' && e.delta.type === 'thinking_delta') yield {type: 'reasoning', delta: e.delta.thinking};
        else if (e.type === 'content_block_delta' && e.delta.type === 'input_json_delta') tools[e.index].json += e.delta.partial_json;
        else if (e.type === 'content_block_stop' && tools[e.index]) { const t = tools[e.index]; yield {type: 'tool-call', id: t.id, name: t.name, input: JSON.parse(t.json || '{}')}; }
        else if (e.type === 'message_delta') yield {type: 'finish', reason: e.delta.stop_reason, usage: e.usage};
        else if (e.type === 'error') throw Object.assign(new Error(e.error?.message), {detail: e.error});
      }
    },
  };
}

export function openaiResponses({baseURL, headers = {}, model}) {
  const toInput = m => m.role === 'tool'
    ? partsOf(m).map(p => ({type: 'function_call_output', call_id: p.id, output: JSON.stringify(p.output)}))
    : partsOf(m).map(p => p.type === 'tool-call'
      ? {type: 'function_call', call_id: p.id, name: p.name, arguments: JSON.stringify(p.input)}
      : {role: m.role, content: p.text});
  return {
    async *stream(req, signal) {
      const res = await post(`${baseURL}/v1/responses`, headers, {
        model: req.model ?? model, stream: true, instructions: req.system,
        input: req.messages.flatMap(toInput),
        tools: req.tools && Object.entries(req.tools).map(([name, t]) => ({type: 'function', name, description: t.description, parameters: t.parameters})),
      }, signal);
      const calls = {};
      for await (const {data: e} of sse(res)) {
        if (e.type === 'response.output_text.delta') yield {type: 'text', delta: e.delta};
        else if (e.type === 'response.reasoning_summary_text.delta') yield {type: 'reasoning', delta: e.delta};
        else if (e.type === 'response.output_item.added' && e.item.type === 'function_call') calls[e.item.id] = e.item;
        else if (e.type === 'response.function_call_arguments.done') { const c = calls[e.item_id]; yield {type: 'tool-call', id: c.call_id, name: c.name, input: JSON.parse(e.arguments)}; }
        else if (e.type === 'response.completed') yield {type: 'finish', reason: e.response.status, usage: e.response.usage};
        else if (e.type === 'response.failed' || e.type === 'error') throw new Error(e.response?.error?.message ?? e.message);
      }
    },
  };
}

/** the Vercel AI SDK as the transport: any of its providers, its message conversion and retries */
export function fromAISDK({streamText, model, jsonSchema}) {
  const toModel = m => m.role === 'tool'
    ? {role: 'tool', content: partsOf(m).map(p => ({type: 'tool-result', toolCallId: p.id, toolName: p.name, output: {type: 'json', value: p.output}}))}
    : {role: m.role, content: partsOf(m).map(p => p.type === 'tool-call'
      ? {type: 'tool-call', toolCallId: p.id, toolName: p.name, input: p.input}
      : {type: 'text', text: p.text})};
  return {
    async *stream(req, signal) {
      const result = streamText({
        model: req.model ?? model, system: req.system, messages: req.messages.map(toModel), abortSignal: signal,
        // no execute: tool calls come back to the app (client-side tools)
        tools: req.tools && Object.fromEntries(Object.entries(req.tools).map(([n, t]) => [n, {description: t.description, inputSchema: jsonSchema(t.parameters)}])),
      });
      for await (const p of result.fullStream) {
        if (p.type === 'text-delta') yield {type: 'text', delta: p.text ?? p.delta};
        else if (p.type === 'reasoning-delta') yield {type: 'reasoning', delta: p.text ?? p.delta};
        else if (p.type === 'tool-call') yield {type: 'tool-call', id: p.toolCallId, name: p.toolName, input: p.input};
        else if (p.type === 'finish') yield {type: 'finish', reason: p.finishReason, usage: p.totalUsage};
        else if (p.type === 'error') throw p.error;
      }
    },
  };
}

/**
 * TypeSafe's decision shape (Jev): not a conversation. `{ state, questions }` in, typed
 * `answers` out. Shown as an adapter to test whether the chat-shaped driver fits it: it doesn't
 * stream text, so it maps to a single 'answers' event.
 */
export function typesafeDecision(client) {
  return {
    async *stream(req, signal) {
      const res = await client.systemOne({state: req.state, questions: req.questions}, {signal});
      yield {type: 'answers', answers: res.answers};
      yield {type: 'finish', reason: 'stop', usage: res.usage};
    },
  };
}
