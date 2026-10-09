import type {Stream} from 'xstream';
import {senderOf, keepSender, allowed, makeReplies} from '../../replies';
import {error as logError} from '../../diagnostics/legacy';
import {isStandardSchema} from '../../standardSchema';
import {readOutput} from './output';

/*
 * PLAN-6 L-1: makeChatDriver({ transport, coalesce? }), the chat driver, on the PLAN-3 reply-action
 * machinery (../../replies.ts) like makeFetchDriver and makeSocketDriver. Types and docs:
 * src/ai.d.ts. Design: research/p6-spikes/0-S1.md (D251-D255, G-582, G-584-G-589, G-604).
 *
 * - Request (sink value): `{ messages, instructions?, tools?, model?, output?, key?, latest?,
 *   delta?, ok?, error?, tool?, coalesce?, ...transportOptions }`, passed to the transport as is
 *   (sender-stamped, scope-tagged). `{ abort: key | true }` / `{ abort: true, key }` stop the
 *   sender's runs under that key (all of them for a bare `abort: true`).
 *   - A `then` / `catch` key is SYG610 (allowed()); a value that isn't a request (no `messages`
 *     array, an unknown `coalesce`, an `output` that isn't a Standard Schema) is SYG679: not sent.
 *   - A request with no sender (not sent by a component) can't get replies: dropped, SYG677 (dev).
 * - Runs are keyed per (sender, `key ?? ok ?? error`); `latest` (default true) aborts the sender's
 *   runs under the same key first.
 * - Reply actions, to exactly the sender:
 *   - `delta` `{ key, text, reasoning, delta, message }` on new text or reasoning (coalesced);
 *     `delta` is the text that is new since the last one (D251);
 *   - `tool` `{ key, call: { id, name, input } }` once per completed call;
 *   - `ok` `{ key, message, text, value?, toolCalls, finishReason, usage }` (`value`: the
 *     validated structured output when the request has `output`, G-604);
 *   - `error` `{ key, error, request, issues? }`. A failure with no `error` action is SYG678
 *     (logged, also in production; G-584).
 * - An aborted run (abort, latest, sender dispose, app dispose, sink complete) delivers nothing:
 *   every reply checks the run first, a delta already scheduled included.
 * - Coalescing (G-582, G-588, D254): 'frame' (default) is at most one `delta` per animation frame
 *   and per 15 ms; rAF is raced with a 100 ms timer (a hidden tab never fires rAF); without rAF a
 *   frame is a 16 ms timer. 'none': one per event; a number: at most one per that many ms. The
 *   pending delta is flushed before `tool` and `ok`.
 * - Messages (D252): AI SDK UIMessage parts. Text and reasoning grow the trailing part of their
 *   type; a reasoning event with `providerMetadata` closes the reasoning part with it (L-2: an
 *   Anthropic thinking signature that must go back; the next reasoning starts a new part); a tool call is `tool-<name>` with `toolCallId`, `state: 'input-available'`, `input`
 *   (`'output-available'` / `'output-error'` after a tool-result / tool-error event,
 *   `'approval-requested'` with `approval` after tool-approval, `'output-denied'` after
 *   tool-denied: L-2's uiMessageStream). A tool-call with `executed: true` (the server runs it)
 *   is a part only: no `tool` reply, not in `ok.toolCalls`. Files,
 *   `source-*` and `data-<name>` parts as the events give them (a data part with the `id` of an
 *   earlier one replaces it, as in the AI SDK).
 * - Transport: `{ stream(request, signal) }` returning an AsyncIterable of ChatEvents
 *   (src/ai.d.ts). It is called synchronously in the sink's `next`, so `_frame` users (the
 *   L-4 fake) can link each stream to the request being sent. Unknown event types are ignored
 *   (the Open Responses rule); a known one with the wrong shape is skipped (SYG673, dev).
 * - Isolation: requests are scope-tagged (isolateSink / isolateValue, as makeSocketDriver);
 *   replies go by sender.
 * - `_frame` (internal, renderComponent's LLM fake): `(flush) => void` replaces the frame (and
 *   numeric) scheduler, so the fake decides when a frame happens.
 */

const SCOPE = '__sygnalScope';
const tag = (v: any, scope: any) => v && typeof v == 'object'
  ? Object.defineProperty(keepSender(v, {...v}), SCOPE, {value: [scope, ...(v[SCOPE] || [])]}) : v;

const g: any = globalThis;
const now = () => g.performance?.now?.() ?? Date.now();
// internal (D254): the 120 Hz floor and the hidden-tab fallback
const MIN_GAP = 15, FALLBACK = 100;

type Flush = (ts?: number) => void;

/** rAF raced with a timer (a hidden tab never runs rAF), else a 16 ms timer; `f` gets the frame's time */
const frame = (f: Flush) => {
  if (typeof g.requestAnimationFrame != 'function') return void setTimeout(() => f(now()), 16);
  let done = 0, a: any, t: any;
  const go = (ts?: any) => {
    if (done++) return;
    g.cancelAnimationFrame?.(a);
    clearTimeout(t);
    f(typeof ts == 'number' ? ts : now());
  };
  a = g.requestAnimationFrame(go);
  t = setTimeout(go, FALLBACK);
};

// dev-only diagnostics (SYG673, SYG677): the dev entry formats them (checks/chat.ts), so their
// text costs apps nothing; without it they're silent
const dev = (...a: any[]) => g.__SYGNAL_DIAGNOSTICS__?.chat?.(...a);

const FIX = "Send { messages, ok: 'DONE', error: 'FAILED' }";

/** why a request can't be sent ('' when it can) */
const problem = (r: any) =>
  !Array.isArray(r.messages) ? 'no messages array'
  : r.coalesce !== undefined && r.coalesce !== 'frame' && r.coalesce !== 'none' && !(typeof r.coalesce == 'number' && r.coalesce >= 0) ? 'coalesce is not frame, none or ms'
  : r.output !== undefined && !isStandardSchema(r.output) ? 'output is not a Standard Schema'
  : '';

export function makeChatDriver(options: any = {}) {
  const {transport, coalesce: defCoalesce = 'frame', _frame} = options;
  if (!transport || typeof transport.stream != 'function') throw new Error('[Sygnal] makeChatDriver: `transport` must be an object with stream(request, signal)');
  return (sink$: Stream<any>) => {
    let disposed = false, warned = 0, calls = 0;
    // runs in flight: { sender, key, ac }
    const runs = new Set<any>();
    const abortWhere = (which: (r: any) => boolean) => runs.forEach(r => { if (which(r)) { runs.delete(r); r.ac.abort(); } });
    const {replies, reply} = makeReplies(sender => abortWhere(r => r.sender === sender));
    // SYG673 (dev): `why` is 'type' | 'delta' | 'name' | 'id'; the first five per driver
    const malformed = (req: any, ev: any, why: string) => { if (warned++ < 5) dev('SYG673', req, ev, why); };

    const start = async (req: any, sender: any) => {
      const key = req.key ?? req.ok ?? req.error ?? 'default';
      if (req.latest !== false) abortWhere(r => r.sender === sender && r.key === key);
      const ac = new AbortController();
      const r = {sender, key, ac};
      runs.add(r);
      const live = () => !ac.signal.aborted && !disposed;
      const send = (type: any, data: any) => { if (type && live()) reply(sender, type, data); };

      let id: any, text = '', reasoning = '', pending = '', changed = false, scheduled = false, lastTs = -Infinity, finishReason: any, usage: any;
      const parts: any[] = [], toolCalls: any[] = [];
      const message = () => ({...(id !== undefined && {id}), role: 'assistant', parts: parts.map(p => ({...p}))});
      const mode = req.coalesce ?? defCoalesce;
      const later: (f: Flush) => void = mode === 'none' ? f => f()
        : _frame || (typeof mode == 'number' ? f => { setTimeout(f, mode); } : frame);
      const gap = mode === 'frame' && !_frame ? MIN_GAP : 0;
      // `ts`: a scheduled frame's time; none: forced (before tool / ok)
      const flush: Flush = ts => {
        if (typeof ts == 'number') {
          if (ts - lastTs < gap) return later(flush);
          lastTs = ts;
        }
        scheduled = false;
        if (!changed) return;
        const delta = pending;
        changed = false;
        pending = '';
        send(req.delta, {key, text, reasoning, delta, message: message()});
      };
      const grow = (type: string, d: string) => {
        const last = parts[parts.length - 1];
        // a reasoning part with providerMetadata is closed (L-2: a signed Anthropic thinking block)
        if (last && last.type == type && !last.providerMetadata) last.text += d;
        else parts.push({type, text: d});
        if (type == 'text') { text += d; pending += d; } else reasoning += d;
        changed = true;
        if (req.delta && !scheduled) { scheduled = true; later(flush); }
      };
      const toolPart = (ev: any) => parts.find(p => p.toolCallId === ev.id && p.type.startsWith('tool-'));
      const fail = (error: any) => {
        if (!live()) return;
        runs.delete(r);
        if (req.error) send(req.error, {key, error, request: req, ...(error && error.issues && {issues: error.issues})});
        else logError('SYG678', req.__emitterName, `makeChatDriver: request '${key}' failed with no error action`, FIX, error);
      };

      let events: any;
      try {
        events = transport.stream(req, ac.signal);
        for await (const ev of events) {
          if (!live()) return;
          const type = ev && typeof ev == 'object' ? ev.type : undefined;
          if (typeof type != 'string') malformed(req, ev, 'type');
          else if (type == 'text' || type == 'reasoning') {
            if (typeof ev.delta != 'string') malformed(req, ev, 'delta');
            else {
              if (ev.delta) grow(type, ev.delta);
              // L-2: `providerMetadata` on a reasoning event closes the reasoning part with it
              // (an Anthropic thinking signature, a redacted block), so it can be sent back
              if (type == 'reasoning' && ev.providerMetadata) {
                let last = parts[parts.length - 1];
                if (last?.type != 'reasoning' || last.providerMetadata) parts.push(last = {type, text: ''});
                last.providerMetadata = ev.providerMetadata;
              }
            }
          } else if (type == 'tool-call') {
            if (!ev.name || typeof ev.name != 'string') { malformed(req, ev, 'name'); continue; }
            flush();
            const call = {id: ev.id ?? `call_${++calls}`, name: ev.name, input: ev.input ?? {}};
            parts.push({type: 'tool-' + call.name, toolCallId: call.id, state: 'input-available', input: call.input, ...(ev.providerExecuted && {providerExecuted: true})});
            // L-2: a call the server runs (`executed`) is part of the message only
            if (!ev.executed) { toolCalls.push(call); send(req.tool, {key, call}); }
          } else if (type == 'tool-result' || type == 'tool-error' || type == 'tool-approval' || type == 'tool-denied') {
            const p = toolPart(ev);
            if (!p) malformed(req, ev, 'id');
            else if (type == 'tool-result') { p.state = 'output-available'; p.output = ev.output; }
            else if (type == 'tool-error') { p.state = 'output-error'; p.errorText = String(ev.error ?? ev.errorText ?? 'error'); }
            else if (type == 'tool-approval') { p.state = 'approval-requested'; p.approval = {...ev.approval}; }
            else { p.state = 'output-denied'; if (p.approval) p.approval = {...p.approval, approved: false}; }
          } else if (type == 'data' || type.startsWith('data-')) {
            const part: any = {type: type == 'data' ? 'data-' + (ev.name ?? 'value') : type, ...(ev.id !== undefined && {id: ev.id}), data: ev.data};
            const i = ev.id === undefined ? -1 : parts.findIndex(p => p.type == part.type && p.id === ev.id);
            i < 0 ? parts.push(part) : (parts[i] = part);
          } else if (type == 'file' || type.startsWith('source-')) {
            parts.push({...ev});
          } else if (type == 'start') {
            if (ev.id !== undefined) id = ev.id;
          } else if (type == 'finish') {
            if (ev.reason !== undefined) finishReason = ev.reason;
            if (ev.usage !== undefined) usage = ev.usage;
          }
          // other types: ignored (the Open Responses rule)
        }
        if (!live()) return;
        flush();
        let value: any;
        const structured = req.output !== undefined && (!toolCalls.length || !!text.trim());
        if (structured) {
          value = await readOutput(req.output, text);
          if (!live()) return;
        }
        runs.delete(r);
        send(req.ok, {key, message: message(), text, ...(structured && {value}), toolCalls, finishReason: finishReason ?? (toolCalls.length ? 'tool-calls' : 'stop'), usage});
      } catch (error: any) {
        fail(error);
      } finally {
        runs.delete(r);
      }
    };

    sink$.addListener({
      next: (req: any) => {
        if (disposed || req == null || req === false) return;
        if (typeof req != 'object') return void logError('SYG679', undefined, 'makeChatDriver: request not sent: not an object', FIX, req);
        if (!allowed(req, 'makeChatDriver')) return;
        const sender = senderOf(req);
        if (sender === undefined) return void dev('SYG677', req);
        const {abort} = req;
        if (abort !== undefined && abort !== false) {
          const k = abort === true ? req.key : abort;
          return abortWhere(r => r.sender === sender && (k === undefined || r.key === k));
        }
        const why = problem(req);
        if (why) return void logError('SYG679', req.__emitterName, `makeChatDriver: request not sent: ${why}`, FIX, req);
        start(req, sender);
      },
      error: () => {},
      complete: () => abortWhere(() => true),
    });

    const source = (): any => ({
      isolateSource: () => source(),
      isolateSink: (s$: any, scope: any) => s$.map((v: any) => tag(v, scope)),
      isolateValue: tag,
      ...replies,
      // what is in flight (renderComponent, inspect())
      __inspect: () => [...runs].map(r => ({sender: r.sender, key: r.key})),
    });
    return {...source(), dispose: () => { abortWhere(() => true); disposed = true; }};
  };
}

/** the isolation scope path a request carries, outermost first (tests) */
export const chatScopeOf = (req: any): any[] => (req && req[SCOPE]) || [];
