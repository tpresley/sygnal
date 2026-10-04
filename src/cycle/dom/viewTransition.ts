import xs, {Stream} from 'xstream';
import type {VNode} from './snabbdom';

/**
 * PLAN-4 GS-12 (D129): the patch that something asked for runs inside
 * `document.startViewTransition()`. The ask is `flags().vt`, set by the core when a component's
 * `viewTransitions` action changes state (on the app's IsolateModule, so it is per app).
 *
 * - No API, or `prefers-reduced-motion: reduce`, or the first render: patched at once.
 * - One action is several patches (a Collection move: removed from one list, added to the other
 *   a few ms later), so vnodes that arrive before the browser calls back are folded into one
 *   (the latest wins), and the update callback resolves only after 20 ms without a patch. The
 *   page shows the old snapshot meanwhile, so the in-between states never paint.
 * - The window is capped at 200 ms: an app that renders continuously must not freeze the page.
 * - A new transition while one animates: the browser skips the running one (it jumps to its end).
 */
export function viewTransition$(vnode$: Stream<VNode>, flags: () => any): Stream<VNode> {
  const g: any = globalThis, out$ = xs.create<VNode>();
  let held: VNode[] | 0 = 0, quiet: any = 0, t: any, first = 1;
  return xs.merge(vnode$.filter(v => {
    const f = flags() || {}, d = g.document, want = f.vt && !first;
    // the first render has no old view to transition from (a ROUTE reply at start asks too)
    f.vt = first = 0;
    if (held) return held[0] = v, false;
    if (quiet) return quiet(), true;
    if (!want || !d?.startViewTransition || g.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true;
    held = [v];
    const update = () => new Promise(r => {
      const end = () => { quiet = 0; r(0); }, cap = setTimeout(end, 200);
      (quiet = () => { clearTimeout(t); t = setTimeout(() => { clearTimeout(cap); end(); }, 20); })();
      const h = held as VNode[];
      held = 0;
      out$.shamefullySendNext(h[0]);
    });
    try {
      d.startViewTransition(update);
    } catch (_) {
      // the browser refused (e.g. an invalid state): patch now
      update();
    }
    return false;
  }), out$);
}
