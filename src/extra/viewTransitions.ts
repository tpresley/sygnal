import type {Stream} from 'xstream';
import type {VNode} from '../cycle/dom/snabbdom';
import {makeDOMDriver, DOMDriverOptions} from '../cycle/dom/makeDOMDriver';
import {viewTransition$} from '../cycle/dom/viewTransition';

/**
 * PLAN-4 GS-12 (D129): a DOM driver that can patch inside `document.startViewTransition()`.
 * It is `makeDOMDriver(mountPoint, options)` with the same defaults as run()'s own DOM driver
 * (fragments on), plus the hook: the patch caused by an action listed in a component's
 * `viewTransitions` static (`Board.viewTransitions = ['MOVE']`, `App.viewTransitions = ['ROUTE']`)
 * runs as a View Transition. Opt-in, so the hook costs nothing in apps that don't import it.
 *
 *     run(App, { DOM: makeViewTransitionDOMDriver('#root') })
 */
export function makeViewTransitionDOMDriver(mountPoint: string | Element | DocumentFragment = '#root', options: DOMDriverOptions = {}) {
  const inner: any = makeDOMDriver(mountPoint, {...options, snabbdomOptions: {experimental: {fragments: true}, ...options.snabbdomOptions}} as any);
  return (vnode$: Stream<VNode>, name?: string) => {
    let source: any;
    // the flags live on the driver's IsolateModule (the core sets `vt` there; it is per app),
    // which exists once the inner driver has run: read lazily, at the first vnode
    source = inner(viewTransition$(vnode$, () => source?._isolateModule), name);
    const im = source._isolateModule;
    // SYG645 (dev): this app's DOM driver can do View Transitions
    im.vtDriver = 1;
    // a request expires after 100 ms: a listed action whose new state renders the same view
    // (the first ROUTE reply, say) sends no patch, and must not animate a later, unrelated one
    let at = 0;
    Object.defineProperty(im, 'vt', {
      configurable: true,
      get: () => at > Date.now() - 100,
      set: (v: any) => { at = v ? Date.now() : 0; },
    });
    return source;
  };
}
