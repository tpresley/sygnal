import {makeReplies} from './replies';

/*
 * makeTimerDriver() (PLAN-4 GS-7, D114): timers declared per component instance from state,
 * answered with reply actions (./replies.ts). Registered: `run(App, { TIMER: makeTimerDriver() })`.
 * The core has no timer code (0 B): it sends a component's `timers` static to the source marked
 * `__sygnalStatic: 'timers'` (initStatics), stamped with the sender (`__emitterId`).
 *
 * - Declaration: `C.timers = (state) => ({ [name]: spec | falsy })`, spec one of
 *   `{ every: ms, action }`, `{ after: ms, action }`, `{ frame: 'ACTION' }`, each with an
 *   optional `background: true`.
 * - Diffed per (sender, name), comparing specs structurally: a new name starts, a removed or
 *   falsy one stops, a changed spec restarts (an equal one keeps running).
 * - `every`: drift-free; tick n is due at start + n * every (each delay is computed from the
 *   start, not chained). A late tick (a throttled background tab) coalesces the missed ones:
 *   n jumps. Data `{ n, t }`: the tick number from 1, `t` = Date.now().
 * - `after`: fires once, data `{ t }`. It doesn't fire again while the same spec stays declared.
 * - `frame`: every animation frame (requestAnimationFrame; setTimeout 16 ms without it), data
 *   `{ t, dt }`: Date.now() and the ms since the previous frame (0 on the first).
 * - A hidden Switchable page's timers stop unless `background: true` (the core sends only those
 *   while hidden) and start again from scratch when it is shown.
 * - A disposed instance's timers stop; app dispose stops all. SSR runs no drivers: no timers.
 * - An invalid spec (non-positive `every`, negative `after`, no action) doesn't start; the dev
 *   entry reports SYG422 through the `timerSpec` diagnostics hook.
 */

const g: any = globalThis;
const now = () => Date.now();

const valid = (s: any) => s.frame
  ? typeof s.frame == 'string'
  : typeof s.action == 'string' && !!s.action && (s.every == null ? s.after >= 0 : s.after == null && s.every > 0) && (s.every || s.after) < 1 / 0;

// starts one timer; `e` (its entry) gets `d` once an `after` has fired. Returns the stop function.
// The next tick / frame is scheduled before the action is sent, so an action that stops (or
// changes) the timer clears the pending one.
const start = (s: any, send: (type: string, data: any) => void, e: any): (() => void) => {
  let id: any, n = 0, last: any;
  const t0 = now(), every = s.every, raf = s.frame && g.requestAnimationFrame;
  const later = (ms: number) => id = raf ? requestAnimationFrame(tick) : setTimeout(tick, ms);
  // a frame's `ts` is requestAnimationFrame's timestamp (the fallback passes none: the clock)
  const tick = (ts = now()) => {
    const t = now();
    if (s.frame) {
      later(16);
      send(s.frame, {t, dt: last == null ? 0 : ts - last});
      last = ts;
    } else if (every) {
      n = Math.max(n + 1, Math.floor((t - t0) / every));
      later(t0 + (n + 1) * every - t);
      send(s.action, {n, t});
    } else {
      e.d = 1;
      send(s.action, {t});
    }
  };
  later(s.frame ? 16 : every || s.after);
  return () => raf ? cancelAnimationFrame(id) : clearTimeout(id);
};

/**
 * The driver over `runners` (sender → { c: component name, on: { [name]: entry } }, an entry
 * being { k: the spec's JSON, s: the spec, x: stop, ok: started, d: an `after` that fired }).
 * The testing fake passes its own map to list the active timers (t.timers).
 */
export const timerDriver = (runners: Map<any, any>) => (sink$: any) => {
  const update = (id: any, d: any, c?: any) => {
    let r = runners.get(id);
    if (!r) runners.set(id, r = {c, on: {}});
    const on = r.on;
    for (const n in on) if (on[n].k != JSON.stringify(d?.[n])) on[n].x(), delete on[n];
    for (const n in d) {
      const s = d[n];
      if (!s || on[n]) continue;
      const e: any = on[n] = {k: JSON.stringify(s), s, x: () => {}};
      if (e.ok = valid(s)) e.x = start(s, (type, data) => reply(id, type, data), e);
      else g.__SYGNAL_DIAGNOSTICS__?.timerSpec?.(n, s, c);
    }
    if (!d) runners.delete(id);
  };
  const stopAll = () => runners.forEach((_, id) => update(id, 0));
  const {replies, reply} = makeReplies(id => update(id, 0));
  sink$.addListener({
    next: (v: any) => { if (v && v.__emitterId !== undefined && 'timers' in v) update(v.__emitterId, v.timers, v.__emitterName); },
    error: () => {},
    complete: stopAll,
  });
  return {...replies, __sygnalStatic: 'timers', dispose: stopAll};
};

/**
 * Timers declared by components (`C.timers = (state) => ({ tick: state.running && { every: 100,
 * action: 'TICK' } })`), delivered as their own actions: `run(App, { TIMER: makeTimerDriver() })`.
 */
export const makeTimerDriver = () => timerDriver(new Map());
