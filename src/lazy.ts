export function lazy(loadFn: () => Promise<any>): any {
  let cachedComponent: any = null;
  let loadError: any = null;

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
        sel: 'div', data: { attrs: { 'data-sygnal-lazy': 'loading' } },
        children: [], text: undefined, elm: undefined, key: undefined,
      };
    }
    return cachedComponent(viewArgs);
  }

  // Start loading eagerly and copy static properties when done
  const loadPromise = loadFn()
    .then((mod: any) => {
      cachedComponent = mod.default || mod;
      // Copy static properties so the component works on next render
      const statics = ['model', 'intent', 'hmrActions', 'context', 'peers', 'components',
        'initialState', 'calculated', 'storeCalculatedInState', 'DOMSourceName',
        'stateSourceName', 'onError', 'debug', 'componentName'];
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
  (LazyWrapper as any).__sygnalLazyPromise = loadPromise;
  (LazyWrapper as any).__sygnalLazyReRenderScheduled = false;

  return LazyWrapper;
}
