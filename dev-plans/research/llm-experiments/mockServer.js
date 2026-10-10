// A mock inference server speaking the wire shapes of Anthropic Messages and OpenAI Responses
// (SSE), enough to drive the prototype driver: N text tokens, then (when tools are offered and
// the last message is from the user) one tool call.
import http from 'node:http';

const words = n => Array.from({length: n}, (_, i) => `w${i} `);
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function startMock({tokens = 200, delayMs = 2, perChunk = 1} = {}) {
  const log = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const json = body ? JSON.parse(body) : {};
    log.push({url: req.url, json, headers: req.headers});
    res.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-cache'});
    let closed = false;
    res.on('close', () => { closed = true; });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const msgs = json.messages || json.input || [];
    const last = msgs[msgs.length - 1];
    const wantTool = json.tools?.length && last && (last.role === 'user') ;
    const ws = words(tokens);
    if (req.url.startsWith('/anthropic/v1/messages')) {
      send('message_start', {type: 'message_start', message: {id: 'msg_1', type: 'message', role: 'assistant', content: [], model: json.model, usage: {input_tokens: 10, output_tokens: 0}}});
      send('content_block_start', {type: 'content_block_start', index: 0, content_block: {type: 'text', text: ''}});
      for (let i = 0; i < ws.length && !closed; i += perChunk) {
        for (const w of ws.slice(i, i + perChunk)) send('content_block_delta', {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: w}});
        if (delayMs) await sleep(delayMs);
      }
      send('content_block_stop', {type: 'content_block_stop', index: 0});
      if (wantTool) {
        const t = json.tools[0];
        send('content_block_start', {type: 'content_block_start', index: 1, content_block: {type: 'tool_use', id: 'toolu_1', name: t.name, input: {}}});
        send('content_block_delta', {type: 'content_block_delta', index: 1, delta: {type: 'input_json_delta', partial_json: '{"city": "Hi'}});
        send('content_block_delta', {type: 'content_block_delta', index: 1, delta: {type: 'input_json_delta', partial_json: 'lo"}'}});
        send('content_block_stop', {type: 'content_block_stop', index: 1});
      }
      send('message_delta', {type: 'message_delta', delta: {stop_reason: wantTool ? 'tool_use' : 'end_turn'}, usage: {output_tokens: tokens}});
      send('message_stop', {type: 'message_stop'});
    } else if (req.url.startsWith('/openai/v1/responses')) {
      send('response.created', {type: 'response.created', response: {id: 'resp_1', status: 'in_progress'}});
      send('response.output_item.added', {type: 'response.output_item.added', output_index: 0, item: {id: 'msg_1', type: 'message', role: 'assistant', content: []}});
      for (let i = 0; i < ws.length && !closed; i += perChunk) {
        for (const w of ws.slice(i, i + perChunk)) send('response.output_text.delta', {type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, content_index: 0, delta: w});
        if (delayMs) await sleep(delayMs);
      }
      send('response.output_text.done', {type: 'response.output_text.done', item_id: 'msg_1', output_index: 0, content_index: 0, text: ws.join('')});
      if (wantTool) {
        const t = json.tools[0];
        send('response.output_item.added', {type: 'response.output_item.added', output_index: 1, item: {id: 'fc_1', type: 'function_call', call_id: 'call_1', name: t.name, arguments: ''}});
        send('response.function_call_arguments.delta', {type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 1, delta: '{"city":"Hilo"}'});
        send('response.function_call_arguments.done', {type: 'response.function_call_arguments.done', item_id: 'fc_1', output_index: 1, arguments: '{"city":"Hilo"}'});
      }
      send('response.completed', {type: 'response.completed', response: {id: 'resp_1', status: 'completed', usage: {input_tokens: 10, output_tokens: tokens}}});
    }
    res.end();
  });
  return new Promise(resolve => server.listen(0, () => resolve({
    url: `http://127.0.0.1:${server.address().port}`, log, close: () => server.close(),
  })));
}
