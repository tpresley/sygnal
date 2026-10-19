import {sse} from './ai/transports/shared';

/*
 * PLAN-11 E-1: an EventSource over fetch, for server-sent events that need request headers
 * (`Authorization`), which the native EventSource can't send. makeSocketDriver uses it for an
 * `sse` connection with `headers`. It behaves as EventSource does where the driver relies on it:
 *
 * - connects on construction (a microtask later, so handlers can be set first); `readyState`
 *   CONNECTING (0) → OPEN (1) on a 2xx `text/event-stream` response;
 * - `onmessage` and `addEventListener(type)` get `{ type, data, lastEventId }`;
 * - the stream ending or a network error: `error`, readyState CONNECTING, a reconnect after
 *   `retry` ms (the stream's `retry:` field, default 3000) with `Last-Event-ID`;
 * - a non-2xx status or another content type: `error` with readyState CLOSED (no retry; the
 *   driver's reconnect policy decides);
 * - `close()` aborts the request and stops retrying.
 */

const NAMES = ['CONNECTING', 'OPEN', 'CLOSED'];

export class FetchEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readyState = 0;
  url: string;
  withCredentials: boolean;
  onopen: any = null;
  onmessage: any = null;
  onerror: any = null;
  private ls = new Map<string, Set<(e: any) => void>>();
  private meta: {id?: string; retry?: number} = {id: '', retry: 3000};
  private ctl: any;
  private timer: any;
  private init: any;

  constructor(url: string, init: {withCredentials?: boolean; headers?: Record<string, string>; fetch?: any} = {}) {
    this.url = url;
    this.withCredentials = !!init.withCredentials;
    this.init = init;
    queueMicrotask(() => this.connect());
  }

  addEventListener(type: string, f: (e: any) => void) {
    let s = this.ls.get(type);
    if (!s) this.ls.set(type, (s = new Set()));
    s.add(f);
  }
  removeEventListener(type: string, f: (e: any) => void) { this.ls.get(type)?.delete(f); }

  close() {
    this.readyState = 2;
    clearTimeout(this.timer);
    try { this.ctl?.abort(); } catch (_) {}
  }

  private emit(type: string, ev: any) {
    if (type == 'message') this.onmessage?.(ev);
    else if (type == 'open') this.onopen?.(ev);
    else if (type == 'error') this.onerror?.(ev);
    this.ls.get(type)?.forEach(f => { try { f(ev); } catch (e) { console.error(e); } });
  }

  private async connect() {
    if (this.readyState == 2) return;
    const g: any = globalThis;
    const f = this.init.fetch || (typeof g.fetch == 'function' && ((u: string, i: any) => g.fetch(u, i)));
    if (typeof f != 'function') return this.fail(new Error('fetch is not available in this environment'));
    const ctl: any = this.ctl = typeof AbortController == 'function' ? new AbortController() : {};
    const headers: Record<string, string> = {accept: 'text/event-stream', ...this.init.headers};
    if (this.meta.id) headers['last-event-id'] = this.meta.id;
    let res: any;
    try {
      res = await f(this.url, {headers, credentials: this.withCredentials ? 'include' : 'same-origin', cache: 'no-store', signal: ctl.signal});
    } catch (error) {
      return this.retry(error);
    }
    if (this.readyState == 2 || this.ctl !== ctl) return;
    const type = res.headers?.get?.('content-type') || '';
    if (!(res.status >= 200 && res.status < 300) || !/^text\/event-stream/i.test(type) || !res.body) {
      try { res.body?.cancel?.(); } catch (_) {}
      return this.fail(Object.assign(new Error(`SSE ${res.status}${type ? ' ' + type : ''}: ${this.url}`), {status: res.status}));
    }
    this.readyState = 1;
    this.emit('open', {type: 'open'});
    try {
      for await (const fr of sse(res, this.meta)) {
        if (this.readyState == 2 || this.ctl !== ctl) return;
        this.emit(fr.event, {type: fr.event, data: fr.data, lastEventId: this.meta.id});
      }
    } catch (error) {
      if (this.readyState == 2 || this.ctl !== ctl) return;
      return this.retry(error);
    }
    if (this.readyState != 2 && this.ctl === ctl) this.retry();
  }

  /** a drop: error, CONNECTING, try again after `retry` ms (unless the error handler closed it) */
  private retry(error?: any) {
    if (this.readyState == 2) return;
    this.readyState = 0;
    this.emit('error', {type: 'error', error});
    if (this.readyState == 2) return;
    this.timer = setTimeout(() => this.connect(), this.meta.retry);
  }
  /** a failed connection: error, CLOSED */
  private fail(error: any) {
    this.readyState = 2;
    this.emit('error', {type: 'error', error});
  }

  /** the state's name (debugging) */
  get state() { return NAMES[this.readyState]; }
}
