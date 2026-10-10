// PLAN-6 2-T: recorded / hand-written SSE fixtures for the L-2 transport tests (no network).
//   toSSE(events)              Open Responses events -> `event: <type>\ndata: <JSON>\n\n` text
//   dataSSE(chunks, done?)     JSON chunks -> `data: <JSON>\n\n` text (+ `data: [DONE]`)
//   fixtureFetch(answer)       a fetch whose Response streams `answer(json, url, init)`: a string (SSE
//                              text), an array of strings (one body chunk each), or a Response.
//                              Records `calls` ({ url, init, json, headers }); `split: n` cuts the
//                              text into n-byte chunks (parser robustness); `aborted` counts bodies
//                              cancelled or errored by an abort
export const toSSE = events => events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('')
export const dataSSE = (chunks, done = true) => chunks.map(c => `data: ${typeof c == 'string' ? c : JSON.stringify(c)}\n\n`).join('') + (done ? 'data: [DONE]\n\n' : '')

export function fixtureFetch(answer, { split, headers = { 'content-type': 'text/event-stream' }, status = 200, gapMs = 0 } = {}) {
  const enc = new TextEncoder()
  const state = { calls: [], aborted: 0 }
  state.fetch = async (url, init = {}) => {
    const json = init.body ? JSON.parse(init.body) : undefined
    state.calls.push({ url, init, json, headers: init.headers })
    if (init.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    const a = await answer(json, url, init)
    if (a instanceof Response) return a
    let pieces = Array.isArray(a) ? a : [a]
    if (split) pieces = pieces.flatMap(p => p.match(new RegExp(`[\\s\\S]{1,${split}}`, 'g')) || [])
    let i = 0, timer
    const body = new ReadableStream({
      start(c) {
        init.signal?.addEventListener('abort', () => { clearTimeout(timer); state.aborted++; try { c.error(Object.assign(new Error('aborted'), { name: 'AbortError' })) } catch (_) {} })
      },
      async pull(c) {
        if (gapMs) await new Promise(r => { timer = setTimeout(r, gapMs) })
        if (init.signal?.aborted) return
        if (i < pieces.length) c.enqueue(enc.encode(pieces[i++]))
        else c.close()
      },
      cancel() { state.aborted++ },
    })
    return new Response(body, { status, headers })
  }
  return state
}

/** every event a transport yields for `request` */
export async function collect(transport, request, signal = new AbortController().signal) {
  const out = []
  for await (const e of transport.stream(request, signal)) out.push(e)
  return out
}
