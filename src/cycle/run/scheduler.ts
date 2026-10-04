import xs, {Stream, NO} from 'xstream';

/**
 * P45-C: the render scheduler, one per app (the root component makes it and its children inherit
 * it through their sources as `__k`; never module-global, G-231). A render stage marks itself
 * dirty with a key; the flush runs once per tick and runs the stages in ascending key order, each
 * once, with its latest input:
 * - `d` (a component's depth): render. Parents before children, so a child renders once with
 *   its parent's new props.
 * - `B - d`: put the children's views into the parent's. Children before parents, after every
 *   render, so each component does it once.
 * - `2 * B`: the root's view goes to the DOM driver: one patch per flush.
 * A stage dirtied during the flush runs in the same flush; a reducer applied after it gets the
 * next flush (never a nested one). Keys are integers below 2^32 - 1, which for-in visits in
 * ascending order.
 *
 * The flush is a microtask, after the reducer queue drains: it waits a microtask more while STATE
 * actions keep coming (`s()` counts one), before the renders and again before the patch, so a
 * reply a driver sends in a microtask (a cached resource, say) is in the same patch (at most 10
 * hops; never a timer, never rAF).
 *
 * G-257: a new component's first render waits for its intent, which starts on a timer (`s.t(ms, f,
 * 1)`: a gate). While a gate is pending the patch is held (the stages before it run), so a move
 * between Collections whose items have intent and model is still one patch. The timer flushes
 * again. Holds stop 50 ms after the first one (a chain of new components, a timer that never
 * fires: neither holds the patch for long): a held flush sets a timer that flushes then (G-273),
 * and a hold that outlasts the bound drops the pending gates (a lost gate timer, e.g.
 * vi.clearAllTimers(), can't hold every later patch; a gate that fires after that can't make the
 * count negative).
 */
export type Scheduler = ((k?: number, f?: () => void) => any) & {t?: (ms: number, f: () => void, h?: any) => void, r?: any};
export const B = 1e6;
// runs f; an error is rethrown asynchronously (the others in the loop still run)
const safe = (f: () => void) => { try { f(); } catch (e) { setTimeout(() => { throw e; }); } };

export function makeScheduler(): Scheduler {
  let q: Record<number, Array<() => void>> = {}, on = 0, n = 0, seen = -1, y = 0, g = 0, x = 0, c = 0, p: any = 0;
  // G-260: flushes are counted (reset by a timer the 9th sets): after 100 in a macrotask (a
  // patch -> element -> action loop that never settles) the next one waits for a macrotask.
  // G-274: the capped flush's timer resets the count too, and it doesn't set `on`. G-283: one
  // capped timer at a time (one per capped go() made a loop that dirties K stages set ~K timers
  // per macrotask, each resetting the count). A lost one is set again by the next go() if it was
  // set with a setTimeout since replaced (fake timers switched, a stub), else by every 100th
  // capped go() (vi.clearAllTimers())
  const go = (): any => on || (++c > 99 ? p == setTimeout && c % 100 || (p = setTimeout, setTimeout(() => (p = c = 0, go()))) : (c == 9 && setTimeout(() => c = 0), on = 1, queueMicrotask(flush)));
  const flush = (): any => {
    if (seen != n && on++ < 10) return (seen = n, queueMicrotask(flush));
    for (let k: any; ; ) {
      k = undefined;
      for (k in q) break;
      if (k === undefined) return (on = y = 0, seen = -1);
      // before the patch, wait again for the reducers the renders caused (a new component's
      // resource served from a cache): they render in this flush, not in a second patch
      if (k >= 2 * B) {
        if (!y++) return (seen = -1, queueMicrotask(flush));
        // the hold's age (a clock that went back, fake timers switched to real, ends it); each
        // held flush sets a timer that flushes after the bound (one of them may be lost)
        if (g && (Date.now() - (x ||= Date.now())) >>> 0 < 50) return (setTimeout(go, 51), on = y = 0, seen = -1);
        g = x = 0;
      }
      const a = q[k];
      delete q[k];
      a.forEach(safe);
    }
  };
  const s: Scheduler = (k, f) => {
    if (!f) return n++;
    (q[k!] ||= []).push(f);
    go();
  };
  // P45-D: s.t(ms, f): the components created together start together, one timer per delay
  // (their INITIALIZE at 0 ms, their intents 1 or 10 ms later), not one each. G-266/G-270: a
  // timer is shared within the microtask that set it only (one set earlier may have been
  // cleared, or its 0 ms sibling may have fired)
  const t: Record<number, Array<() => void>> = {};
  s.t = (ms, f, h) => {
    let a = t[ms];
    if (!a) {
      a = t[ms] = [];
      queueMicrotask(() => delete t[ms]);
      setTimeout(() => {
        a.forEach(safe);
        go();
      }, ms);
    }
    a.push(h ? (g++, () => (g && g--, f())) : f);
  };
  return s;
}

/**
 * The stage: emits its input's latest value once at the flush (without a scheduler: at once).
 * While `w()` is truthy the value is held; the returned stream's `go()` schedules it again.
 */
export const batch = (s: Scheduler | undefined, k: number, w?: () => any) => (in$: Stream<any>): any => {
  if (!s) return in$;
  let v: any, h = 0, sub: any, l: any;
  const emit = () => { if (h && !w?.()) h = 0, l.next(v); };
  const out: any = xs.create({
    start: (L: any) => {
      l = L;
      h = 0;
      sub = in$.subscribe({
        next: (x: any) => { v = x; h++ || s(k, emit); },
        error: (e: any) => l.error(e),
        complete: () => { if (h) h = 0, l.next(v); l.complete(); },
      });
    },
    stop: () => { h = 0; sub?.unsubscribe(); },
  });
  out.go = () => h && s(k, emit);
  return out;
};

/**
 * P45-D: teardown. xstream stops a stream left without listeners in its own setTimeout (one per
 * stream: ~70 for a disposed component). Inside tearDown(f) (a dispose) such a stream is queued
 * instead (_stopID 0: an _add before the stop cancels it, as with xstream's timer) and the
 * queue is stopped by one timer at the next macrotask; the streams those stops leave without
 * listeners are queued for the next one. So every stream stops at the macrotask it would have
 * with xstream (a stream that another instance, created in the same update, listens to again is
 * kept running), with one timer per level instead of one per stream. Outside tearDown xstream is
 * unchanged.
 */
let down = 0, q: any[] = [];
const SP: any = Stream.prototype, rm = SP._remove;
SP._remove = function (this: any, il: any) {
  if (!down || this._target) return rm.call(this, il);
  const a = this._ils, i = a.indexOf(il);
  if (i < 0) return;
  a.splice(i, 1);
  if (this._prod !== NO && !a.length) this._err = NO, this._stopID = 0, q.push(this);
  else if (a.length == 1) this._pruneCycles();
};
export const tearDown = (f: () => void): void => {
  const mine = down++ ? q : (q = []);
  try { f(); } finally {
    --down || mine.length && setTimeout(() => tearDown(() => mine.forEach(s => safe(() => s._stopID === 0 && s._stopNow()))));
  }
};
