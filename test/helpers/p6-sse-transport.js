// PLAN-6 L-1 tests: a minimal Open Responses SSE chat transport over fetch (text deltas,
// reasoning deltas, function calls, completion), enough to run makeChatDriver against the mock
// server (./p6-mock-sse.js). Test code only: the real transports are L-2 (Phase 2).
export function sseTransport({ url, fetch: f = (u, i) => globalThis.fetch(u, i) }) {
  return {
    async *stream(req, signal) {
      const res = await f(url, {
        method: 'POST', signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: req.model ?? 'mock', stream: true, input: req.messages.map(m => ({ role: m.role, content: m.content ?? '' })) }),
      })
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status })
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      const calls = {}
      let buf = ''
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) return
          buf += dec.decode(value, { stream: true })
          let i
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, i)
            buf = buf.slice(i + 2)
            const data = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('')
            if (!data) continue
            const e = JSON.parse(data)
            if (e.type == 'response.output_text.delta') yield { type: 'text', delta: e.delta }
            else if (e.type == 'response.reasoning_text.delta') yield { type: 'reasoning', delta: e.delta }
            else if (e.type == 'response.output_item.added' && e.item?.type == 'function_call') calls[e.item.id] = e.item
            else if (e.type == 'response.function_call_arguments.done') yield { type: 'tool-call', id: calls[e.item_id].call_id, name: calls[e.item_id].name, input: JSON.parse(e.arguments) }
            else if (e.type == 'response.completed') yield { type: 'finish', reason: 'stop', usage: e.response.usage }
          }
        }
      } finally {
        try { reader.releaseLock() } catch (_) {}
      }
    },
  }
}
