// the core's resolver for lazy components (D157), registered by the first lazy() call (G-751)
import {enableLazy, track} from './core/markers/lazy';

/**
 * 7.3: without `when` (or `when: 'render'`) the import starts the first time the component
 * renders (as React.lazy): a route table of lazy pages fetches only the page shown. Where there is
 * no `document` (SSR), it starts at lazy() as before, so the server has the component.
 * PLAN-5 B-4 (D103): `when` defers the import further: 'visible' starts it when a placeholder
 * enters the viewport (IntersectionObserver, `rootMargin`; at once without one), 'idle' when the
 * browser is idle after a placeholder is on the page (requestIdleCallback with a 2 s timeout;
 * setTimeout without it). Until then the placeholder is data-sygnal-lazy="deferred" (not
 * "loading": a Suspense boundary doesn't wait for it, G-385) plus `data-sygnal-when`, in its own
 * place, so it can scroll into view; once the import starts the owners render again
 * (markers/lazy.ts) and it is the loading one. `placeholderHeight` gives the placeholders a
 * min-height (empty ones stacked together would all be visible at once).
 * SSR runs no hooks: a deferred placeholder stays. renderComponent starts every import when the
 * component renders, and settle() waits for it (markers/lazy.ts). `load()` starts it now
 * (preloading, e.g. on hover; any number of times). All instances share one import.
 * 7.3: a failed import isn't kept: the owners render their onError fallback in its place
 * (markers/lazy.ts), and the next `load()`, or the next time the component is mounted, imports
 * again (a chunk that failed on a flaky network, or a reload offered after a deploy).
 */
export interface LazyOptions {
  when?: 'render' | 'visible' | 'idle';
  /** 'visible': the IntersectionObserver's rootMargin ('200px' starts the import a little earlier) */
  rootMargin?: string;
  /** the placeholder's min-height (a number: px), e.g. the component's expected height */
  placeholderHeight?: number | string;
}

const WHEN = 'data-sygnal-when';
const STATICS = ['model', 'intent', 'context', 'initialState', 'calculated', 'isolatedState',
  'onError', 'debug', 'componentName', 'connections', 'resources', 'route', 'head', 'uses', 'timers', 'persist', 'viewTransitions', 'browser'];

export function lazy(loadFn: () => Promise<any>, options?: LazyOptions): any {
  enableLazy();
  const W: any = LazyWrapper;
  let cachedComponent: any = null;
  let loadError: any = null;
  const g: any = globalThis, ph = options?.placeholderHeight;
  // no `when`: at the first render in a browser; at once on a server (0)
  const when = options?.when || (g.document ? 'render' : 0), deferred = when == 'visible' || when == 'idle';
  // the import's trigger (once per attempt), its observer, the placeholder's hooks
  let go: any, io: any;
  const start = () => { io?.disconnect(); go && go(); go = 0; };
  const arm = (v: any) => {
    if (!go) return;
    if (when == 'idle') {
      const f = () => start();
      g.requestIdleCallback ? g.requestIdleCallback(f, {timeout: 2000}) : setTimeout(f, 1);
    } else if (!g.IntersectionObserver) start();
    else (io ||= new g.IntersectionObserver((es: any[]) => es.some(e => e.isIntersecting) && start(), {rootMargin: options?.rootMargin})).observe(v.elm);
  };
  const hook = deferred && {insert: arm, update: (_: any, v: any) => when != 'idle' && arm(v), destroy: (v: any) => io?.unobserve(v.elm)};
  const style = ph != null && {minHeight: typeof ph == 'number' ? ph + 'px' : ph};

  // View function that delegates to the loaded component
  function LazyWrapper(viewArgs: any) {
    if (cachedComponent) return cachedComponent(viewArgs);
    // (rendered alone, as a root: its own error placeholder; under an owner: markers/lazy.ts)
    if (loadError) {
      return {
        sel: 'div', data: { attrs: { 'data-sygnal-error': 'lazy' } },
        children: [], text: undefined, elm: undefined, key: undefined,
      };
    }
    if (when == 'render') start();
    return {
      sel: 'div', data: { attrs: { 'data-sygnal-lazy': go ? 'deferred' : 'loading', ...go && { [WHEN]: when } }, ...go && { hook }, ...style && { style } },
      children: [], text: undefined, elm: undefined, key: undefined,
    };
  }

  // an attempt: at once (`now`: a retry, or no `when` on a server) or once started; it copies the
  // component's statics when done, so it works on the next render
  const attempt = (now?: boolean) => {
    loadError = null;
    const started = !now && new Promise(r => go = r);
    // (a deferred import's start: G-385, Suspense waits for its placeholder from then on)
    W.__sygnalLazyStarted = deferred && started || undefined;
    return W.__sygnalLazyPromise = (started ? started.then(loadFn) : new Promise(r => r(loadFn())))
      .then((mod: any) => {
        W.__sygnalLazyLoadedComponent = cachedComponent = mod.default || mod;
        for (const key of STATICS) {
          if (cachedComponent[key] !== undefined && W[key] === undefined) W[key] = cachedComponent[key];
        }
      }, (err: any) => {
        loadError = err;
        console.error('[lazy] Failed to load component:', err);
      });
  };

  // Expose lazy loading metadata for Suspense detection
  W.__sygnalLazy = true;
  W.__sygnalLazyLoaded = () => cachedComponent !== null;
  W.__sygnalLazyLoadedComponent = null;
  // the failure of the last attempt (markers/lazy.ts renders the owners' onError), and a start
  // that doesn't retry it (renderComponent starting a deferred import)
  W.__sygnalLazyError = () => loadError;
  W.__sygnalLazyStart = start;
  W.__sygnalLazyReRenderScheduled = false;
  attempt(!when);
  // start the import now (a deferred one too), or again after a failure; resolves once it has
  // loaded (or failed)
  // (a retry's waiting set now: the owners showing its failure render again when it settles)
  W.load = () => loadError ? (attempt(true), track(W).p) : (start(), W.__sygnalLazyPromise);

  return LazyWrapper;
}
