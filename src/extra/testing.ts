import {setup} from '../cycle/run/index';
import {withState} from '../cycle/state/index';
import {mockDOMSource} from '../cycle/dom/mockDOMSource';
import eventBusDriver from './eventDriver';
import logDriver from './logDriver';
import component from '../component';
import {renderToString} from './ssr';
import {_getDiagnosticsConfig, configureDiagnostics, getDiagnosticsMode, isDiagnosticsEnabled, onDiagnostic, registerCheck, report} from './diagnostics/index';
import xs from './xstreamCompat';
import type {Stream} from 'xstream';
import type {Diagnostic, DiagnosticsMode} from './diagnostics/index';
import type {InspectGraph} from './diagnostics/checks/public';

/*
 * (Docs live on these type-only declarations so the TypeScript emit drops
 * them — keeps them out of the published bundle.)
 *
 * renderComponent(Component, options?) runs a component on a minimal runtime
 * (mock DOM, EVENTS, LOG, STATE + any `drivers`).
 *
 * - simulateEvent(selector, type, init?) sends a synthetic DOM event through
 *   the mock DOM source, so the component's real intent streams fire
 *   (DOM.click('.x'), DOM.select('.x').events('click'), .value(), .data(), ...).
 *   The target is the first rendered element matching `selector`; it is
 *   delivered to every listener whose selector matches that element or one of
 *   its ancestors in the same isolation scope (bubbling), and to
 *   DOM.select('document'|'body') listeners. `simulateEvent('document'|'body', ...)`
 *   goes to the listeners with exactly that selector. If no rendered element
 *   matches yet, the event waits (up to 300ms, re-tried on every render) for
 *   one, then targets the first match; if none appears it is dropped with
 *   SYG103 (it is never sent to every listener with that selector string, G-049).
 *   It also waits until the listeners it would reach are subscribed (a
 *   just-mounted child subscribes a few ms after it renders, G-039).
 *   `target.value/checked/dataset` default from the element's
 *   vnode (as strings, like the DOM) and are overridden by `init`.
 * - simulateAction(name, data?) pushes `{type: name, data}` into the real
 *   intent → model pipeline, so every sink of the model entry runs and hooks /
 *   diagnostics see the real action name. (Model actions that have no intent
 *   stream get one added under their real name; the injected names are listed
 *   on the intent object's non-enumerable `__sygnalTestActions` property.)
 * - simulateAction/simulateEvent calls are delivered in call order. Calls made
 *   before the component is subscribed are buffered and replayed once it is
 *   ready; `await t.ready()` is an explicit sync point. An event that waits
 *   (see above) holds the calls after it.
 * - Waiting: waitForState(pred) matches the recorded history too; next(pred)
 *   matches only states emitted after the call; both resolve once the whole
 *   tree has rendered the state. settle() resolves once nothing is pending.
 * - Diagnostics: `diagnostics` (default 'collect', or the already-active
 *   mode when diagnostics are on) is applied with configureDiagnostics. The
 *   explicit config from before the first live instance is restored when the
 *   last live instance is disposed (overlapping/nested instances are fine). Most runtime checks live
 *   in a separate entry: `import 'sygnal/diagnostics'` in the test (or vitest
 *   setupFiles) to enable them. Two DOM checks are built in (G-024), since the
 *   real-DOM versions can't run on the mock DOM:
 *   - SYG104 (warn): an intent selector matches nothing in its component's own
 *     scope but matches elements inside a child component / Collection item
 *     (parents can't see those events). Checked after every render and when
 *     simulateEvent targets such an element; reported once per component +
 *     selector.
 *   - SYG103 (info): simulateEvent's selector matches no rendered element and
 *     no intent listens on it (typo?).
 *
 * ```js
 * const t = renderComponent(Counter, { initialState: { count: 0 } })
 * t.simulateEvent('.inc', 'click')
 * await t.waitForState(s => s.count === 1)
 * t.dispose()
 * ```
 *
 * Implementation notes:
 * - is(v, compound) matches a vnode against tag/#id/.class/[attr]/[attr=v];
 *   desc() is the descendant combinator (last compound on the element, earlier
 *   ones on ancestors in order); find() returns the root → element chain of
 *   the first match.
 * - port(): producer-backed stream; emitting with no listener is a silent drop.
 * - Sinks named in the model without a driver get a no-op driver so their
 *   output stays observable. sinkValues: EVENTS entries drop the devtools
 *   stamps, PARENT entries are unwrapped from {name, component, value}.
 * - Input is buffered until 12ms after the first render: root and child
 *   action streams subscribe 1-10ms (BOOTSTRAP) after construction. With no
 *   render within 30ms (e.g. a model but no initialState), the 12ms start then.
 *   dispose() before ready leaves the buffered calls undelivered.
 * - "Rendered by the whole tree" = the root rendered the state and no render,
 *   reducer, state or input happened anywhere for 10ms (checked twice; capped at
 *   250ms). Child renders are seen through the onRender diagnostics hook.
 * - dispose() fires the component's DISPOSE action via sinks.__dispose.
 * - SYG103/104: the mock DOM source reports each events() call (selector path,
 *   isolation scopes included as '.___scope'); a diagnostics check's onIntent
 *   maps each component's innermost scope to its name. The nearest '.___'
 *   class on a vnode or its ancestors is the scope that owns it.
 */

export interface SimulatedEventInit {
  /** Merged into `event.target` (value, checked, dataset, ...) */
  target?: Record<string, any>;
  /** Shorthand for target.value */
  value?: any;
  /** Shorthand for target.checked */
  checked?: boolean;
  /** Merged into target.dataset (values become strings, like the DOM) */
  dataset?: Record<string, any>;
  /** Alias for dataset */
  data?: Record<string, any>;
  /** Keyboard key (e.key) */
  key?: string;
  /** Any other event properties are copied onto the event */
  [prop: string]: any;
}

export interface RenderOptions {
  /** Override or provide initial state (defaults to component's .initialState) */
  initialState?: any;
  /** Mock DOM configuration — maps selectors to event streams */
  mockConfig?: Record<string, any>;
  /** Additional drivers beyond DOM, EVENTS, STATE, and LOG */
  drivers?: Record<string, any>;
  /**
   * Diagnostics mode while the component is rendered. Default: 'collect', or
   * the current mode when diagnostics are already on (e.g. 'error' set in a
   * setup file). Restored on dispose(). SYG103/SYG104 (selector typos and
   * parent selectors that only match inside child components) are checked
   * built in; the other checks require `import 'sygnal/diagnostics'`.
   */
  diagnostics?: DiagnosticsMode;
  /**
   * Strict mode (canonical-form checks SYG501/502/504) while the component is
   * rendered; restored on dispose(). Requires `import 'sygnal/diagnostics'`.
   * Default: unchanged (off unless configureStrict(true) was called).
   */
  strict?: boolean;
}

export interface RenderResult {
  /** Stream of state values */
  state$: Stream<any>;
  /** Stream of rendered VNode trees */
  dom$: Stream<any>;
  /** Event bus source — call .select(type) to filter */
  events$: any;
  /** All sink streams by driver name */
  sinks: Record<string, any>;
  /** All source objects by driver name */
  sources: Record<string, any>;
  /** Push an action into the intent→model pipeline (all sinks of the entry run) */
  simulateAction: (actionName: string, data?: any) => void;
  /** Dispatch a synthetic DOM event through the mock DOM source */
  simulateEvent: (selector: string, eventType: string, eventInit?: SimulatedEventInit) => void;
  /** Resolves once the component is subscribed and rendered (earlier calls are buffered) */
  ready: () => Promise<void>;
  /**
   * Wait for a state that satisfies the predicate, searching the HISTORY first: a state
   * recorded before the call matches too (e.g. `count === 0` right after a reset resolves
   * at once with the initial state). Resolves with the matching state once the whole tree
   * (children included) has rendered it. Use next() to match only new states.
   */
  waitForState: (predicate: (state: any) => boolean, timeoutMs?: number) => Promise<any>;
  /**
   * Wait for the next state emitted AFTER this call that satisfies the predicate (default:
   * any). Resolves with it once the whole tree (children included) has rendered it.
   */
  next: (predicate?: (state: any) => boolean, timeoutMs?: number) => Promise<any>;
  /**
   * Resolves when the component is quiet: ready, no simulated input pending, and no render,
   * reducer or state change anywhere in the tree for a short window (20ms; covers next()'s
   * default delay). Rejects after timeoutMs (default 2000) if it never calms down.
   */
  settle: (timeoutMs?: number) => Promise<void>;
  /** Collected state values — grows as new states are emitted */
  states: any[];
  /** Live array of values emitted on a sink (EVENTS, PARENT, custom drivers, ...) */
  sinkValues: (sinkName: string) => any[];
  /** Live array of EVENTS sink emissions ({type, data}) */
  emitted: any[];
  /** Live array of diagnostics reported while rendered */
  diagnostics: Diagnostic[];
  /** Throws (with the formatted texts) if any warn/error diagnostics were collected */
  expectNoDiagnostics: () => void;
  /** Latest rendered VNode serialized to HTML ('' before the first render) */
  html: () => string;
  /** Tear down the component, clean up listeners and restore the diagnostics mode */
  dispose: () => void;
  /**
   * The app graph (2B) of the rendered tree: components, actions, selectors (with the mock DOM's
   * match / isolation results), EVENTS and diagnostics. Requires `import 'sygnal/diagnostics'`.
   */
  inspect: () => InspectGraph;
}

const isScope = (s: string) => s.startsWith('.___');
const words = (s: string) => s.split(/[\s>]+/).filter(Boolean);
const str = (o: any) => {
  const r: any = {};
  for (const k in o) if (o[k] != null) r[k] = String(o[k]);
  return r;
};
function is(v: any, sel: string): boolean {
  const d = v.data || {}, p = d.props || {}, a = d.attrs || {};
  const [tagId, ...cls] = v.sel.split('.');
  const [tag, sid] = tagId.split('#');
  const id = sid || p.id || a.id;
  const classes = cls.concat(
    `${p.className || ''} ${a.class || ''}`.split(' '),
    Object.keys(d.class || {}).filter(k => d.class[k])
  );
  return (sel.match(/\[[^\]]+\]|[.#]?[\w-]+|\*/g) || []).every((tok: string) => {
    const c = tok[0], n = tok.slice(1);
    if (c == '.') return classes.includes(n);
    if (c == '#') return id == n;
    if (c == '[') {
      const [, name, val] = tok.match(/^\[([\w-]+)(?:=["']?(.*?)["']?)?\]$/) || [];
      const x = name == 'id' ? id
        : name in a ? a[name]
        : name in p ? p[name]
        : name.startsWith('data-') ? str(d.dataset)[name.slice(5).replace(/-(\w)/g, (_: any, l: string) => l.toUpperCase())]
        : undefined;
      return val === undefined ? x != null : String(x) == val;
    }
    return c == '*' || tag == tok;
  });
}
function desc(cs: string[], els: any[]): boolean {
  let i = els.length - 1;
  if (i < 0 || !is(els[i], cs[cs.length - 1])) return false;
  for (let j = cs.length - 2; j >= 0; j--) {
    do if (--i < 0) return false; while (!is(els[i], cs[j]));
  }
  return true;
}
function find(v: any, cs: string[], chain: any[] = []): any[] | undefined {
  if (!v || typeof v != 'object') return;
  const c = v.sel ? chain.concat(v) : chain;
  if (v.sel && desc(cs, c)) return c;
  // a <Portal>'s content is rendered elsewhere; it is kept on its placeholder
  for (const k of [].concat(v.children || [], v.data?.portalChildren || [])) {
    const r = find(k, cs, c);
    if (r) return r;
  }
}

/** Internal (perf-guard tests): number of SYG104 tree walks */
export const _testingStats = {walks: 0};

// 1H-5: live renderComponent instances; the explicit diagnostics config and the strict flag
// (R4) from before the outermost one are restored when the last one is disposed
let active = 0;
/** simulateEvent: how long an event waits for its element / listeners (G-049, G-039) */
const WAIT_MS = 300;
/** quiet window after which the whole tree counts as rendered (G-047) */
const QUIET_MS = 10;
/** quiet window for settle(): longer than next()'s default 10ms delay */
const SETTLE_MS = 20;
let savedConfig: ReturnType<typeof _getDiagnosticsConfig>;
let savedStrict: any;

export function renderComponent(
  componentDef: any,
  options: RenderOptions = {}
): RenderResult {
  const {initialState, mockConfig = {}, drivers = {}, diagnostics, strict} = options;
  const {intent, model = {}} = componentDef;

  const prevMode = getDiagnosticsMode();
  // 2A: strict flag on the core bridge (read by the 'sygnal/diagnostics' strict checks)
  const core = (globalThis as any).__SYGNAL_DIAGNOSTICS__;
  if (!active++) {
    savedConfig = _getDiagnosticsConfig();
    savedStrict = core.strict;
    // G-051: forget the checks' report dedupe (once()), so a finding from an earlier test is
    // reported again. Only that set: resetChecks() would also drop inspect()'s records of
    // other live instances / apps.
    core.resetOnce?.();
  }
  configureDiagnostics({mode: diagnostics || (prevMode == 'off' ? 'collect' : prevMode)});
  if (strict !== undefined) core.strict = strict;
  const collected: Diagnostic[] = [];
  const offDiag = onDiagnostic(d => collected.push(d));

  // G-024: SYG103/SYG104 on the mock DOM
  const rootName = componentDef.name || componentDef.componentName || 'TestComponent';
  const listeners = new Map<string, string[]>();
  // G-039: subscribed listener count per path + event type
  const live = new Map<string, number>();
  let disposed = false;
  const owners = new Map<string, string>([['', rootName]]);
  const scopeIds = new Map<string, number>();
  const evTypes: Record<string, string[]> = {};
  const done = new Set<string>();
  // the innermost isolation scope of a component's DOM source on this hub
  const scopeOf = (c: any) => {
    const d = c && c.sources && c.sources[c.DOMSourceName || 'DOM'];
    return d && d._hub === hub.$ && (d._path || []).filter(isScope).pop();
  };
  // G-047: activity anywhere in the tree (any component's render/reducer, state, input), for
  // the "the full tree has rendered" / settle() quiet windows
  let activity = 0, lastActivity = Date.now();
  const bump = () => { activity++; lastActivity = Date.now(); };
  const offCheck = registerCheck({
    id: 'renderComponent',
    onRender: bump,
    onReducer: bump,
    onIntent(c: any) {
      bump();
      const sc = scopeOf(c);
      if (sc) owners.set(sc, c.name);
      if (c.sources[c.DOMSourceName || 'DOM']?._hub == hub.$) scopeIds.set(sc || '', c._componentNumber);
    },
    // 1H-11: forget a disposed child's listeners, so they aren't checked on every render
    onDispose(c: any) {
      const sc = scopeOf(c);
      if (!sc) return;
      owners.delete(sc);
      scopeIds.delete(sc);
      listeners.forEach((path, k) => { if (path.filter(isScope).pop() == sc) listeners.delete(k); });
    },
  });
  const raise = (code: string, component: string, message: string, fix: string, data: any) => {
    try { report(code, {component, message, fix, data}); } catch (e) { setTimeout(() => { throw e; }); }
  };
  // 1H-11: a render with the same tree and no new listener can't change the result
  let checkedTree: any, newListener = false;
  const probe = (sels: string[], scope?: string, target?: any) => {
    let own = false, child: string | undefined, hit = !target;
    // chain: [vnode, nearest scope][] from the root; inside: under this component's root
    const walk = (v: any, chain: any[], cur: any, inside: boolean, boundary: any): void => {
      if (!v || !v.sel || own) return;
      const sc = (v.sel.match(/\.___[^.#]+/) || [])[0] || cur;
      const c = chain.concat([[v, sc]]);
      inside = inside || sc == scope;
      if (inside) {
        if (sc == scope) {
          if (desc(sels, c.filter(x => x[1] == scope).map(x => x[0]))) own = true;
        } else {
          boundary = boundary || sc;
          if (desc(sels, c.map(x => x[0]))) {
            child = child || boundary;
            if (v === target) hit = true;
          }
        }
      }
      for (const k of [].concat(v.children || [])) walk(k, c, sc, inside, sc == scope ? undefined : boundary);
    };
    _testingStats.walks++;
    walk(vtree, [], undefined, !scope, undefined);
    return {own, child, hit};
  };
  const check104 = (target?: any) => {
    if (!vtree || !isDiagnosticsEnabled() || (!target && vtree === checkedTree && !newListener)) return;
    if (!target) checkedTree = vtree, newListener = false;
    listeners.forEach(path => {
      const sels = words(path.filter(s => !isScope(s)).join(' '));
      const scope = path.filter(isScope).pop();
      const name = owners.get(scope || '') || 'Component';
      const selector = sels.join(' ');
      const key = name + '\u0000' + selector;
      if (!sels.length || /^(document|body)$/.test(sels[0]) || done.has(key)) return;
      const {own, child, hit} = probe(sels, scope, target);
      if (own) return done.add(key);
      if (!child || !hit) return;
      done.add(key);
      const childName = owners.get(child) || 'a child component';
      raise('SYG104', name,
        `DOM.select('${selector}') in ${name} matches elements inside ${childName} (isolated), so ${name} never receives their events`,
        `Handle the event in ${childName} and send it up with PARENT (read it here with CHILD.select(${childName})), or use EVENTS`,
        {selector, child: childName});
    });
  };

  const restore = () => {
    offCheck();
    offDiag();
    if (!--active) {
      configureDiagnostics(savedConfig);
      core.strict = savedStrict;
    }
  };

  const noop = () => {};
  const port = () => {
    const p = {emit: noop as (v: any) => void, $: null as any};
    p.$ = xs.create({
      start: (l: any) => { p.emit = v => l.next(v); },
      stop: () => { p.emit = noop; },
    });
    return p;
  };
  const actions = port();
  const hub = port();

  const names = Object.keys(model)
    .map(k => k.split('|')[0].trim())
    .filter(n => n != 'INITIALIZE');
  const actionStream = (type: string) =>
    actions.$.filter((a: any) => a.type == type).map((a: any) => a.data);

  const wrappedIntent = (sources: any) => {
    const res = intent ? intent(sources) : {};
    if (res && typeof res.addListener == 'function') return xs.merge(res, actions.$);
    const out: any = {...res};
    const added = names.filter(n => !(n in out));
    for (const n of new Set([...Object.keys(out), ...added])) {
      out[n] = out[n] ? xs.merge(out[n], actionStream(n)) : actionStream(n);
    }
    Object.defineProperty(out, '__sygnalTestActions', {value: added});
    return out;
  };

  const {context, calculated, storeCalculatedInState, onError, hmrActions, components} = componentDef;
  const init = initialState !== undefined ? initialState : componentDef.initialState;
  // G-028: with no intent, model or initialState nothing would ever emit state, so the view
  // never renders. Leave intent/model unset so the component falls back to the same no-op
  // model run() uses, and renders.
  const bare = !intent && !Object.keys(model).length && init === undefined;
  const app = component({
    name: componentDef.name || componentDef.componentName || 'TestComponent',
    view: componentDef,
    intent: bare ? undefined : wrappedIntent,
    model: bare ? undefined : model,
    hmrActions,
    components,
    context,
    calculated,
    storeCalculatedInState,
    onError,
    initialState: init,
  });
  const allDrivers: any = {
    DOM: () => mockDOMSource(mockConfig, hub.$, (path, type, on) => {
      const k = path.join('\u0000');
      if (on === undefined) {
        if (!listeners.has(k)) listeners.set(k, path), newListener = true;
        (evTypes[k] = evTypes[k] || []).push(type);
      } else {
        // G-039: subscribed / unsubscribed listeners (a just-mounted child subscribes late)
        const lk = k + '\u0000' + type;
        live.set(lk, (live.get(lk) || 0) + (on ? 1 : -1));
        if (on) retry(0);
      }
    }),
    EVENTS: eventBusDriver,
    LOG: logDriver,
    ...drivers,
  };
  for (const k in model) {
    const e = model[k], [, sink] = k.split('|');
    for (const n of sink ? [sink.trim()] : e && typeof e == 'object' ? Object.keys(e) : []) {
      if (!allDrivers[n] && !/^(STATE|EFFECT|PARENT|READY)$/.test(n)) {
        allDrivers[n] = () => ({select: () => xs.never()});
      }
    }
  }
  let sources: any, sinks: any, rawDispose: () => void;
  try {
    const p: any = setup(withState(app, 'STATE') as any, allDrivers);
    ({sources, sinks} = p);
    rawDispose = p.run();
  } catch (e) {
    restore();
    throw e;
  }

  const subs: Array<[any, any]> = [];
  const listen = (s: any, next: (v: any) => void) => {
    const l = {next, error: noop, complete: noop};
    s.addListener(l);
    subs.push([s, l]);
  };

  const states: any[] = [];
  const stateStream: Stream<any> = sources.STATE?.stream || xs.never();
  listen(stateStream, s => { states.push(s); bump(); });

  const values: Record<string, any[]> = {};
  const sinkValues = (k: string) => (values[k] = values[k] || []);
  for (const k in sinks) {
    if (k != 'DOM' && k != 'STATE' && typeof sinks[k]?.addListener == 'function') {
      listen(sinks[k], v => sinkValues(k).push(
        k == 'EVENTS' ? {type: v.type, data: v.data} : k == 'PARENT' ? v.value : v
      ));
    }
  }
  // Input queue (G-049/G-039): simulateAction/simulateEvent calls are delivered in order,
  // once the component is ready. An event whose selector matches no rendered element yet, or
  // whose matching listeners aren't subscribed yet, holds the queue until it can be delivered
  // (re-tried on every render), at most WAIT_MS; then it is delivered to the live listeners
  // (or, with no matching element, dropped with SYG103).
  type Input = {go: (last: boolean) => boolean, until?: number};
  const inputs: Input[] = [];
  let isReady = false, retryTimer: any;
  const pump = () => {
    if (!isReady || disposed) return;
    while (inputs.length) {
      const head = inputs[0];
      head.until = head.until || Date.now() + WAIT_MS;
      if (!head.go(Date.now() >= head.until)) return retry(5);
      inputs.shift();
      bump();
    }
  };
  const retry = (ms: number) => {
    if (!retryTimer && inputs.length) retryTimer = setTimeout(() => { retryTimer = 0; pump(); }, ms);
  };
  let markReady: () => void;
  const readyPromise = new Promise<void>(r => {
    markReady = () => {
      isReady = true;
      pump();
      r();
    };
  });
  const later = (go: Input['go']) => { inputs.push({go}); pump(); };

  let vtree: any;
  let timer: any;
  // states[0 .. renderedUpTo) were recorded before the latest render (1H-12)
  let renderedUpTo = 0;
  const arm = () => timer || (timer = setTimeout(() => markReady(), 12));
  if (sinks.DOM) {
    listen(sinks.DOM, v => {
      vtree = v;
      renderedUpTo = states.length;
      bump();
      check104();
      arm();
      pump();
    });
  }
  // 1H-4: a component that never renders on its own (a model but no initialState: no state
  // until an action sets it) still becomes ready, so buffered input is delivered
  const fallback = setTimeout(arm, sinks.DOM ? 30 : 0);

  const tick = (ms: number) => new Promise(r => setTimeout(r, ms));
  /**
   * G-047: resolves once the root has rendered states[0 .. n) and the whole tree has been
   * quiet (no render, reducer, state or input anywhere) for `quiet` ms, checked twice, so
   * child components have rendered them too. Gives up after `cap` ms (an app that never
   * goes quiet): false.
   */
  const quiesce = async (n: number, quiet: number, cap: number, busy = () => false): Promise<boolean> => {
    const start = Date.now();
    let seen = -1;
    while (!disposed) {
      const idle = Date.now() - lastActivity;
      if (Date.now() - start > cap) return false;
      if ((!sinks.DOM || renderedUpTo >= n || Date.now() - start > 100) && idle >= quiet && !busy()) {
        if (seen === activity) return true;
        seen = activity;
        await tick(3);
      } else {
        seen = -1;
        await tick(Math.max(1, quiet - idle));
      }
    }
    return true;
  };
  const treeRendered = (n: number) => quiesce(n, QUIET_MS, 250);

  const simulateAction = (type: string, data?: any) =>
    later(() => (actions.emit({type, data}), true));

  const simulateEvent = (selector: string, type: string, init: SimulatedEventInit = {}) =>
    later(last => {
      const cs = words(selector);
      // 'document' / 'body' (and '') name a listener, not an element
      const page = !cs.length || /^(document|body)$/.test(cs[0]);
      const chain = page ? undefined : find(vtree, cs);
      const el = chain?.[chain.length - 1];
      if (!page && !el) {
        if (!last) return false;
        raise('SYG103', rootName,
          `simulateEvent('${selector}', '${type}') matched no rendered element within ${WAIT_MS}ms, so the event was dropped`,
          `Check the selector against the view's className/id, or wait until the element is rendered (await t.next(...) or t.settle())`,
          {selector, type});
        return true;
      }
      const match = (path: string[]) => {
        const sels = words(path.filter(s => !isScope(s)).join(' '));
        if (!chain) return sels.join(' ') == cs.join(' ');
        let els = chain;
        if (/^(document|body)$/.test(sels[0])) sels.shift();
        else {
          const scope = path.filter(isScope).pop();
          let cur: string | undefined;
          els = chain.filter(v => {
            const m = v.sel.match(/\.___[^.#]+/);
            if (m) cur = m[0];
            return cur == scope;
          });
        }
        return els.some((_, k) => !sels.length || desc(sels, els.slice(0, k + 1)));
      };
      // G-039: wait until every listener this event would reach is subscribed
      if (!last) {
        for (const [k, path] of listeners) {
          if ((evTypes[k] || []).includes(type) && !live.get(k + '\u0000' + type) && match(path)) return false;
        }
      }
      if (el) check104(el);
      const d = el?.data || {}, p = d.props || {};
      const {target: t = {}, value, checked, dataset, data, ...rest} = init;
      const vval = p.value ?? d.attrs?.value;
      const target: any = {
        tagName: el?.sel.split(/[.#]/)[0].toUpperCase(),
        value: vval == null ? vval : String(vval),
        checked: p.checked ?? d.attrs?.checked,
        ...('value' in init && {value}),
        ...('checked' in init && {checked}),
        ...t,
      };
      target.dataset = str({...d.dataset, ...dataset, ...data, ...t.dataset});
      // 3E/R2: element.closest(sel) over the rendered ancestor chain, so helpers that look
      // up ancestors (e.g. `.data('taskId')` on a click inside the row carrying the data)
      // behave like the real DOM. Ancestors are element-like: tagName, dataset, closest.
      if (chain && !('closest' in t)) {
        const like = (i: number): any => {
          const v = chain[i];
          return {tagName: v.sel.split(/[.#]/)[0].toUpperCase(), dataset: str(v.data?.dataset), closest: closestFrom(i)};
        };
        const closestFrom = (from: number) => (sel: string): any => {
          const alts = String(sel).split(',').map(words).filter(cs => cs.length);
          for (let i = from; i >= 0; i--) {
            if (alts.some(cs => desc(cs, chain.slice(0, i + 1)))) return i == chain.length - 1 ? target : like(i);
          }
          return null;
        };
        target.closest = closestFrom(chain.length - 1);
      }
      const event = {
        type,
        target,
        currentTarget: target,
        ownerTarget: target,
        dataTransfer: {},
        preventDefault: noop,
        stopPropagation: noop,
        ...rest,
      };
      hub.emit({type, event, match});
      return true;
    });

  // first state at index >= from matching predicate; resolves after the full tree rendered it
  const waitMatch = (from: number, predicate: (state: any) => boolean, timeoutMs: number, name: string): Promise<any> =>
    new Promise((resolve, reject) => {
      const found = (i: number) => {
        clearTimeout(timer);
        stateStream.removeListener(listener);
        treeRendered(i + 1).then(() => resolve(states[i]));
      };
      const test = (i: number) => { try { return predicate(states[i]); } catch (_) { return false; } };
      const fail = (err: Error) => { clearTimeout(timer); stateStream.removeListener(listener); reject(err); };
      const base = states.length;
      const listener = {
        // the recording listener (added first) has already pushed the new state; a
        // remembered state replayed on addListener isn't new (states.length == base)
        next: () => { if (states.length > base && test(states.length - 1)) found(states.length - 1); },
        error: (err: any) => fail(err),
        complete: () => fail(new Error(`${name}: state stream completed without matching`)),
      };
      const timer = setTimeout(() => fail(new Error(`${name} timed out after ${timeoutMs}ms`)), timeoutMs);
      for (let i = from; i < states.length; i++) if (test(i)) return found(i);
      stateStream.addListener(listener);
    });

  const waitForState = (predicate: (state: any) => boolean, timeoutMs: number = 2000) =>
    waitMatch(0, predicate, timeoutMs, 'waitForState');
  const next = (predicate: (state: any) => boolean = () => true, timeoutMs: number = 2000) =>
    waitMatch(states.length, predicate, timeoutMs, 'next');
  const settle = async (timeoutMs: number = 2000): Promise<void> => {
    await Promise.race([readyPromise, tick(timeoutMs)]);
    if (!await quiesce(states.length, SETTLE_MS, timeoutMs, () => !isReady || inputs.length > 0)) {
      throw new Error(`settle timed out after ${timeoutMs}ms: ${inputs.length ? `${inputs.length} simulated input(s) still pending` : 'the component kept rendering'}`);
    }
  };

  const expectNoDiagnostics = () => {
    const bad = collected.filter(d => d.severity != 'info');
    if (bad.length) {
      throw new Error(`Expected no diagnostics, got ${bad.length}:\n` + bad.map(d => d.text).join('\n'));
    }
  };

  // G-040: a Collection's container keeps its marker props (of, from, filter, item props...)
  // as snabbdom props, i.e. DOM properties, not attributes: drop them, like the real DOM
  const unmark = (v: any): any => {
    if (!v || typeof v != 'object' || !v.sel) return v;
    let d = v.data;
    if (d?.isCollection) {
      const {className, id} = d.props || {};
      d = {...d, props: {className, id}};
    }
    return {...v, data: d, children: v.children && v.children.map(unmark)};
  };
  const html = () =>
    vtree
      ? renderToString(() => unmark(vtree)).replace(/ class="([^"]*)"/g, (_, c: string) =>
          (c = c.split(' ').filter(x => !x.startsWith('___')).join(' ')) ? ` class="${c}"` : ''
        )
      : '';

  const inspect = (): InspectGraph => {
    if (!core.inspect) throw Error(`[Sygnal] t.inspect() needs import 'sygnal/diagnostics'`);
    return core.inspect({ids: [...scopeIds.values()], diagnostics: collected, mock: {listeners, evTypes, owners, scopeIds, probe, vtree}});
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    clearTimeout(fallback);
    clearTimeout(retryTimer);
    inputs.length = 0;
    subs.forEach(([s, l]) => {
      try { s.removeListener(l); } catch (_) {}
    });
    try { sinks.__dispose?.(); } catch (_) {}
    rawDispose();
    restore();
  };

  return {
    state$: stateStream,
    dom$: sinks.DOM || xs.never(),
    events$: sources.EVENTS || {select: () => xs.never()},
    sinks,
    sources,
    simulateAction,
    simulateEvent,
    ready: () => readyPromise,
    waitForState,
    next,
    settle,
    states,
    sinkValues,
    emitted: sinkValues('EVENTS'),
    diagnostics: collected,
    expectNoDiagnostics,
    html,
    dispose,
    inspect,
  };
}
