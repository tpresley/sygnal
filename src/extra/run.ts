import {configureDiagnostics, isDiagnosticsEnabled} from './diagnostics/index';
import {warn} from './diagnostics/legacy';
import type {DiagnosticsMode, DiagnosticsOptions} from './diagnostics/index';
import {start} from '../core/runtime';

interface RunDiagnosticsOptions extends DiagnosticsOptions {
  /** Strict (canonical-form) runtime checks; needs the 'sygnal/diagnostics' dev entry (G-036). */
  strict?: boolean;
}

interface RunOptions {
  mountPoint?: string;
  /** @deprecated No effect since 6.0 (3-Q): fragments always work (the DOM driver flattens them) */
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
  /** internal: the app's runtime API (devtools, HMR, sygnal/element, Vike) */
  __runtime?: any;
}

function resolveHotModule(incoming: any): any {
  if (!incoming) return null;
  if (Array.isArray(incoming)) return resolveHotModule(incoming.find(Boolean));
  if (incoming.default && typeof incoming.default === 'function') return incoming;
  if (typeof incoming === 'function') return {default: incoming};
  return null;
}

export default function run(
  app: any,
  drivers: Record<string, any> = {},
  options: RunOptions = {},
  // G-216 (internal): a hot swap's { u: swapping, s: state to keep }, this app's `__hmr` source
  hmrSwap?: {u: boolean; s: any}
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

  const {uid} = options;
  // (R4) an HMR swap: the kept state is the new root's first state, and the instances made at
  // its start get no BOOTSTRAP (as the 5.x core's `__hmr` source); no 0/20 ms re-sends
  const started = start(app, drivers, {...options, __hooks: (options as any).__hooks, __state: hmrSwap?.s, __swap: !!hmrSwap} as any);
  liveApps++;
  let off = false;
  const exposed: SygnalRunResult = {
    sources: started.sources,
    sinks: started.sinks,
    dispose: () => {
      if (off) return;
      off = true;
      liveApps--;
      // G-212: unregister from DevTools (a later app, or this app's hot-swapped successor, registers)
      if (typeof window !== 'undefined' && window.__SYGNAL_DEVTOOLS_APP__ === exposed) window.__SYGNAL_DEVTOOLS_APP__ = undefined;
      started.dispose();
      if (strict !== undefined) core.strict = prevStrict;
    },
  };
  (exposed as any).__runtime = started.api;
  // G-214: the uid option, as the 5.x core's __uid source
  if (uid !== undefined) Object.defineProperty(exposed.sources, '__uid', {value: uid.replace(/[^\w-]+/g, '_'), enumerable: false, configurable: true});
  if (typeof window !== 'undefined') window.__SYGNAL_DEVTOOLS_APP__ ||= exposed;
  // (R4, 04 §3.12) hmr(): this app's current state through the runtime API (runtime.getState(),
  // no STATE.stream._v), then the new component started with it
  let current = app;
  exposed.hmr = (newComponent: any, explicitState?: any) => {
    const mod = resolveHotModule(newComponent) || {default: current};
    const state = explicitState !== undefined ? explicitState : (exposed as any).__runtime.getState();
    if (typeof window !== 'undefined') window.__SYGNAL_HMR_LAST_CAPTURED_STATE = state;
    const wasRegistered = typeof window !== 'undefined' && window.__SYGNAL_DEVTOOLS_APP__ === exposed;
    exposed.dispose();
    current = mod.default;
    const updated: any = run(current, drivers, options, state === undefined ? undefined : {u: true, s: state});
    exposed.sources = updated.sources;
    exposed.sinks = updated.sinks;
    (exposed as any).__runtime = updated.__runtime;
    // the registration follows the swap (the successor is this same object)
    if (typeof window !== 'undefined' && (window.__SYGNAL_DEVTOOLS_APP__ === updated || wasRegistered)) window.__SYGNAL_DEVTOOLS_APP__ = exposed;
    const d = updated.dispose;
    exposed.dispose = () => { if (typeof window !== 'undefined' && window.__SYGNAL_DEVTOOLS_APP__ === exposed) window.__SYGNAL_DEVTOOLS_APP__ = undefined; d(); };
  };
  return exposed;
}
