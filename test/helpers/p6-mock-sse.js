// PLAN-6 (§3 "no network in npm test"): a mock inference server speaking Open Responses SSE and
// Anthropic Messages SSE, moved from research/llm-experiments/ (spike 0-S1). N text tokens, one
// per `delayMs` on server-side timers, then (when tools are offered and the last message is from
// the user) one tool call. Each request is logged with `closedEarly` (the client aborted).
//
//   startMock({ tokens, delayMs, perChunk })  a node:http server: { url, log, close }
//   mockSseMiddleware({ prefix })             the same routes as connect middleware (the browser
//                                             tests' Vite server): POST <prefix>/openai/v1/responses,
//                                             GET <prefix>/log; ?tokens=&ms= override per request
//
// Routes: /openai/v1/responses (Open Responses), /anthropic/v1/messages (Anthropic Messages).
const words = n => Array.from({ length: n }, (_, i) => `w${i} `)
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function handle(req, res, log, { tokens = 200, delayMs = 2, perChunk = 1 } = {}, path = req.url) {
  const q = new URL(path, 'http://x').searchParams
  if (q.has('tokens')) tokens = Number(q.get('tokens'))
  if (q.has('ms')) delayMs = Number(q.get('ms'))
  let body = ''
  for await (const c of req) body += c
  const json = body ? JSON.parse(body) : {}
  const entry = { url: path, json, headers: req.headers, tokens, sent: 0, closedEarly: false }
  log.push(entry)
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  let closed = false
  res.on('close', () => { closed = true; if (!res.writableEnded) entry.closedEarly = true })
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  const msgs = json.messages || json.input || []
  const last = msgs[msgs.length - 1]
  const wantTool = json.tools?.length && last && last.role === 'user'
  const ws = words(tokens)
  const stream = async (each) => {
    for (let i = 0; i < ws.length && !closed; i += perChunk) {
      for (const w of ws.slice(i, i + perChunk)) { each(w); entry.sent++ }
      if (delayMs) await sleep(delayMs)
    }
  }
  if (path.includes('/anthropic/v1/messages')) {
    send('message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', content: [], model: json.model, usage: { input_tokens: 10, output_tokens: 0 } } })
    send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    await stream(w => send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: w } }))
    if (closed) return
    send('content_block_stop', { type: 'content_block_stop', index: 0 })
    if (wantTool) {
      const t = json.tools[0]
      send('content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: t.name, input: {} } })
      send('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"city": "Hi' } })
      send('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'lo"}' } })
      send('content_block_stop', { type: 'content_block_stop', index: 1 })
    }
    send('message_delta', { type: 'message_delta', delta: { stop_reason: wantTool ? 'tool_use' : 'end_turn' }, usage: { output_tokens: tokens } })
    send('message_stop', { type: 'message_stop' })
  } else {
    send('response.created', { type: 'response.created', response: { id: 'resp_1', status: 'in_progress' } })
    send('response.output_item.added', { type: 'response.output_item.added', output_index: 0, item: { id: 'msg_1', type: 'message', role: 'assistant', content: [] } })
    await stream(w => send('response.output_text.delta', { type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, content_index: 0, delta: w }))
    if (closed) return
    send('response.output_text.done', { type: 'response.output_text.done', item_id: 'msg_1', output_index: 0, content_index: 0, text: ws.join('') })
    if (wantTool) {
      const t = json.tools[0]
      send('response.output_item.added', { type: 'response.output_item.added', output_index: 1, item: { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: t.name, arguments: '' } })
      send('response.function_call_arguments.done', { type: 'response.function_call_arguments.done', item_id: 'fc_1', output_index: 1, arguments: '{"city":"Hilo"}' })
    }
    send('response.completed', { type: 'response.completed', response: { id: 'resp_1', status: 'completed', usage: { input_tokens: 10, output_tokens: tokens } } })
  }
  res.end()
}

export async function startMock(opts = {}) {
  const { createServer } = await import('node:http')
  const log = []
  const server = createServer((req, res) => { handle(req, res, log, opts) })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`, log, close: () => { server.closeAllConnections?.(); server.close() },
  })))
}

export function mockSseMiddleware({ prefix = '/__p6', ...opts } = {}) {
  const log = []
  return (req, res, next) => {
    if (!req.url.startsWith(prefix + '/')) return next()
    const path = req.url.slice(prefix.length)
    if (path.startsWith('/log')) {
      res.setHeader('content-type', 'application/json')
      return res.end(JSON.stringify(log.map(({ json, headers, ...e }) => e)))
    }
    handle(req, res, log, opts, path)
  }
}
