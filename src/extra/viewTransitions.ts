import type {Stream} from 'xstream';
import type {VNode} from '../cycle/dom/snabbdom';
import {makeDOMDriver, DOMDriverOptions} from '../cycle/dom/makeDOMDriver';
import {viewTransition$} from '../cycle/dom/viewTransition';

/**
 * PLAN-4 GS-12 (D129): a DOM driver that can patch inside `document.startViewTransition()`.
 * It is `makeDOMDriver(mountPoint, options)`, as run()'s own DOM driver, plus the hook: the patch caused by an action listed in a component's
 * `viewTransitions` static (`Board.viewTransitions = ['MOVE']`, `App.viewTransitions = ['ROUTE']`)
 * runs as a View Transition. Opt-in, so the hook costs nothing in apps that don't import it.
 *
 *     run(App, { DOM: makeViewTransitionDOMDriver('#root') })
 */
export function makeViewTransitionDOMDriver(mountPoint: string | Element | DocumentFragment = '#root', options: DOMDriverOptions = {}) {
  const inner: any = makeDOMDriver(mountPoint, options);
  return (vnode$: Stream<VNode>, name?: string) => {
    let source: any;
    // the flags live on the driver's IsolateModule (the core sets `vt` there; it is per app),
    // which exists once the inner driver has run: read lazily, at the first vnode
    source = inner(viewTransition$(vnode$, () => source?._isolateModule), name);
    const im = source._isolateModule;
    // SYG645 (dev): this app's DOM driver can do View Transitions
    im.vtDriver = 1;
    // a request is consumed by the next vnode (viewTransition$ resets it), however late: a render
    // may take long. It expires when the page has been idle for 100 ms without one, since a listed
    // action whose new state renders the same view (the first ROUTE reply, say) sends no vnode and
    // must not animate a later, unrelated patch. A slow render keeps the main thread busy, so the
    // expiry timer then runs late: it is re-armed instead (late by more than 30 ms = busy)
    let on = 0, t: any;
    const expire = (due: number): any => t = setTimeout(() => Date.now() - due > 30 ? expire(Date.now() + 100) : on = 0, 100);
    Object.defineProperty(im, 'vt', {
      configurable: true,
      get: () => on,
      set: (v: any) => { clearTimeout(t); (on = v ? 1 : 0) && expire(Date.now() + 100); },
    });
    return source;
  };
}
