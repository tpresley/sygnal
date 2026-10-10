// PROTOTYPE makeLLMDriver: a reply-action driver (like makeFetchDriver / makeSocketDriver)
// over a provider adapter. The adapter turns one request into an async iterable of normalized
// events; the driver owns everything framework-shaped: sender routing, latest/abort per key,
// delta coalescing, the accumulated assistant message, dispose.
//
// Request (sink value):
//   { messages, system?, tools?, model?, key?, latest?, delta?: 'A', ok?: 'A', error?: 'A',
//     tool?: 'A', coalesce?: 'frame' | 'microtask' | 'none' | ms }
//   { abort: key | true }
// Normalized adapter events:
//   { type: 'text', delta } | { type: 'reasoning', delta } |
//   { type: 'tool-call', id, name, input } | { type: 'finish', reason, usage }
// Reply data:
//   delta: { key, text, delta, message }  (coalesced; `delta` = what arrived since the last one)
//   ok:    { key, text, message, toolCalls, reason, usage }
//   tool:  { key, call: { id, name, input } }   (one per completed tool call)
//   error: { key, error, request }
import xsMod from 'xstream';
const xs = xsMod.default ?? xsMod;

const SENDER = '__emitterId';

export function makeLLMDriver({adapter, coalesce: defCoalesce = 'frame', onEvent} = {}) {
  return sink$ => {
    const to = new Map(); // sender → listener of its reply actions
    const inflight = new Map(); // `${sender}|${key}` → AbortController
    const reply = (sender, type, data) => type && to.get(sender)?.next({type, data});
    const schedule = c =>
      c === 'none' ? f => f() :
      c === 'microtask' ? f => queueMicrotask(f) :
      typeof c === 'number' ? f => setTimeout(f, c) :
      typeof requestAnimationFrame == 'function' ? f => requestAnimationFrame(f) : f => setTimeout(f, 16);

    const run = async (req, sender) => {
      const key = req.key ?? req.ok ?? 'default';
      const id = `${sender}|${key}`;
      if (req.latest !== false) inflight.get(id)?.abort();
      const ac = new AbortController();
      inflight.set(id, ac);
      const message = {role: 'assistant', parts: []};
      let text = '', pending = '', scheduled = false, reason, usage;
      const toolCalls = [];
      const later = schedule(req.coalesce ?? defCoalesce);
      const flushDelta = () => {
        scheduled = false;
        if (!pending || ac.signal.aborted) return;
        const delta = pending; pending = '';
        reply(sender, req.delta, {key, text, delta, message: snapshot()});
      };
      const snapshot = () => ({role: 'assistant', parts: message.parts.map(p => ({...p}))});
      const lastPart = type => {
        const p = message.parts[message.parts.length - 1];
        if (p && p.type === type) return p;
        const n = {type, text: ''};
        message.parts.push(n);
        return n;
      };
      try {
        for await (const ev of adapter.stream(req, ac.signal)) {
          if (ac.signal.aborted) return;
          onEvent?.(ev);
          if (ev.type === 'text' || ev.type === 'reasoning') {
            lastPart(ev.type).text += ev.delta;
            if (ev.type === 'text') text += ev.delta;
            pending += ev.delta;
            if (req.delta && !scheduled) { scheduled = true; later(flushDelta); }
          } else if (ev.type === 'tool-call') {
            const call = {id: ev.id, name: ev.name, input: ev.input};
            toolCalls.push(call);
            message.parts.push({type: 'tool-call', ...call});
            reply(sender, req.tool, {key, call});
          } else if (ev.type === 'finish') {
            reason = ev.reason; usage = ev.usage;
          }
        }
        if (ac.signal.aborted) return;
        flushDelta();
        reply(sender, req.ok, {key, text, message: snapshot(), toolCalls, reason, usage});
      } catch (error) {
        if (ac.signal.aborted || error?.name === 'AbortError') return;
        reply(sender, req.error, {key, error, request: req});
      } finally {
        if (inflight.get(id) === ac) inflight.delete(id);
      }
    };

    sink$.addListener({
      next: req => {
        if (!req || typeof req != 'object') return;
        const sender = req[SENDER];
        if (req.abort !== undefined) {
          for (const [id, ac] of inflight) if (id.startsWith(`${sender}|`) && (req.abort === true || id === `${sender}|${req.abort}`)) ac.abort();
          return;
        }
        run(req, sender);
      },
      error: () => {}, complete: () => {},
    });

    return {
      __sygnalReplies: true,
      replies: sender => xs.create({
        start: l => { to.set(sender, l); },
        stop: () => {
          to.delete(sender);
          for (const [id, ac] of inflight) if (id.startsWith(`${sender}|`)) ac.abort();
        },
      }),
      dispose: () => { for (const ac of inflight.values()) ac.abort(); },
    };
  };
}
