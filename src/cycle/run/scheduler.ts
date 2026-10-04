import xs, {Stream} from 'xstream';

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
 */
export type Scheduler = (k?: number, f?: () => void) => any;
export const B = 1e6;

export function makeScheduler(): Scheduler {
  let q: Record<number, Array<() => void>> = {}, on = 0, n = 0, seen = -1, y = 0;
  const flush = (): any => {
    if (seen != n && on++ < 10) return (seen = n, queueMicrotask(flush));
    for (let k: any; ; ) {
      k = undefined;
      for (k in q) break;
      if (k === undefined) return (on = y = 0, seen = -1);
      // before the patch, wait again for the reducers the renders caused (a new component's
      // resource served from a cache): they render in this flush, not in a second patch
      if (k >= 2 * B && !y++) return (seen = -1, queueMicrotask(flush));
      const a = q[k];
      delete q[k];
      for (const f of a) try { f(); } catch (e) { setTimeout(() => { throw e; }); }
    }
  };
  return (k, f) => {
    if (!f) return n++;
    (q[k!] ||= []).push(f);
    on || (on = 1, queueMicrotask(flush));
  };
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
