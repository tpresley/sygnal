import {setup} from '../cycle/run/index';
import {withState} from '../cycle/state/index';
import {makeDOMDriver} from '../cycle/dom/index';
import eventBusDriver from './eventDriver';
import logDriver from './logDriver';
import component, {ABORT, optionsOf} from '../component';
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
  /** PLAN-4 GS-11: app-level error hook, reporting only (after the component's onError boundary) */
  onError?: (error: any, info: {componentName?: string; action?: string; phase: string; driver?: string}) => void;
  /** PLAN-4 G-206: the root of this app's uid() strings (default 'u'); give each app on a page its own */
  uid?: string;
}

let warnedStrict = false;
// G-212: apps running now (an HMR swap disposes, then starts the new one)
let liveApps = 0;

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
  // D77: the DevTools bridge is not installed here; 'sygnal/devtools' (injected by
  // sygnal/vite in dev) installs window.__SYGNAL_DEVTOOLS__ before run() is called.

  // Resolve diagnostics mode: explicit option > globalThis.__SYGNAL_DEV__ > 'off'.
  // Each run() with the option is authoritative. Without it, mode and ignore list reset to
  // the defaults (no leakage from an earlier run()/configureDiagnostics()), unless another
  // app is still running (G-212: a second app or a custom element keeps the host's mode).
  const {diagnostics} = options;
  const diagOptions: RunDiagnosticsOptions = typeof diagnostics === 'string' ? {mode: diagnostics} : diagnostics || {};
  const {mode, strict} = diagOptions;
  if (diagnostics || !liveApps) configureDiagnostics({mode, ignore: diagOptions.ignore || []});
  // G-036: strict is applied only when given (an earlier configureStrict() is kept). It sets
  // the flag the dev entry's strict checks read; strict without a mode turns diagnostics on.
  // G-093: dispose() restores the previous value (an HMR swap disposes, then re-applies it).
  const core = (globalThis as any).__SYGNAL_DIAGNOSTICS__;
  const prevStrict = core.strict;
  if (strict !== undefined) {
    if ((core.strict = strict)) {
      if (!mode && !isDiagnosticsEnabled()) configureDiagnostics({mode: 'warn'});
      // SYG608 (once): the long explanation is in the docs / sygnal-check explain
      if (!core.__uninstallChecks && !warnedStrict) {
        warnedStrict = true;
        warn('SYG608', 'run', "strict needs 'sygnal/diagnostics'");
      }
    }
  }

  const {mountPoint = '#root', fragments = true, useDefaultDrivers = true, onError, uid} = options;
  if (!app.isSygnalComponent) {
    app = component(optionsOf(app, app.name || app.componentName || app.label || 'FUNCTIONAL_COMPONENT'));
  }

  // G-212: no page-wide persisted state. A hot swap sets the new component's initialState
  // itself (swapToComponent), and hmr() reads this app's own STATE stream.

  const wrapped = withState(app, 'STATE');

  const baseDrivers = useDefaultDrivers
    ? {
        EVENTS: eventBusDriver,
        DOM: makeDOMDriver(mountPoint, {snabbdomOptions: {experimental: {fragments}}} as any),
        LOG: logDriver,
      }
    : {};

  // GS-11: the hook is a source (`__e`) every component inherits, so it is per app. G-206: the
  // uid root is the root component's `__uid` source (the Component constructor reads it)
  const combinedDrivers = {...baseDrivers, ...drivers, ...(onError && {__e: () => onError}), ...(uid && {__uid: () => uid})};

  const {sources, sinks, run: _run} = setup(wrapped, combinedDrivers as any);
  const rawDispose = _run();
  liveApps++;
  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    liveApps--;
    // G-212: unregister from DevTools (a later app, or this app's hot-swapped successor, registers)
    if (typeof window !== 'undefined' && window.__SYGNAL_DEVTOOLS_APP__ === exposed) window.__SYGNAL_DEVTOOLS_APP__ = undefined;
    // Trigger the component's dispose() which fires the DISPOSE action and dispose$ stream
    if (typeof (sinks as any).__dispose === 'function') {
      try { (sinks as any).__dispose(); } catch (_) {}
    }
    rawDispose();
    if (strict !== undefined) core.strict = prevStrict;
  };

  const exposed: SygnalRunResult = {sources, sinks, dispose};

  // Store app reference for DevTools time-travel (root STATE fallback). G-212: the first
  // live app on the page keeps it (a second app or a custom element doesn't take it over)
  if (typeof window !== 'undefined') {
    window.__SYGNAL_DEVTOOLS_APP__ ||= exposed;
  }

  const swapToComponent = (newComponent: any, state?: any) => {
    const resolvedState = typeof state === 'undefined' ? app.initialState : state;
    if (typeof window !== 'undefined') {
      window.__SYGNAL_HMR_UPDATING = true;
      window.__SYGNAL_HMR_STATE = resolvedState;
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

    // State to keep, in order: explicit, this app's current state (G-212: never a page-wide value)
    let state = explicitState;
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
