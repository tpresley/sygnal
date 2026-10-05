// the core's resolver for lazy components, registered on import (D157)
import './core/markers/lazy';
import {posts} from './core/registry';

/**
 * PLAN-5 B-4 (D103): `when` defers the import: 'visible' starts it when a placeholder enters the
 * viewport (IntersectionObserver, `rootMargin`; at once without one), 'idle' when the browser is
 * idle after a placeholder is on the page (requestIdleCallback with a 2 s timeout; setTimeout
 * without it). Until then the placeholder is the loading one plus `data-sygnal-when`; a Suspense
 * boundary shows its fallback, and (wrapped below, only once a `when` is used: 0 B otherwise)
 * keeps the deferred placeholders in its pending div, before the fallback, so they can be seen.
 * SSR and renderComponent's mock DOM run no hooks: the placeholder stays until `load()`
 * (preloading, e.g. on hover). All instances share one import.
 */
export interface LazyOptions {
  when?: 'visible' | 'idle';
  /** 'visible': the IntersectionObserver's rootMargin ('200px' starts the import a little earlier) */
  rootMargin?: string;
}

const WHEN = 'data-sygnal-when';
// the deferred placeholders under `v` (an injected child's vnode too), not below an inner boundary
const deferred = (v: any, out: any[]): any[] => {
  if (v?.sel && v.sel != 'suspense') v.data?.attrs?.[WHEN] ? out.push(v) : v.children?.forEach((c: any) => deferred(c, out));
  return out;
};
// a boundary with deferred placeholders gets a fallback that holds them (display: contents)
const keep = (v: any): any => {
  if (!v?.sel || v.data?.isolate) return v;
  let c = v.children, out: any;
  c?.forEach((k: any, i: number) => { const o = keep(k); if (o !== k) (out ||= c.slice())[i] = o; });
  if (out) v = {...v, children: c = out};
  const f = v.sel == 'suspense' && v.data?.props?.fallback, ph = f ? deferred({sel: 1, children: c}, []) : [];
  return ph.length ? {...v, data: {...v.data, props: {...v.data.props, fallback: {sel: 'div', data: {style: {display: 'contents'}}, children: [...ph, typeof f == 'string' ? {text: f} : f]}}}} : v;
};
let kept: any;
const keepDeferred = () => {
  const p = posts.suspense;
  if (p && !kept) posts.suspense = kept = (v: any, o: any) => p(keep(v), o);
};

export function lazy(loadFn: () => Promise<any>, options?: LazyOptions): any {
  let cachedComponent: any = null;
  let loadError: any = null;
  const g: any = globalThis, when = options?.when;
  // the deferred import's trigger (once), its observer, the placeholder's hooks
  let go: any, io: any;
  const start = () => { io?.disconnect(); go?.(); go = 0; };
  const arm = (v: any) => {
    if (!go) return;
    if (when == 'idle') {
      const f = () => start();
      g.requestIdleCallback ? g.requestIdleCallback(f, {timeout: 2000}) : setTimeout(f, 1);
    } else if (!g.IntersectionObserver) start();
    else (io ||= new g.IntersectionObserver((es: any[]) => es.some(e => e.isIntersecting) && start(), {rootMargin: options?.rootMargin})).observe(v.elm);
  };
  const hook = when && {insert: arm, update: (_: any, v: any) => when != 'idle' && arm(v), destroy: (v: any) => io?.unobserve(v.elm)};
  if (when) keepDeferred();

  // View function that delegates to the loaded component
  function LazyWrapper(viewArgs: any) {
    if (loadError) {
      return {
        sel: 'div', data: { attrs: { 'data-sygnal-error': 'lazy' } },
        children: [], text: undefined, elm: undefined, key: undefined,
      };
    }
    if (!cachedComponent) {
      return {
        sel: 'div', data: { attrs: { 'data-sygnal-lazy': 'loading', ...go && { [WHEN]: when } }, ...go && { hook } },
        children: [], text: undefined, elm: undefined, key: undefined,
      };
    }
    return cachedComponent(viewArgs);
  }

  // Start loading eagerly (with `when`, once triggered) and copy static properties when done
  const loadPromise = (when ? new Promise(r => go = r).then(loadFn) : loadFn())
    .then((mod: any) => {
      cachedComponent = mod.default || mod;
      (LazyWrapper as any).__sygnalLazyLoadedComponent = cachedComponent;
      // Copy static properties so the component works on next render
      const statics = ['model', 'intent', 'context', 'initialState', 'calculated', 'isolatedState',
        'onError', 'debug', 'componentName', 'connections', 'resources', 'route', 'head', 'uses', 'timers', 'persist', 'viewTransitions', 'browser'];
      for (const key of statics) {
        if (cachedComponent[key] !== undefined && (LazyWrapper as any)[key] === undefined) {
          (LazyWrapper as any)[key] = cachedComponent[key];
        }
      }
    })
    .catch((err: any) => {
      loadError = err;
      console.error('[lazy] Failed to load component:', err);
    });

  // Expose lazy loading metadata for Suspense detection
  (LazyWrapper as any).__sygnalLazy = true;
  (LazyWrapper as any).__sygnalLazyLoaded = () => cachedComponent !== null;
  (LazyWrapper as any).__sygnalLazyLoadedComponent = null;
  (LazyWrapper as any).__sygnalLazyPromise = loadPromise;
  (LazyWrapper as any).__sygnalLazyReRenderScheduled = false;
  // start the import now (a deferred one too); resolves once it has loaded (or failed)
  (LazyWrapper as any).load = () => (start(), loadPromise);

  return LazyWrapper;
}
