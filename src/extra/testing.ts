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
 *   DOM.select('document'|'body') listeners. If no rendered element matches,
 *   it goes to listeners whose selector string equals `selector` (e.g.
 *   'document', or an element that is not rendered yet). Unmatched events
 *   are dropped. `target.value/checked/dataset` default from the element's
 *   vnode (as strings, like the DOM) and are overridden by `init`.
 * - simulateAction(name, data?) pushes `{type: name, data}` into the real
 *   intent → model pipeline, so every sink of the model entry runs and hooks /
 *   diagnostics see the real action name. (Model actions that have no intent
 *   stream get one added under their real name; the injected names are listed
 *   on the intent object's non-enumerable `__sygnalTestActions` property.)
 * - Calls made before the component is subscribed are buffered and replayed
 *   in order once it is ready; `await t.ready()` is an explicit sync point.
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
 * - rendered(): the next render, or 20ms (state → view is async).
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
   * Wait for state to satisfy a predicate. Resolves with the matching state
   * once it has been rendered, so html() and simulateEvent() see the new view.
   */
  waitForState: (predicate: (state: any) => boolean, timeoutMs?: number) => Promise<any>;
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
  for (const k of [].concat(v.children || [])) {
    const r = find(k, cs, c);
    if (r) return r;
  }
}

// 1H-5: live renderComponent instances; the explicit diagnostics config from before the
// outermost one is restored when the last one is disposed
let active = 0;
let savedConfig: ReturnType<typeof _getDiagnosticsConfig>;

export function renderComponent(
  componentDef: any,
  options: RenderOptions = {}
): RenderResult {
  const {initialState, mockConfig = {}, drivers = {}, diagnostics} = options;
  const {intent, model = {}} = componentDef;

  const prevMode = getDiagnosticsMode();
  if (!active++) savedConfig = _getDiagnosticsConfig();
  configureDiagnostics({mode: diagnostics || (prevMode == 'off' ? 'collect' : prevMode)});
  const collected: Diagnostic[] = [];
  const offDiag = onDiagnostic(d => collected.push(d));

  // G-024: SYG103/SYG104 on the mock DOM
  const rootName = componentDef.name || componentDef.componentName || 'TestComponent';
  const listeners = new Map<string, string[]>();
  const owners = new Map<string, string>([['', rootName]]);
  const done = new Set<string>();
  const offCheck = registerCheck({
    id: 'renderComponent',
    onIntent(c: any) {
      const d = c && c.sources && c.sources[c.DOMSourceName || 'DOM'];
      const sc = d && d._hub === hub.$ && (d._path || []).filter(isScope).pop();
      if (sc) owners.set(sc, c.name);
    },
  });
  const raise = (code: string, component: string, message: string, fix: string, data: any) => {
    try { report(code, {component, message, fix, data}); } catch (e) { setTimeout(() => { throw e; }); }
  };
  const check104 = (target?: any) => {
    if (!vtree || !isDiagnosticsEnabled()) return;
    listeners.forEach(path => {
      const sels = words(path.filter(s => !isScope(s)).join(' '));
      const scope = path.filter(isScope).pop();
      const name = owners.get(scope || '') || 'Component';
      const selector = sels.join(' ');
      const key = name + '\u0000' + selector;
      if (!sels.length || /^(document|body)$/.test(sels[0]) || done.has(key)) return;
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
      walk(vtree, [], undefined, !scope, undefined);
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
    if (!--active) configureDiagnostics(savedConfig);
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
    DOM: () => mockDOMSource(mockConfig, hub.$, path => listeners.set(path.join('\u0000'), path)),
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
  listen(stateStream, s => states.push(s));

  const values: Record<string, any[]> = {};
  const sinkValues = (k: string) => (values[k] = values[k] || []);
  for (const k in sinks) {
    if (k != 'DOM' && k != 'STATE' && typeof sinks[k]?.addListener == 'function') {
      listen(sinks[k], v => sinkValues(k).push(
        k == 'EVENTS' ? {type: v.type, data: v.data} : k == 'PARENT' ? v.value : v
      ));
    }
  }
  let queue: Array<() => void> | null = [];
  let markReady: () => void;
  const readyPromise = new Promise<void>(r => {
    markReady = () => {
      const q = queue!;
      queue = null;
      q.forEach(f => f());
      r();
    };
  });
  const later = (f: () => void) => (queue ? queue.push(f) : f());

  let vtree: any;
  let timer: any;
  let onRender: Array<() => void> = [];
  const arm = () => timer || (timer = setTimeout(() => markReady(), 12));
  if (sinks.DOM) {
    listen(sinks.DOM, v => {
      vtree = v;
      check104();
      arm();
      onRender.forEach(f => f());
      onRender = [];
    });
  }
  // 1H-4: a component that never renders on its own (a model but no initialState: no state
  // until an action sets it) still becomes ready, so buffered input is delivered
  const fallback = setTimeout(arm, sinks.DOM ? 30 : 0);
  const rendered = () => new Promise<void>(r => { onRender.push(r); setTimeout(r, 20); });

  const simulateAction = (type: string, data?: any) =>
    later(() => actions.emit({type, data}));

  const simulateEvent = (selector: string, type: string, init: SimulatedEventInit = {}) =>
    later(() => {
      const cs = words(selector);
      const chain = cs.length ? find(vtree, cs) : undefined;
      const el = chain?.[chain.length - 1];
      if (el) check104(el);
      else if (isDiagnosticsEnabled() && ![...listeners.values()].some(p => words(p.filter(s => !isScope(s)).join(' ')).join(' ') == cs.join(' '))) {
        raise('SYG103', rootName,
          `simulateEvent('${selector}', '${type}') matched no rendered element, and no intent listens on '${selector}'`,
          `Check the selector against the view's className/id`,
          {selector, type});
      }
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
      hub.emit({type, event, match});
    });

  const waitForState = (
    predicate: (state: any) => boolean,
    timeoutMs: number = 2000
  ): Promise<any> => {
    return new Promise((resolve, reject) => {
      for (const s of states) {
        try {
          if (predicate(s)) return resolve(s);
        } catch (_) {}
      }
      const done = (f: () => void) => {
        clearTimeout(timer);
        stateStream.removeListener(listener);
        f();
      };
      const timer = setTimeout(
        () => done(() => reject(new Error(`waitForState timed out after ${timeoutMs}ms`))),
        timeoutMs
      );
      const listener = {
        next: (s: any) => {
          try {
            if (predicate(s)) done(() => rendered().then(() => resolve(s)));
          } catch (_) {}
        },
        error: (err: any) => done(() => reject(err)),
        complete: () => done(() => reject(new Error('waitForState: state stream completed without matching'))),
      };
      stateStream.addListener(listener);
    });
  };

  const expectNoDiagnostics = () => {
    const bad = collected.filter(d => d.severity != 'info');
    if (bad.length) {
      throw new Error(`Expected no diagnostics, got ${bad.length}:\n` + bad.map(d => d.text).join('\n'));
    }
  };

  const html = () =>
    vtree
      ? renderToString(() => vtree).replace(/ class="([^"]*)"/g, (_, c: string) =>
          (c = c.split(' ').filter(x => !x.startsWith('___')).join(' ')) ? ` class="${c}"` : ''
        )
      : '';

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    clearTimeout(fallback);
    queue = null;
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
    states,
    sinkValues,
    emitted: sinkValues('EVENTS'),
    diagnostics: collected,
    expectNoDiagnostics,
    html,
    dispose,
  };
}
