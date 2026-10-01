import {setup} from '../cycle/run/index';
import {withState} from '../cycle/state/index';
import {makeDOMDriver} from '../cycle/dom/index';
import eventBusDriver from './eventDriver';
import logDriver from './logDriver';
import component, {ABORT, optionsOf} from '../component';
import {getDevTools} from './devtools';
import {configureDiagnostics, isDiagnosticsEnabled} from './diagnostics/index';
import {warn} from './diagnostics/legacy';
import type {DiagnosticsMode, DiagnosticsOptions} from './diagnostics/index';

interface RunDiagnosticsOptions extends DiagnosticsOptions {
  /** Strict (canonical-form) runtime checks; needs the 'sygnal/diagnostics' dev entry (G-036). */
  strict?: boolean;
}

interface RunOptions {
  mountPoint?: string;
  fragments?: boolean;
  useDefaultDrivers?: boolean;
  /** Diagnostics mode (or mode + ignore list + strict). Overrides globalThis.__SYGNAL_DEV__. */
  diagnostics?: DiagnosticsMode | RunDiagnosticsOptions;
}

let warnedStrict = false;

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

  // Resolve diagnostics mode: explicit option > globalThis.__SYGNAL_DEV__ > 'off'.
  // Each run() is authoritative: without the option, mode and ignore list
  // reset to defaults (no leakage from an earlier run()/configureDiagnostics()).
  const {diagnostics} = options;
  const diagOptions: RunDiagnosticsOptions = typeof diagnostics === 'string' ? {mode: diagnostics} : diagnostics || {};
  const {mode, strict} = diagOptions;
  configureDiagnostics({mode, ignore: diagOptions.ignore || []});
  // G-036: strict is applied only when given (an earlier configureStrict() is kept). It sets
  // the flag the dev entry's strict checks read; strict without a mode turns diagnostics on.
  if (strict !== undefined) {
    const core = (globalThis as any).__SYGNAL_DIAGNOSTICS__;
    if ((core.strict = strict)) {
      if (!mode && !isDiagnosticsEnabled()) configureDiagnostics({mode: 'warn'});
      // SYG608 (once): the long explanation is in the docs / sygnal-check explain
      if (!core.__uninstallChecks && !warnedStrict) {
        warnedStrict = true;
        warn('SYG608', 'run', "strict needs 'sygnal/diagnostics'");
      }
    }
  }

  const {mountPoint = '#root', fragments = true, useDefaultDrivers = true} = options;
  if (!app.isSygnalComponent) {
    app = component(optionsOf(app, app.name || app.componentName || app.label || 'FUNCTIONAL_COMPONENT'));
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
    // Trigger the component's dispose() which fires the DISPOSE action and dispose$ stream
    if (typeof (sinks as any).__dispose === 'function') {
      try { (sinks as any).__dispose(); } catch (_) {}
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
    const moduleToUse = resolveHotModule(newComponent) || {default: app};
    // Swap with a captured state (recorded for the HMR tooling)
    const swapWith = (state: any) => {
      if (typeof window !== 'undefined') window.__SYGNAL_HMR_LAST_CAPTURED_STATE = state;
      swapToComponent(moduleToUse, state);
    };

    // State to keep, in order: explicit, last persisted, the state stream's current value
    let state = explicitState;
    if (typeof state === 'undefined' && typeof window !== 'undefined') state = window.__SYGNAL_HMR_PERSISTED_STATE;
    if (typeof state === 'undefined') state = exposed?.sources?.STATE?.stream?._v;
    if (typeof state !== 'undefined') return swapWith(state);

    const stateSink = exposed?.sinks?.STATE;
    if (stateSink && typeof stateSink.shamefullySendNext === 'function') {
      stateSink.shamefullySendNext((current: any) => {
        swapWith(current);
        return ABORT;
      });
      return;
    }

    swapToComponent(moduleToUse);
  };

  exposed.hmr = hmr;

  return exposed;
}
