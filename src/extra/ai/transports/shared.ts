import {fail, error as logError} from '../../diagnostics/legacy';

/*
 * PLAN-6 L-2: what the HTTP transports share (side-effect free; each transport imports only what
 * it uses).
 * - post(): the fetch (the `fetch` option, 0-S5), the headers option (an object or a function of
 *   the request), HTTP errors as Errors with `status` and the provider's message, and SYG670.
 * - sse(): a fetch Response body as SSE frames ({ event, data }), per the HTML spec's parsing
 *   rules: CRLF / LF, comments, multi-line data. The reader is cancelled when the consumer stops
 *   (abort, a thrown error), so the connection closes.
 * - SYG670: in a browser, a request with an auth header (Authorization, x-api-key, api-key,
 *   x-goog-api-key) to a host that is neither local (localhost, 127.0.0.1, [::1], *.localhost)
 *   nor the page's own origin is refused unless the transport has `dangerouslyAllowBrowser: true`:
 *   the key would ship to every visitor. Same-origin requests are the app's own server (its
 *   proxy), so a session header there is fine.
 */

const g: any = globalThis;

export interface HttpOptions {
  headers?: Record<string, string> | ((request: any) => Record<string, string> | Promise<Record<string, string>>);
  fetch?: (url: string, init: any) => Promise<any>;
  body?: Record<string, unknown>;
  dangerouslyAllowBrowser?: boolean;
}

const AUTH = /^(authorization|x-api-key|api-key|x-goog-api-key)$/i;
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|.+\.localhost)$/;

/** the URL a transport posts to, or a SYG670 Error when it must not (see the header) */
export function guard(url: string, headers: Record<string, string>, opts: HttpOptions, name: string): void {
  if (opts.dangerouslyAllowBrowser || typeof g.document == 'undefined' || !Object.keys(headers).some(h => AUTH.test(h))) return;
  const here = g.location?.href;
  let u: URL;
  try { u = new URL(url, here); } catch (_) { return; }
  if (LOCAL.test(u.hostname) || (here && u.origin == new URL(here).origin)) return;
  const fix = `Call ${u.origin} from your server and point the transport at that route (an AI SDK route with uiMessageStream('/api/chat'), or your own proxy), so the key stays there. For a key the user typed in themselves, pass ${name}({ ..., dangerouslyAllowBrowser: true })`;
  const msg = `${name}: refused to send an auth header from the browser to ${u.origin}: anyone who opens the page can read it`;
  logError('SYG670', undefined, msg, fix);
  fail('SYG670', undefined, msg, fix);
}

/**
 * POST JSON; a non-2xx response is an Error with `status`, `body` and the provider's message.
 * The transport's `body` option and the request's `body` are merged over the built body (so they
 * can override provider defaults such as `max_tokens`); `fixed` fields are merged last and can't be
 * overridden (G-654: uiMessageStream's protocol fields, as the AI SDK's DefaultChatTransport)
 */
export async function post(url: string, body: any, req: any, signal: AbortSignal, opts: HttpOptions, name: string, fixed?: any): Promise<any> {
  const h = typeof opts.headers == 'function' ? await opts.headers(req) : opts.headers || {};
  guard(url, h, opts, name);
  const f = opts.fetch || ((u: string, i: any) => g.fetch(u, i));
  const res = await f(url, {method: 'POST', headers: {'content-type': 'application/json', ...h}, body: JSON.stringify({...body, ...opts.body, ...(req.body as any), ...fixed}), signal});
  if (!res.ok) {
    let text = '', message = '';
    try { text = await res.text(); const j = JSON.parse(text); message = j.error?.message ?? j.error ?? j.message ?? ''; } catch (_) { message ||= text.slice(0, 200); }
    throw Object.assign(new Error(`${name}: HTTP ${res.status}${message ? ': ' + message : ''}`), {status: res.status, body: text});
  }
  if (!res.body) throw new Error(`${name}: the response has no body`);
  return res;
}

/** the SSE frames of a response body: `{ event, data }` (data: the joined data lines) */
export async function* sse(res: any): AsyncGenerator<{event: string; data: string}> {
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '', cr = '', done = false;
  try {
    for (;;) {
      const r = await reader.read();
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
        }
        if (data.length) yield {event, data: data.join('\n')};
      }
      if (done) return;
    }
  } finally {
    if (!done) reader.cancel().catch(() => {});
  }
}

/** JSON.parse, or the text itself when it isn't JSON (a model's malformed tool arguments go to validation as is) */
export const json = (s: any): any => {
  if (typeof s != 'string') return s;
  try { return JSON.parse(s || '{}'); } catch (_) { return s; }
};

/** a provider's usage as `{ inputTokens, outputTokens, totalTokens, reasoningTokens? }` (AI SDK names) */
export const usageOf = (u: any): any => u && {
  inputTokens: u.input_tokens ?? u.prompt_tokens,
  outputTokens: u.output_tokens ?? u.completion_tokens,
  totalTokens: u.total_tokens,
  ...((u.output_tokens_details ?? u.completion_tokens_details)?.reasoning_tokens != null && {reasoningTokens: (u.output_tokens_details ?? u.completion_tokens_details).reasoning_tokens}),
};

/** the parts of a message (a `content` string is one text part) */
export const partsOf = (m: any): any[] => m.parts ?? (typeof m.content == 'string' ? [{type: 'text', text: m.content}] : []);

/** the tool name of a `tool-<name>` / `dynamic-tool` part, or '' */
export const toolName = (p: any): string => p.type == 'dynamic-tool' ? p.toolName : p.type.startsWith('tool-') ? p.type.slice(5) : '';

/** what a tool part sends back to the model, or undefined when it has no result yet */
export const toolOutput = (p: any): string | undefined =>
  p.state == 'output-available' ? (typeof p.output == 'string' ? p.output : JSON.stringify(p.output ?? null))
  : p.state == 'output-error' ? JSON.stringify({error: p.errorText ?? 'error'})
  : p.state == 'output-denied' ? JSON.stringify({error: 'The user denied this tool call'})
  : undefined;

// dev-only diagnostics (SYG675): the dev entry formats them (checks/chat.ts)
export const dev = (...a: any[]) => g.__SYGNAL_DIAGNOSTICS__?.chat?.(...a);
