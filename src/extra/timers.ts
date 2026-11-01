import {makeReplies} from './replies';
import {frameBegin, frameEnd} from './frame';

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
 *   n jumps. A delay is at most `every`, so a frozen Date.now() (a test clock that fixes the time
 *   while timers run) ticks once per interval. Data `{ n, t }`: the tick number from 1, `t` = Date.now().
 * - `after`: fires once, data `{ t }`. It doesn't fire again while the same spec stays declared.
 * - `frame`: every animation frame (requestAnimationFrame; setTimeout 16 ms without it), data
 *   `{ t, dt }`: Date.now() and the ms since the previous frame (0 on the first). The actions are
 *   delivered inside the frame phase (./frame.ts): widgets paint at the end of this frame.
 *   canvas-game R2, for games:
 *   - `keys: { left: ['ArrowLeft', 'KeyA'], jump: 'Space' }` (KeyboardEvent codes, or keys): the
 *     input sampled with the frame. The data gets `held` ({ left: true, jump: false }, the same
 *     object while nothing changed), `pressed` / `released` (the names that went down / up since
 *     the last frame: a tap shorter than a frame still counts). Listeners on the document while
 *     the timer runs; the listed keys are default-prevented (repeats ignored), not while a text
 *     field has the focus; the window losing focus or the page hiding releases every key.
 *   - `step: ms` (a fixed timestep, `max` steps a frame, default 5): one action per whole step the
 *     frame time owes (the remainder carried to the next frame), data `{ t, dt: step, steps, i }`
 *     (+ the keys: `pressed` / `released` on the frame's first step only); a frame that owes no
 *     step sends nothing (its presses wait for the next step).
 * - A hidden Switchable page's timers stop unless `background: true` (the core sends only those
 *   while hidden) and start again from scratch when it is shown.
 * - A disposed instance's timers stop; app dispose stops all. SSR runs no drivers: no timers.
 * - An invalid spec (non-positive `every`, negative `after`, no action) doesn't start; the dev
 *   entry reports SYG422 through the `timerSpec` diagnostics hook.
 */

const g: any = globalThis;
const now = () => Date.now();

const valid = (s: any) => s.frame
  ? typeof s.frame == 'string' && (s.step == null || s.step > 0) && (s.keys == null || typeof s.keys == 'object')
  : typeof s.action == 'string' && !!s.action && (s.every == null ? s.after >= 0 : s.after == null && s.every > 0) && (s.every || s.after) < 1 / 0;

const TYPING = /^(INPUT|TEXTAREA|SELECT)$/;
const EMPTY: string[] = [];
/**
 * R2: the keys a frame timer samples. Returns `take()` (the input since the last take) and `stop()`.
 * No document (SSR, a worker): nothing is held, ever.
 */
const keyInput = (map: Record<string, string | string[]>) => {
  const names = new Map<string, string>();
  for (const n in map) for (const c of ([] as string[]).concat(map[n])) names.set(c, n);
  const doc = g.document, down = new Map<string, string>();
  let held: Record<string, boolean> = {}, changed = false, pressed = new Set<string>(), released = new Set<string>();
  for (const n in map) held[n] = false;
  const isHeld = (n: string) => { for (const v of down.values()) if (v == n) return true; return false; };
  const set = (n: string, on: boolean) => {
    if (held[n] == on) return;
    held = {...held, [n]: on};
    changed = true;
    (on ? pressed : released).add(n);
  };
  const kd = (e: any) => {
    const code = names.has(e.code) ? e.code : e.key, n = names.get(code);
    if (!n || TYPING.test(e.target?.tagName) || e.target?.isContentEditable) return;
    e.preventDefault();
    if (e.repeat || down.has(code)) return;
    down.set(code, n);
    set(n, true);
  };
  const ku = (e: any) => {
    const code = down.has(e.code) ? e.code : e.key, n = down.get(code);
    if (!n) return;
    down.delete(code);
    if (!isHeld(n)) set(n, false);
  };
  const all = () => { for (const [, n] of down) set(n, false); down.clear(); };
  const vis = () => { if (doc.hidden) all(); };
  const win = doc?.defaultView || g;
  doc?.addEventListener('keydown', kd);
  doc?.addEventListener('keyup', ku);
  doc?.addEventListener('visibilitychange', vis);
  win?.addEventListener?.('blur', all);
  return {
    take() {
      const r = {held, pressed: pressed.size ? [...pressed] : EMPTY, released: released.size ? [...released] : EMPTY};
      if (changed) pressed = new Set(), released = new Set(), changed = false;
      return r;
    },
    stop() {
      doc?.removeEventListener('keydown', kd);
      doc?.removeEventListener('keyup', ku);
      doc?.removeEventListener('visibilitychange', vis);
      win?.removeEventListener?.('blur', all);
    },
  };
};

// starts one timer; `e` (its entry) gets `d` once an `after` has fired. Returns the stop function.
// The next tick / frame is scheduled before the action is sent, so an action that stops (or
// changes) the timer clears the pending one.
const start = (s: any, send: (type: string, data: any) => void, e: any): (() => void) => {
  let id: any, n = 0, last: any, acc = 0;
  const t0 = now(), every = s.every, raf = s.frame && g.requestAnimationFrame;
  const keys = s.frame && s.keys ? keyInput(s.keys) : null, max = s.max || 5;
  const later = (ms: number) => id = raf ? requestAnimationFrame(tick) : setTimeout(tick, ms);
  // a frame's `ts` is requestAnimationFrame's timestamp (the fallback passes none: the clock)
  const tick = (ts = now()) => {
    const t = now();
    if (s.frame) {
      later(16);
      const dt = last == null ? 0 : ts - last;
      last = ts;
      frameBegin();
      try {
        if (s.step) {
          // a frame within 5 % of the step is one step (vsync snapping: rAF intervals jitter around
          // 16.67 ms, and an accumulator fed the jitter alternates 0 and 2 steps: a stutter)
          acc = Math.min(acc + (Math.abs(dt - s.step) < s.step * 0.05 ? s.step : dt), s.step * max);
          const steps = Math.floor(acc / s.step + 1e-9);
          acc -= steps * s.step;
          for (let i = 0; i < steps; i++) {
            const k = keys && keys.take();
            send(s.frame, k ? {t, dt: s.step, steps, i, ...k} : {t, dt: s.step, steps, i});
          }
        } else {
          const k = keys && keys.take();
          send(s.frame, k ? {t, dt, ...k} : {t, dt});
        }
      } finally { frameEnd(); }
    } else if (every) {
      n = Math.max(n + 1, Math.floor((t - t0) / every));
      // never more than one interval: under a frozen Date.now() (Playwright's setFixedTime: Date is
      // fixed, timers run) the drift-free delay grew by one interval per tick
      later(Math.min(every, t0 + (n + 1) * every - t));
      send(s.action, {n, t});
    } else {
      e.d = 1;
      send(s.action, {t});
    }
  };
  later(s.frame ? 16 : every || s.after);
  return () => { keys?.stop(); raf ? cancelAnimationFrame(id) : clearTimeout(id); };
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
