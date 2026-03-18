import {setup} from '../cycle/run/index';
import {withState} from '../cycle/state/index';
import {makeDOMDriver} from '../cycle/dom/index';
import eventBusDriver from './eventDriver';
import logDriver from './logDriver';
import component, {ABORT} from '../component';
import {getDevTools} from './devtools';

interface RunOptions {
  mountPoint?: string;
  fragments?: boolean;
  useDefaultDrivers?: boolean;
}

interface SygnalRunResult {
  sources: any;
  sinks: any;
  dispose: () => void;
  hmr?: (newComponent: any, explicitState?: any) => void;
}

export default function run(
  app: any,
  drivers: Record<string, any> = {},
  options: RunOptions = {}
): SygnalRunResult {
  // Initialize DevTools instrumentation bridge early (before component creation)
  if (typeof window !== 'undefined') {
    const dt = getDevTools();
    dt.init();
  }

  const {mountPoint = '#root', fragments = true, useDefaultDrivers = true} = options;
  if (!app.isSygnalComponent) {
    const name = app.name || app.componentName || app.label || 'FUNCTIONAL_COMPONENT';
    const view = app;
    const {
      model,
      intent,
      hmrActions,
      context,
      peers,
      components,
      initialState,
      calculated,
      storeCalculatedInState,
      DOMSourceName,
      stateSourceName,
      debug,
    } = app;
    const componentOptions = {
      name,
      view,
      model,
      intent,
      hmrActions,
      context,
      peers,
      components,
      initialState,
      calculated,
      storeCalculatedInState,
      DOMSourceName,
      stateSourceName,
      debug,
    };

    app = component(componentOptions);
  }

  if (
    typeof window !== 'undefined' &&
    window.__SYGNAL_HMR_UPDATING === true &&
    typeof window.__SYGNAL_HMR_PERSISTED_STATE !== 'undefined'
  ) {
    app.initialState = window.__SYGNAL_HMR_PERSISTED_STATE;
  }

  const wrapped = withState(app, 'STATE');

  const baseDrivers = useDefaultDrivers
    ? {
        EVENTS: eventBusDriver,
        DOM: makeDOMDriver(mountPoint, {snabbdomOptions: {experimental: {fragments}}} as any),
        LOG: logDriver,
      }
    : {};

  const combinedDrivers = {...baseDrivers, ...drivers};

  const {sources, sinks, run: _run} = setup(wrapped, combinedDrivers as any);
  const rawDispose = _run();
  let persistListener: any = null;

  if (
    typeof window !== 'undefined' &&
    (sources as any)?.STATE?.stream &&
    typeof (sources as any).STATE.stream.addListener === 'function'
  ) {
    persistListener = {
      next: (state: any) => {
        window.__SYGNAL_HMR_PERSISTED_STATE = state;
      },
      error: () => {},
      complete: () => {},
    };
    (sources as any).STATE.stream.addListener(persistListener);
  }

  const dispose = () => {
    if (
      persistListener &&
      (sources as any)?.STATE?.stream &&
      typeof (sources as any).STATE.stream.removeListener === 'function'
    ) {
      (sources as any).STATE.stream.removeListener(persistListener);
      persistListener = null;
    }
    rawDispose();
  };

  const exposed: SygnalRunResult = {sources, sinks, dispose};

  // Store app reference for time-travel
  if (typeof window !== 'undefined') {
    window.__SYGNAL_DEVTOOLS_APP__ = exposed;
  }

  const swapToComponent = (newComponent: any, state?: any) => {
    const persistedState =
      typeof window !== 'undefined' ? window.__SYGNAL_HMR_PERSISTED_STATE : undefined;
    const fallbackState = typeof persistedState !== 'undefined' ? persistedState : app.initialState;
    const resolvedState = typeof state === 'undefined' ? fallbackState : state;
    if (typeof window !== 'undefined') {
      window.__SYGNAL_HMR_UPDATING = true;
      window.__SYGNAL_HMR_STATE = resolvedState;
      window.__SYGNAL_HMR_PERSISTED_STATE = resolvedState;
    }
    exposed.dispose();
    const App = newComponent.default || newComponent;
    App.initialState = resolvedState;
    const updated = run(App, drivers, options);
    exposed.sources = updated.sources;
    exposed.sinks = updated.sinks;
    exposed.dispose = updated.dispose;

    if (
      typeof resolvedState !== 'undefined' &&
      updated?.sinks?.STATE &&
      typeof updated.sinks.STATE.shamefullySendNext === 'function'
    ) {
      const restore = () => updated.sinks.STATE.shamefullySendNext(() => ({...resolvedState}));
      setTimeout(restore, 0);
      setTimeout(restore, 20);
    }

    if (
      typeof window !== 'undefined' &&
      updated?.sources?.STATE?.stream &&
      typeof updated.sources.STATE.stream.setDebugListener === 'function'
    ) {
      updated.sources.STATE.stream.setDebugListener({
        next: () => {
          updated.sources.STATE.stream.setDebugListener(null);
          window.__SYGNAL_HMR_STATE = undefined;
          setTimeout(() => {
            window.__SYGNAL_HMR_UPDATING = false;
          }, 100);
        },
      });
    } else if (typeof window !== 'undefined') {
      window.__SYGNAL_HMR_STATE = undefined;
      window.__SYGNAL_HMR_UPDATING = false;
    }
  };

  const resolveHotModule = (incoming: any): any => {
    if (!incoming) return null;
    if (Array.isArray(incoming)) return resolveHotModule(incoming.find(Boolean));
    if (incoming.default && typeof incoming.default === 'function') return incoming;
    if (typeof incoming === 'function') return {default: incoming};
    return null;
  };

  const hmr = (newComponent: any, explicitState?: any) => {
    const normalizedModule = resolveHotModule(newComponent);
    const moduleToUse = normalizedModule || {default: app};

    if (typeof explicitState !== 'undefined') {
      if (typeof window !== 'undefined')
        window.__SYGNAL_HMR_LAST_CAPTURED_STATE = explicitState;
      swapToComponent(moduleToUse, explicitState);
      return;
    }

    const persistedState =
      typeof window !== 'undefined' ? window.__SYGNAL_HMR_PERSISTED_STATE : undefined;
    if (typeof persistedState !== 'undefined') {
      if (typeof window !== 'undefined')
        window.__SYGNAL_HMR_LAST_CAPTURED_STATE = persistedState;
      swapToComponent(moduleToUse, persistedState);
      return;
    }

    const sourceState = exposed?.sources?.STATE?.stream?._v;
    if (typeof sourceState !== 'undefined') {
      if (typeof window !== 'undefined')
        window.__SYGNAL_HMR_LAST_CAPTURED_STATE = sourceState;
      swapToComponent(moduleToUse, sourceState);
      return;
    }

    if (
      exposed?.sinks?.STATE &&
      typeof exposed.sinks.STATE.shamefullySendNext === 'function'
    ) {
      exposed.sinks.STATE.shamefullySendNext((state: any) => {
        if (typeof window !== 'undefined')
          window.__SYGNAL_HMR_LAST_CAPTURED_STATE = state;
        swapToComponent(moduleToUse, state);
        return ABORT;
      });
      return;
    }

    swapToComponent(moduleToUse);
  };

  exposed.hmr = hmr;

  return exposed;
}
