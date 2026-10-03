import xs, {Stream} from 'xstream';
import {senderOf, keepSender, allowed, makeReplies} from './replies';
import {error as logError} from './diagnostics/legacy';

/*
 * makeSocketDriver(options?) (PLAN-3 §1.3): WebSocket and server-sent events, declared per
 * component instance and answered with reply actions (./replies.ts). Docs on the declarations
 * in src/index.d.ts. Summary:
 *
 * - Sink values:
 *   - `{ connections: { [name]: spec | falsy } }`: the sender's whole set of connections. Diffed
 *     per (sender, name): a new name opens, a removed or falsy one closes, a changed URL /
 *     protocols / withCredentials / share closes and reopens, anything else (action names,
 *     reconnect) only rebinds.
 *   - `{ to: name, json? | text? | binary? }`: send on the sender's connection `name` (json is
 *     stringified). Queued while (re)connecting, bounded (`queueLimit`, oldest dropped). A send
 *     to no such connection, a closed one, or an SSE one is SYG611 (not sent).
 *   - A value with a `then` / `catch` key (or a spec with one) is SYG610 (ignored).
 * - Spec: `{ socket: url, protocols?, message?, open?, close?, error?, reconnect?, share? }` or
 *   `{ sse: url, withCredentials?, message?, open?, close?, error?, events?, reconnect?, share? }`.
 *   URLs are prefixed with `baseUrl` unless absolute; a socket path resolves against `location`
 *   with ws:/wss: for http:/https:.
 * - Reply actions (to exactly the sender): `message` (data: the JSON-parsed frame when it parses,
 *   else the raw data), `open` ({ reconnected }), `close` ({ code, reason, willReconnect }: only
 *   for closes the driver didn't make, G-148), `error` ({ error }); SSE `events: { name: 'ACTION' }`
 *   names actions for named events. An event type without an action name goes to `select(name?)` as
 *   `{ name, type, data }` (the plain form).
 * - Reconnect (default on): jittered exponential backoff, `{ delayMs: 500, maxDelayMs: 10000,
 *   jitter: 0.2 }`, per spec over the driver's `reconnect`; `jitter: false` + equal delays is a
 *   fixed delay. A failure to open is a drop. Removal, replacement or dispose cancels a retry.
 *   SSE: EventSource retries transient drops itself (close fires with willReconnect: true); the
 *   driver's reconnect applies when it gives up (readyState CLOSED).
 * - Sharing (default): connections with the same URL (and protocols / withCredentials) share one
 *   socket, ref-counted; every subscriber gets each event. `share: false` opts out.
 * - A disposed sender's connections close (and their retries stop); app dispose closes all.
 * - No WebSocket / EventSource (SSR): nothing opens, nothing is reported.
 * - `WebSocket` / `EventSource` are read at connect time: options.WebSocket ?? globalThis.WebSocket.
 */

const SCOPE = '__sygnalScope';
const scopeOf = (v: any): any[] => v[SCOPE] || [];

export function makeSocketDriver(options: any = {}) {
  return (sink$: Stream<any>) => {
    const g: any = globalThis;
    // sender → name → entry { sender, name, spec, scope, key, t (its transport), opened }
    const conns = new Map<any, Map<string, any>>();
    // key → transport { key, url, spec, subs: Set<entry>, s (socket), open, queue, n (attempts), timer, on (SSE names) }
    const transports = new Map<string, any>();
    const subs = new Set<any>();
    let disposed = false;
    let unshared = 0;

    const bad = (msg: string, v: any) =>
      logError('SYG611', v.__emitterName, `makeSocketDriver: ${msg}`, "Declare { connections: { room: { socket: url } } }, then send { to: 'room', json }", v);

    const deliver = (e: any, type: string, data: any) => {
      const action = e.spec[type];
      if (typeof action == 'string' && e.sender !== undefined) return reply(e.sender, action, data);
      const ev = {name: e.name, type, data};
      subs.forEach(s => {
        if ((s.name === undefined || s.name === e.name) && s.ns.every((x: any, i: number) => e.scope[i] === x)) {
          try { s.l.next(ev); } catch (err) { console.error(err); }
        }
      });
    };
    const each = (t: any, f: (e: any) => any) => [...t.subs].forEach(f);
    const parse = (d: any) => {
      if (typeof d == 'string') try { return JSON.parse(d); } catch (_) {}
      return d;
    };
    const resolve = (u: string, sse: boolean) => {
      if (!/^[a-z][a-z\d+.-]*:/i.test(u)) u = (options.baseUrl || '') + u;
      const loc = g.location;
      if (sse || /^wss?:/i.test(u) || !loc) return u;
      try {
        const r = new URL(u, loc.href);
        r.protocol = r.protocol == 'https:' ? 'wss:' : 'ws:';
        return r.href;
      } catch (_) { return u; }
    };
    const policy = (spec: any) => {
      const r = spec.reconnect, d = options.reconnect;
      return r === false || (r == null && d === false) ? null : {...(d && typeof d == 'object' && d), ...(r && typeof r == 'object' && r)};
    };
    const delay = (p: any, n: number) => {
      const j = p.jitter === false ? 0 : p.jitter == null || p.jitter === true ? 0.2 : +p.jitter;
      return Math.min(p.maxDelayMs ?? 10000, (p.delayMs ?? 500) * 2 ** n) * (1 + j * (2 * Math.random() - 1));
    };

    const out = (t: any, data: any, e: any) => {
      try { t.s.send(data); } catch (error) { deliver(e, 'error', {error}); }
    };
    // SSE named events: one listener per name across the subscribers
    const listen = (t: any) => t.s && t.sse && each(t, e => Object.keys(e.spec.events || {}).forEach(name => {
      if (t.on.has(name)) return;
      t.on.add(name);
      const s = t.s;
      s.addEventListener(name, (m: any) => t.s === s && each(t, x => {
        const a = x.spec.events?.[name];
        if (typeof a == 'string' && x.sender !== undefined) reply(x.sender, a, parse(m.data));
      }));
    }));

    // the socket closed (or failed to open) without the driver closing it
    const gone = (t: any, info: any) => {
      t.s = null;
      t.open = false;
      let again: any;
      each(t, e => {
        const p = !t.x && policy(e.spec);
        deliver(e, 'close', {...info, willReconnect: !!p});
        if (p) again = again || p;
        else detach(e, true);
      });
      if (again && t.subs.size) t.timer = setTimeout(() => connect(t), delay(again, t.n++));
    };

    const connect = (t: any) => {
      t.timer = 0;
      const C = t.sse ? options.EventSource ?? g.EventSource : options.WebSocket ?? g.WebSocket;
      if (typeof C != 'function') return;
      let s: any;
      try {
        s = t.sse ? new C(t.url, {withCredentials: !!t.spec.withCredentials}) : new C(t.url, t.spec.protocols);
      } catch (error) {
        // a URL the constructor rejects never opens: no retry
        each(t, e => deliver(e, 'error', {error}));
        t.x = 1;
        return gone(t, {code: 1006, reason: '' + error});
      }
      t.s = s;
      t.on = new Set();
      const mine = (f: any) => (ev: any) => { if (t.s === s) f(ev); };
      s.onopen = mine(() => {
        t.n = 0;
        t.open = true;
        each(t, e => { deliver(e, 'open', {reconnected: !!e.opened}); e.opened = true; });
        const q = t.queue;
        t.queue = [];
        q.forEach((x: any) => t.s === s && out(t, x.data, x.e));
      });
      s.onmessage = mine((m: any) => { const d = parse(m.data); each(t, e => deliver(e, 'message', d)); });
      s.onerror = mine((error: any) => {
        each(t, e => deliver(e, 'error', {error}));
        if (t.sse) {
          // CLOSED: EventSource gave up (the driver's reconnect applies); else it retries itself
          if (s.readyState == 2 || ![...t.subs].some(e => policy(e.spec))) { s.close(); gone(t, {}); }
          else if (t.open) { t.open = false; each(t, e => deliver(e, 'close', {willReconnect: true})); }
        }
      });
      if (!t.sse) s.onclose = mine((c: any) => gone(t, {code: c.code, reason: c.reason}));
      listen(t);
    };

    // closes the driver makes: no `close` action, late events ignored, retry cancelled
    const end = (t: any) => {
      clearTimeout(t.timer);
      transports.delete(t.key);
      const s = t.s;
      t.s = null;
      if (s) try { s.close(); } catch (_) {}
    };
    const detach = (e: any, keep?: boolean) => {
      const t = e.t;
      if (!keep) conns.get(e.sender)?.delete(e.name);
      if (!t) return;
      e.t = null;
      t.subs.delete(e);
      t.queue = t.queue.filter((x: any) => x.e !== e);
      if (!t.subs.size) end(t);
    };
    const attach = (e: any) => {
      const key = e.spec.share === false ? e.key + '#' + ++unshared : e.key;
      let t = transports.get(key);
      const fresh = !t;
      if (fresh) transports.set(key, (t = {key, sse: e.sse, url: e.url, spec: e.spec, subs: new Set(), queue: [], n: 0, on: new Set()}));
      e.t = t;
      t.subs.add(e);
      if (fresh) connect(t);
      else {
        listen(t);
        // joined an open shared socket: it is open for this subscriber too
        if (t.open) queueMicrotask(() => { if (e.t === t && t.open && !e.opened) { e.opened = true; deliver(e, 'open', {reconnected: false}); } });
      }
    };

    const declare = (sender: any, next: any, scope: any[]) => {
      let mine = conns.get(sender);
      if (!mine) conns.set(sender, (mine = new Map()));
      mine.forEach((e, name) => { if (!next[name]) detach(e); });
      Object.keys(next).forEach(name => {
        const spec = next[name];
        if (!spec) return;
        const old = mine!.get(name);
        if (typeof spec != 'object' || (typeof spec.socket != 'string' && typeof spec.sse != 'string') || !allowed(spec, 'makeSocketDriver')) {
          if (old) detach(old);
          if (typeof spec == 'object' && ('then' in spec || 'catch' in spec)) return;
          return bad(`connection '${name}' needs a socket or sse URL`, spec);
        }
        const sse = typeof spec.sse == 'string';
        const url = resolve(sse ? spec.sse : spec.socket, sse);
        // the connection's identity: a change reconnects, anything else only rebinds
        const key = (spec.share === false ? 'u' : '') + (sse ? 'e' + !!spec.withCredentials : 's' + JSON.stringify(spec.protocols)) + url;
        if (old && old.key === key) {
          old.spec = spec;
          if (old.t) listen(old.t);
          return;
        }
        if (old) detach(old);
        const e = {sender, name, spec, scope, key, sse, url, t: null, opened: false};
        mine!.set(name, e);
        attach(e);
      });
    };

    const send = (sender: any, v: any) => {
      const e = conns.get(sender)?.get(v.to);
      const t = e?.t;
      if (!t || t.sse) return bad(t ? `'${v.to}' is a server-sent events connection (read-only)` : `no connection named '${v.to}' is open`, v);
      const data = v.json !== undefined ? JSON.stringify(v.json) : v.text ?? v.binary;
      if (t.open) out(t, data, e);
      else if (t.queue.push({data, e}) > (options.queueLimit ?? 100)) t.queue.shift();
    };

    const closeAll = () => {
      conns.forEach(m => m.forEach(e => detach(e)));
      conns.clear();
    };
    const {replies, reply} = makeReplies(sender => {
      conns.get(sender)?.forEach(e => detach(e));
      conns.delete(sender);
    });

    sink$.addListener({
      next: (v: any) => {
        if (!v || typeof v != 'object' || disposed || !allowed(v, 'makeSocketDriver')) return;
        try {
          const sender = senderOf(v);
          if (v.connections !== undefined) declare(sender, v.connections || {}, scopeOf(v));
          else if (v.to !== undefined) send(sender, v);
          else bad('expected { connections } or { to, json | text | binary }', v);
        } catch (e) { console.error('[Sygnal] makeSocketDriver', v, e); }
      },
      error: (e: any) => console.error('[Sygnal] makeSocketDriver', e),
      complete: closeAll,
    });

    const source = (ns: any[]): any => ({
      select: (name?: string) => {
        let sub: any;
        return xs.create<any>({start: l => { subs.add((sub = {l, name, ns})); }, stop: () => { subs.delete(sub); }});
      },
      isolateSource: (_: any, scope: any) => source(ns.concat(scope)),
      isolateSink: (sink: any, scope: any) => sink.map((v: any) => v && typeof v == 'object'
        ? Object.defineProperty(keepSender(v, {...v}), SCOPE, {value: [scope, ...scopeOf(v)]}) : v),
      // the core sends a component's `connections` static here (PLAN-3 2-B)
      __sygnalConnections: true,
      ...replies,
    });

    return {...source([]), dispose: () => { closeAll(); disposed = true; }};
  };
}
