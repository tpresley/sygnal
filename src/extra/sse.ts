/*
 * sse() (PLAN-6 L-2; 7.2: its own module, no imports, so the fetch driver's `stream: 'sse'` and
 * fetchEventSource read SSE without the AI transports): a fetch Response body as SSE frames
 * ({ event, data }), per the HTML spec's parsing rules: CRLF / LF, comments, multi-line data.
 * The reader is cancelled when the consumer stops (abort, a thrown error), so the connection closes.
 */

/**
 * the SSE frames of a response body: `{ event, data }` (data: the joined data lines). PLAN-11
 * E-1: `meta` (optional) follows the stream's `id` (the last event id, kept across frames) and
 * `retry` (ms) fields, as EventSource does, for a reconnect
 */
export async function* sse(res: any, meta?: {id?: string; retry?: number; beat?: () => void}): AsyncGenerator<{event: string; data: string}> {
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '', cr = '', done = false;
  try {
    for (;;) {
      const r = await reader.read();
      // PLAN-13 S-1: any bytes (a heartbeat comment too) show the stream is alive
      if (!r.done) meta?.beat?.();
      // line ends -> \n (a \r at a chunk's end waits: it may be half of a \r\n)
      let s = cr + (r.done ? '\n\n' : dec.decode(r.value, {stream: true}));
      cr = !r.done && s.endsWith('\r') ? '\r' : '';
      if (cr) s = s.slice(0, -1);
      buf += s.replace(/\r\n?/g, '\n');
      done = r.done;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        let event = 'message', data: string[] = [];
        for (const line of frame.split('\n')) {
          if (!line || line[0] == ':') continue;
          const c = line.indexOf(':'), field = c < 0 ? line : line.slice(0, c);
          const v = c < 0 ? '' : line.slice(c + 1).replace(/^ /, '');
          if (field == 'event') event = v;
          else if (field == 'data') data.push(v);
          else if (meta && field == 'id' && !v.includes('\0')) meta.id = v;
          else if (meta && field == 'retry' && /^\d+$/.test(v)) meta.retry = +v;
        }
        if (data.length) yield {event, data: data.join('\n')};
      }
      if (done) return;
    }
  } finally {
    if (!done) reader.cancel().catch(() => {});
  }
}
