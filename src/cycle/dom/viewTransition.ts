import xs, {Stream} from 'xstream';
import type {VNode} from './snabbdom';

/**
 * PLAN-4 GS-12 (D129): the patch that something asked for runs inside
 * `document.startViewTransition()`. The ask is `flags().vt`, set by the core when a component's
 * `viewTransitions` action changes state (on the app's IsolateModule, so it is per app).
 *
 * - No API, or `prefers-reduced-motion: reduce`, or the first render: patched at once.
 * - P45-C: one action is one patch (the app's render scheduler flushes every component, a
 *   Collection move included, into one), so the update callback patches with the latest vnode
 *   that arrived before the browser called back, and is done once that patch is (no quiet
 *   window: it was 20 ms, capped at 200 ms, for the several patches of a move).
 * - A new transition while one animates: the browser skips the running one (it jumps to its end).
 * - G-489: a skipped transition's `ready` rejection is handled (no uncaught InvalidStateError).
 */
export function viewTransition$(vnode$: Stream<VNode>, flags: () => any): Stream<VNode> {
  const g: any = globalThis, out$ = xs.create<VNode>();
  let held: VNode[] | 0 = 0, first = 1;
  return xs.merge(vnode$.filter(v => {
    const f = flags() || {}, d = g.document, want = f.vt && !first;
    // the first render has no old view to transition from (a ROUTE reply at start asks too)
    f.vt = first = 0;
    if (held) return held[0] = v, false;
    if (!want || !d?.startViewTransition || g.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true;
    held = [v];
    const update = () => {
      const h = held as VNode[];
      held = 0;
      out$.shamefullySendNext(h[0]);
    };
    try {
      // G-489: a transition the browser skips (duplicate names, a newer one) rejects `ready`:
      // handled (the update still runs; `finished` / `updateCallbackDone` reject only when it throws)
      d.startViewTransition(update).ready.catch(Object);
    } catch (_) {
      // the browser refused (e.g. an invalid state): patch now
      update();
    }
    return false;
  }), out$);
}
