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
 *   goes to the listeners with exactly that selector. Selectors match the
 *   rendered vnode tree like the real DOM: tag, .class, #id, [attr], [attr=v]
 *   (^= $= *= ~=), :first-child, :last-child, :only-child, :nth-child(an+b),
 *   :nth-last-child, :*-of-type, :not(), ' ' and '>' combinators, ',' lists
 *   (G-070); other syntax (:has(), '+', '~', ...) throws at the call. If no
 *   rendered element matches yet, the event waits (up to 300ms, re-tried on
 *   every render) for one, then targets the first match. If none appears, the
 *   test fails (G-070): the error rejects the pending next()/waitForState()/
 *   settle(), or is thrown by the next t.* call or dispose(); when nothing is
 *   pending and the tree is quiet it is thrown by simulateEvent itself. With
 *   `{allowMissing: true}` it is dropped with SYG103 instead (it is never sent
 *   to every listener with that selector string, G-049).
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
 * - parse() turns a selector into compounds + combinators (cached; unsupported
 *   syntax throws); index() records each vnode's parent and element siblings
 *   on every render (for '>' and :nth-*); is(v, compound) matches one vnode;
 *   matches(sel, chain) matches the last vnode of an ancestor chain; find()
 *   returns the root → element chain of the first match.
 * - port(): producer-backed stream; emitting with no listener is a silent drop.
 * - Sinks named in the model without a driver get a no-op driver so their
 *   output stays observable. sinkValues: EVENTS entries drop the devtools
 *   stamps, PARENT entries are unwrapped from {name, component, value}.
 *   G-064: a descendant's model sink with no driver (not in its sourceNames) is
 *   recorded straight from its model$ (subscribed via the onModel hook, removed
 *   in onDispose); a passed driver puts the name in sourceNames, so it wins.
 * - G-065: ready() arms a cursor (states.length when the component became
 *   ready, or at the call once ready) that the next next() starts from; any
 *   other t.* call disarms it.
 * - G-053: timing options eventWaitMs / settleMs / timeoutMs. Model next() calls
 *   are seen by wrapping each tree component's `log` (component.ts logs every
 *   next() with "next() action: <TYPE> Nms delay"); wait timeouts name them.
 * - Input is buffered until 12ms after the first render: root and child
 *   action streams subscribe 1-10ms (BOOTSTRAP) after construction. With no
 *   render within 30ms (e.g. a model but no initialState), the 12ms start then.
 *   dispose() before ready leaves the buffered calls undelivered.
 * - "Rendered by the whole tree" = the root rendered the state and no render,
 *   reducer, state or input happened anywhere for 10ms (checked twice; capped at
 *   250ms). Child renders are seen through the onRender diagnostics hook.
 * - dispose() fires the component's DISPOSE action via sinks.__dispose.
 * - E11: fake timers (vi.useFakeTimers(), Jest's modern timers). The harness's own timers are
 *   faked with the app's, and its time is the clock's (clockNow). ready()/next()/
 *   waitForState()/settle() drive the clock (drive(): nextAsync until the wait settles), so
 *   they resolve without the test advancing it; their timeouts are clock time.
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
  /**
   * Don't fail when the selector matches no rendered element: wait up to 300ms for it, then
   * drop the event with SYG103 (info). Not copied onto the event.
   */
  allowMissing?: boolean;
  /** Any other event properties are copied onto the event */
  [prop: string]: any;
}

/** E2: which request a t.respond()/t.fail() answers (a string is the category) */
export interface FakeReplyOptions {
  /** Answer the most recent pending request of this category */
  category?: string;
  /**
   * Answer exactly this request (an element of t.requests(name)). `null`: push the value without
   * a request (for a source that emits on its own); `category` then sets its category.
   */
  request?: any;
  /** Response status (respond: default 200) or failure status (fail: default error.status) */
  status?: number;
  /** fail(): the parsed error body */
  body?: any;
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
  /**
   * settle()'s quiet window in ms (default 20): settle() resolves once nothing in the tree has
   * rendered, reduced or changed state for this long. A model `next('X', data, ms)` with a
   * longer delay fires after settle() resolved; raise this, or wait with t.next(pred).
   */
  settleMs?: number;
  /** How long simulateEvent waits for a matching element / its listeners, in ms (default 300) */
  eventWaitMs?: number;
  /** Default timeout of next(), waitForState() and settle(), in ms (default 2000) */
  timeoutMs?: number;
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
  /**
   * Resolves once the component is subscribed and rendered (earlier calls are buffered and
   * replayed). Also a cursor (G-065): the first next() after `await t.ready()` also matches the
   * states the replayed calls produced, unless another t.* call came in between.
   */
  ready: () => Promise<void>;
  /**
   * Wait for a state that satisfies the predicate, searching the HISTORY first: a state
   * recorded before the call matches too (e.g. `count === 0` right after a reset resolves
   * at once with the initial state). Resolves with the matching state once the whole tree
   * (children included) has rendered it. Use next() to match only new states.
   */
  waitForState: (predicate: (state: any) => boolean, timeoutMs?: number) => Promise<any>;
  /**
   * Wait for the next state emitted AFTER this call (or, right after `await t.ready()`, after
   * the component became ready) that satisfies the predicate (default: any). Resolves with it
   * once the whole tree (children included) has rendered it. The timeout error names a model
   * next() still scheduled, and a recorded state that already matched.
   */
  next: (predicate?: (state: any) => boolean, timeoutMs?: number) => Promise<any>;
  /**
   * Resolves when the component is quiet: ready, no simulated input pending, and no render,
   * reducer or state change anywhere in the tree for `settleMs` (default 20; covers a model
   * next()'s default 10ms delay). Rejects after timeoutMs (default 2000) if it never calms down.
   */
  settle: (timeoutMs?: number) => Promise<void>;
  /** Collected state values — grows as new states are emitted */
  states: any[];
  /**
   * Live array of values emitted on a sink (EVENTS, PARENT, custom drivers, ...). A custom sink
   * with no driver is recorded for every component in the tree (children included, G-064).
   */
  sinkValues: (sinkName: string) => any[];
  /**
   * E2: requests the component sent to a sink that has no driver (alias of sinkValues(name)).
   * Answer them with respond() / fail().
   */
  requests: (sinkName: string) => any[];
  /**
   * E2: answer a request on a fake source. A sink/source with no driver (e.g. `HTTP` with
   * no `drivers: { HTTP }`) gets a scriptable fake whose `select(category)` / `errors(category)`
   * behave like makeFetchDriver / driverFromAsync. respond() delivers
   * `{ category, value, status, request }` on `select()` for the most recent pending request
   * (of `category`, if given; or exactly `request`), waiting up to 1s (half of timeoutMs if
   * lower) for the component to send one (e.g. after a debounce). Requests superseded by a later `latest: true` request,
   * or cancelled with `{ category, abort: true }`, are not pending; answering one explicitly
   * delivers nothing, like the real driver. Fails the test if nothing selects the response.
   */
  respond: (sinkName: string, value: any, opts?: string | FakeReplyOptions) => void;
  /**
   * E2: fail a pending request on a fake source: delivers `{ error, category, request, status,
   * body }` on `errors()`. `error` may be an Error, a message, or an HTTP status number (404 →
   * an Error 'HTTP 404' with `status: 404`). Targeting, waiting and failures as in respond().
   */
  fail: (sinkName: string, error: any, opts?: string | FakeReplyOptions) => void;
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
/** a listener path's selector text (isolation scopes dropped, whitespace normalized) */
const selText = (path: string[]) => norm(path.filter(s => !isScope(s)).join(' '));
const norm = (s: string) => s.trim().replace(/\s*>\s*/g, ' > ').replace(/\s+/g, ' ');
/** 'document' / 'body' (optionally followed by more) name a page listener, not an element */
const PAGE = /^(document|body)(\s+|$)/;
const str = (o: any) => {
  const r: any = {};
  for (const k in o) if (o[k] != null) r[k] = String(o[k]);
  return r;
};

// ── Selector engine (G-070) ──────────────────────────────────────────────────
// Matches the rendered vnode tree with real-DOM semantics. Anything not listed in
// SUPPORTED throws "unsupported selector syntax" instead of silently matching nothing.
type Pseudo = {k: string; a: number; b: number; last?: boolean; type?: boolean; not?: Sel};
type Compound = {tag?: string; id?: string; cls: string[]; attrs: [string, string, string?][]; ps: Pseudo[]};
type Complex = {parts: Compound[]; combs: string[]};
type Sel = Complex[];
const SUPPORTED = "tag, *, .class, #id, [attr], [attr=\"v\"] (also ^= $= *= ~=), :first-child, :last-child, :only-child, :nth-child(an+b|odd|even), :nth-last-child(), :first-of-type, :last-of-type, :only-of-type, :nth-of-type(), :nth-last-of-type(), :not(...), the descendant (' ') and child ('>') combinators, ',' lists";
const IDENT = /^(?:[\w-]|\\.)+/;
const unesc = (x: string) => x.replace(/\\(.)/g, '$1');
const parsed = new Map<string, Sel | Error>();
function parse(src: string): Sel {
  let r = parsed.get(src);
  if (!r) {
    try { r = parseSel(src); } catch (e: any) { r = e; }
    parsed.set(src, r!);
  }
  if (r instanceof Error) throw r;
  return r!;
}
const tryParse = (src: string): Sel | undefined => { try { return parse(src); } catch (_) { return undefined; } };
function parseSel(src: string): Sel {
  let i = 0;
  const bad = (what: string): never => {
    const e: any = new Error(`[Sygnal] Unsupported selector syntax in '${src}': ${what}. Supported: ${SUPPORTED}. Or give the element an attribute and select it, e.g. [data-id="3"]`);
    e.unsupported = true;
    throw e;
  };
  const ws = () => { const n = src.slice(i).match(/^\s*/)![0].length; i += n; return n > 0; };
  const ident = (what: string) => {
    const m = src.slice(i).match(IDENT);
    if (!m) return bad(`expected ${what} at '${src.slice(i) || 'end'}'`);
    i += m[0].length;
    return unesc(m[0]);
  };
  const anb = (arg: string): [number, number] => {
    const x = arg.trim().toLowerCase().replace(/\s+/g, '');
    if (x == 'odd') return [2, 1];
    if (x == 'even') return [2, 0];
    if (/^[+-]?\d+$/.test(x)) return [0, +x];
    const m = x.match(/^([+-]?\d*)n([+-]\d+)?$/);
    if (!m) return bad(`'${arg}' is not an+b`);
    return [m[1] == '' || m[1] == '+' ? 1 : m[1] == '-' ? -1 : +m[1], m[2] ? +m[2] : 0];
  };
  const compound = (): Compound => {
    const c: Compound = {cls: [], attrs: [], ps: []};
    const from = i;
    if (src[i] == '*') i++;
    else if (IDENT.test(src.slice(i))) c.tag = ident('tag').toLowerCase();
    for (;;) {
      const ch = src[i];
      if (ch == '.') { i++; c.cls.push(ident('a class name')); }
      else if (ch == '#') { i++; c.id = ident('an id'); }
      else if (ch == '[') {
        const m = src.slice(i).match(/^\[\s*((?:[\w-]|\\.)+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|((?:[\w-]|\\.)+))\s*)?\]/);
        if (!m) return bad(`attribute selector '${src.slice(i)}'`);
        if (m[2] == '|=') bad("the '|=' attribute operator");
        i += m[0].length;
        c.attrs.push([unesc(m[1]), m[2] || '', m[2] ? (m[3] ?? m[4] ?? unesc(m[5])) : undefined]);
      } else if (ch == ':') {
        if (src[i + 1] == ':') bad('pseudo-elements');
        i++;
        const k = ident('a pseudo-class').toLowerCase();
        let arg: string | undefined;
        if (src[i] == '(') {
          let depth = 0, j = i;
          for (; j < src.length; j++) {
            if (src[j] == '(') depth++;
            else if (src[j] == ')' && !--depth) break;
          }
          if (j >= src.length) bad(`unclosed ':${k}('`);
          arg = src.slice(i + 1, j);
          i = j + 1;
        }
        const p: Pseudo = {k, a: 0, b: 1};
        const m = k.match(/^(?:(first|last|only)|nth(-last)?)-(child|of-type)$/);
        if (m && (arg === undefined) == !!m[1]) {
          p.type = m[3] == 'of-type';
          if (m[1] == 'only') p.k = 'only';
          else if (m[1]) p.last = m[1] == 'last';
          else {
            if (/\bof\b/.test(arg!)) bad(`':${k}(... of S)'`);
            [p.a, p.b] = anb(arg!);
            p.last = !!m[2];
          }
        } else if (k == 'not' && arg !== undefined) {
          p.not = parse(arg);
          if (p.not.some(cx => cx.parts.length > 1)) bad("combinators inside ':not()'");
        } else bad(`':${k}${arg === undefined ? '' : '(' + arg + ')'}'`);
        c.ps.push(p);
      } else break;
    }
    if (i == from) bad(`unexpected '${src[i] || 'end of selector'}'`);
    return c;
  };
  const out: Sel = [];
  ws();
  if (i >= src.length) return out;
  for (;;) {
    const cx: Complex = {parts: [compound()], combs: []};
    for (;;) {
      const space = ws();
      const ch = src[i];
      if (i >= src.length || ch == ',') break;
      if (ch == '+' || ch == '~') bad(`the '${ch}' combinator`);
      if (ch == '>') { i++; ws(); cx.combs.push('>'); }
      else if (space) cx.combs.push(' ');
      else bad(`unexpected '${ch}'`);
      cx.parts.push(compound());
    }
    out.push(cx);
    if (i >= src.length) return out;
    i++; // ','
    ws();
  }
}

/** element children of a vnode (fragments flattened, text and comments skipped) */
function kids(v: any): any[] {
  const out: any[] = [];
  for (const k of [].concat(v.children || [])) {
    if (!k || typeof k != 'object') continue;
    if ((k as any).sel) { if ((k as any).sel != '!') out.push(k); }
    else if ((k as any).children) out.push(...kids(k));
  }
  return out;
}
// parent + element siblings of each vnode of the latest rendered tree (for '>' and :nth-*)
const meta = new WeakMap<any, {p: any; sibs: any[]}>();
function index(root: any) {
  if (!root || typeof root != 'object') return;
  const walk = (v: any) => {
    for (const ks of [kids(v), kids({children: v.data?.portalChildren || []})]) {
      for (const k of ks) { meta.set(k, {p: v, sibs: ks}); walk(k); }
    }
  };
  const tops = root.sel ? [root] : kids(root);
  for (const t of tops) { meta.set(t, {p: undefined, sibs: tops}); walk(t); }
}
const tagOf = (v: any) => v.sel.split(/[.#]/)[0].toLowerCase();
function is(v: any, c: Compound): boolean {
  const d = v.data || {}, p = d.props || {}, a = d.attrs || {};
  const [tagId, ...cls] = v.sel.split('.');
  const [tag, sid] = tagId.split('#');
  if (c.tag && tag.toLowerCase() != c.tag) return false;
  const id = sid || p.id || a.id;
  if (c.id !== undefined && id != c.id) return false;
  if (c.cls.length) {
    const classes = cls.concat(
      `${p.className || ''} ${a.class || ''}`.split(' '),
      Object.keys(d.class || {}).filter(k => d.class[k])
    );
    if (!c.cls.every(n => classes.includes(n))) return false;
  }
  for (const [name, op, val] of c.attrs) {
    const raw = name == 'id' ? id
      : name in a ? a[name]
      : name in p ? p[name]
      : name.startsWith('data-') ? str(d.dataset)[name.slice(5).replace(/-(\w)/g, (_: any, l: string) => l.toUpperCase())]
      : undefined;
    if (raw == null || raw === false) return false;
    const x = String(raw);
    if (op && !(op == '=' ? x == val
      : !val ? false
      : op == '^=' ? x.startsWith(val)
      : op == '$=' ? x.endsWith(val)
      : op == '*=' ? x.includes(val)
      : x.split(/\s+/).includes(val))) return false;
  }
  for (const ps of c.ps) {
    if (ps.not) { if (matches(ps.not, [v])) return false; continue; }
    let sibs = (meta.get(v) || {sibs: [v]}).sibs;
    if (ps.type) sibs = sibs.filter(s => tagOf(s) == tagOf(v));
    if (ps.k == 'only') { if (sibs.length != 1) return false; continue; }
    const n = sibs.indexOf(v), pos = ps.last ? sibs.length - n : n + 1;
    if (ps.a == 0 ? pos != ps.b : (pos - ps.b) / ps.a < 0 || (pos - ps.b) % ps.a != 0) return false;
  }
  return true;
}
/** does the last of `els` (an ancestor chain, root first, maybe scope-filtered) match `sel`? */
function matches(sel: Sel, els: any[]): boolean {
  const at = (cx: Complex, j: number, i: number): boolean => {
    if (i < 0 || !is(els[i], cx.parts[j])) return false;
    if (j == 0) return true;
    if (cx.combs[j - 1] == '>') {
      const m = meta.get(els[i]);
      return i > 0 && (!m || els[i - 1] === m.p) && at(cx, j - 1, i - 1);
    }
    for (let k = i - 1; k >= 0; k--) if (at(cx, j - 1, k)) return true;
    return false;
  };
  return sel.some(cx => at(cx, cx.parts.length - 1, els.length - 1));
}
/** root → element chain of the first element (document order) matching `sel` */
function find(v: any, sel: Sel, chain: any[] = []): any[] | undefined {
  if (!v || typeof v != 'object') return;
  const c = v.sel ? chain.concat(v) : chain;
  if (v.sel && matches(sel, c)) return c;
  // a <Portal>'s content is rendered elsewhere; it is kept on its placeholder
  for (const k of [].concat(v.children || [], v.data?.portalChildren || [])) {
    const r = find(k, sel, c);
    if (r) return r;
  }
}

/** Internal (perf-guard tests): number of SYG104 tree walks */
export const _testingStats = {walks: 0};

// 1H-5: live renderComponent instances; the explicit diagnostics config and the strict flag
// (R4) from before the outermost one are restored when the last one is disposed
let active = 0;
/** quiet window after which the whole tree counts as rendered (G-047) */
const QUIET_MS = 10;
// G-053: defaults of the timing options (eventWaitMs: how long an event waits for its element /
// listeners, G-049/G-039; settleMs: settle()'s quiet window, longer than a model next()'s
// default 10ms delay; timeoutMs: next()/waitForState()/settle())
const TIMING = {eventWaitMs: 300, settleMs: 20, timeoutMs: 2000};
// a model next() call, seen through the component's debug log (component.ts makeOnAction /
// makeEffectHandler: "... next() action: <TYPE> 400ms delay")
const NEXT_LOG = /next\(\) action: <(.*)> (\d+)ms delay$/;
const RESERVED_SINKS = /^(STATE|EFFECT|PARENT|READY|DOM)$/;
// E2: a source name that a driver would provide (fake sources are made only for these)
const DRIVER_NAME = /^[A-Z][A-Z0-9_]*$/;
// R2-5: setTimeout fires at once for a delay above 2^31-1 ms (and for Infinity/NaN)
const MAX_MS = 2147483647;
const validMs = (v: any) => typeof v == 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_MS;
// E11: fake timers. vi.useFakeTimers() (and Jest's modern timers) install @sinonjs/fake-timers,
// which puts its clock on the faked setTimeout. The harness's own timers then run on that clock
// too, so its time is the clock's (Date may be left real by `toFake`), and its waits drive it.
const fakeClock = (): any => (setTimeout as any).clock;
const clockNow = (): number => { const c = fakeClock(); return c ? c.now : Date.now(); };
/**
 * Under fake timers, advance the clock timer by timer (nextAsync flushes promises around each
 * one) until `p` settles. Every pending wait has a timer (its timeout, a quiet-window tick), so
 * this ends; with no timer left it stops and leaves `p` to the test. Real timers: `p` as is.
 */
const drive = <T>(p: Promise<T>, stop: () => boolean): Promise<T> => {
  const clock = fakeClock();
  if (!clock) return p;
  let settled = false;
  p.then(() => { settled = true; }, () => { settled = true; });
  return (async () => {
    while (!settled && !stop() && fakeClock() === clock) {
      if (!clock.countTimers()) {
        await clock.nextAsync(); // one more flush: a microtask may schedule one
        if (!clock.countTimers()) break;
      }
      await clock.nextAsync();
    }
    return p;
  })();
};
let savedConfig: ReturnType<typeof _getDiagnosticsConfig>;
let savedStrict: any;

export function renderComponent(
  componentDef: any,
  options: RenderOptions = {}
): RenderResult {
  const {initialState, mockConfig = {}, drivers = {}, diagnostics, strict} = options;
  const {intent, model = {}} = componentDef;
  const timing = {...TIMING};
  for (const k of Object.keys(TIMING) as (keyof typeof TIMING)[]) {
    const v = options[k];
    if (v === undefined) continue;
    if (!validMs(v)) throw new Error(`[Sygnal] renderComponent: ${k} must be a finite number of ms between 0 and ${MAX_MS} (got ${String(v)})`);
    timing[k] = v;
  }
  const {eventWaitMs, settleMs, timeoutMs: defaultTimeout} = timing;
  // R2-5: settle() could never see a quiet window longer than its timeout
  if (settleMs > defaultTimeout) {
    throw new Error(`[Sygnal] renderComponent: settleMs (${settleMs}) is longer than timeoutMs (${defaultTimeout}), so settle() would always time out. Lower settleMs or raise timeoutMs`);
  }
  const checkMs = (name: string, ms: any) => {
    if (!validMs(ms)) throw new Error(`[Sygnal] ${name}: the timeout must be a finite number of ms between 0 and ${MAX_MS} (got ${String(ms)})`);
  };

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
  let activity = 0, lastActivity = clockNow();
  const bump = () => { activity++; lastActivity = clockNow(); };
  const mine = (c: any) => c?.sources?.[c.DOMSourceName || 'DOM']?._hub === hub.$;
  // G-053: model next() calls of the tree's components (for the timeout explanations)
  type Scheduled = {type: string; delay: number; at: number; due: number; by: string};
  const scheduled: Scheduled[] = [];
  // G-064: listeners on the driverless sinks of descendants (removed when they're disposed)
  const childSinks = new Map<any, Array<[any, any]>>();
  const recordChildSinks = (c: any) => {
    const m = c.model$ || {}, own = new Set<string>(c.sourceNames || []);
    const extra = Object.keys(m).filter(k => !own.has(k) && !RESERVED_SINKS.test(k) &&
      k != c.stateSourceName && typeof m[k]?.addListener == 'function');
    if (!extra.length) return;
    childSinks.set(c, []);
    // subscribed after the constructor, as a parent's sinks would be; actions start >= 1ms later
    queueMicrotask(() => {
      const list = childSinks.get(c);
      if (disposed || !list) return;
      for (const k of extra) {
        const l = {next: (v: any) => sinkValues(k).push(v), error: noop, complete: noop};
        m[k].addListener(l);
        list.push([m[k], l]);
      }
    });
  };
  const watchNext = (c: any) => {
    const log = c.log;
    if (typeof log != 'function') return;
    c.log = function (this: any, msg: any, now?: boolean) {
      const m = now && typeof msg == 'string' && msg.match(NEXT_LOG);
      if (m) {
        const at = clockNow();
        if (scheduled.length > 50) scheduled.splice(0, scheduled.length - 50);
        scheduled.push({type: m[1], delay: +m[2], at, due: at + +m[2], by: c.name});
      }
      return log.apply(this, arguments as any);
    };
  };
  const offCheck = registerCheck({
    id: 'renderComponent',
    // R2-3: the harness's bookkeeping (G-064 child sinks, G-053 next() delays, settle()'s
    // activity) also runs with diagnostics: 'off'; what it reports still obeys the mode
    always: true,
    onRender: bump,
    onReducer: bump,
    onIntent(c: any) {
      bump();
      const sc = scopeOf(c);
      if (sc) owners.set(sc, c.name);
      if (c.sources[c.DOMSourceName || 'DOM']?._hub == hub.$) scopeIds.set(sc || '', c._componentNumber);
    },
    onModel(c: any) {
      if (!mine(c)) return;
      watchNext(c);
      recordChildSinks(c);
    },
    // E2: an intent that reads a driver-like source with no driver (HTTP.select(...) without
    // drivers: { HTTP }) gets the scriptable fake (t.respond / t.fail), shared by name
    sources(c: any, s: any) {
      if (!mine(c) || typeof Proxy != 'function') return;
      return new Proxy(s, {
        get: (t: any, k: any) => typeof k == 'string' && !(k in t) && DRIVER_NAME.test(k) ? fake(k) : t[k],
      });
    },
    // 1H-11: forget a disposed child's listeners, so they aren't checked on every render.
    // R2-4: not before its DISPOSE action has been processed: this hook runs first, and
    // dispose() tears the child's streams down on the next macrotask, so remove them after that
    onDispose(c: any) {
      const own = childSinks.get(c);
      if (own) {
        setTimeout(() => setTimeout(() => {
          if (childSinks.get(c) !== own) return;
          childSinks.delete(c);
          own.forEach(([s, l]) => { try { s.removeListener(l); } catch (_) {} });
        }));
      }
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
  // sels: the selector (inspect() passes it split into words)
  const probe = (sels: string | string[], scope?: string, target?: any) => {
    let own = false, child: string | undefined, hit = !target;
    const sel = tryParse(Array.isArray(sels) ? sels.join(' ') : sels);
    if (!sel || !sel.length) return {own, child, hit: false};
    const desc = (_: any, els: any[]) => matches(sel, els);
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
      const selector = selText(path);
      const scope = path.filter(isScope).pop();
      const name = owners.get(scope || '') || 'Component';
      const key = name + '\u0000' + selector;
      if (!selector || PAGE.test(selector) || done.has(key)) return;
      const {own, child, hit} = probe(selector, scope, target);
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

  // E2: scriptable fake sources (t.respond / t.fail) for sinks/sources with no driver. Same
  // source API as makeFetchDriver / driverFromAsync: select(category?) and errors(category?),
  // where the selector is a category string, a predicate, or nothing (everything).
  type FakeSub = {l: any; sel: any; err: boolean};
  const fakes = new Map<string, {select: any; errors: any; subs: Set<FakeSub>}>();
  const fake = (name: string) => {
    let f = fakes.get(name);
    if (!f) {
      const subs = new Set<FakeSub>();
      const src = (err: boolean) => (sel?: any) => {
        let sub: FakeSub;
        return xs.create({
          start: (l: any) => { subs.add((sub = {l, sel, err})); },
          stop: () => { subs.delete(sub); },
        });
      };
      fakes.set(name, (f = {select: src(false), errors: src(true), subs}));
    }
    return f;
  };

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
        allDrivers[n] = () => fake(n);
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
  // (re-tried on every render), at most eventWaitMs; then it is delivered to the live listeners
  // (or, with no matching element, fails the test, G-070; with allowMissing it is dropped
  // with SYG103).
  type Input = {go: (last: boolean) => boolean, until?: number, wait?: number, missing?: () => Error | undefined};
  const inputs: Input[] = [];
  let isReady = false, retryTimer: any;
  const pump = () => {
    if (!isReady || disposed) return;
    while (inputs.length) {
      const head = inputs[0];
      head.until = head.until || clockNow() + (head.wait ?? eventWaitMs);
      if (!head.go(clockNow() >= head.until)) return retry(5);
      inputs.shift();
      bump();
    }
  };
  const retry = (ms: number) => {
    if (!retryTimer && inputs.length) retryTimer = setTimeout(() => { retryTimer = 0; pump(); }, ms);
  };
  let markReady: () => void;
  // G-065: states.length when the component became ready (before the buffered input was
  // replayed). ready() arms a cursor there (or, when ready() is called on an already-ready
  // component, at the call), so `await t.ready()` doesn't make next() miss the states the
  // replayed input produced. R2-6: every next() call starts at the cursor while it is armed
  // (so `Promise.all([t.next(a), t.next(b)])` both do). It is disarmed by simulateEvent(),
  // simulateAction(), settle(), waitForState(), a later ready() (which re-arms it), and by
  // the first next() that started at it resolving. If no next() has used it by the
  // macrotask after ready() resolves, it expires (an un-awaited ready() in a beforeEach
  // doesn't make a much later next() return an old state).
  let readyAt = 0, cursor: number | undefined, arming = 0, cursorUsed = false;
  const readyPromise = new Promise<void>(r => {
    markReady = () => {
      readyAt = states.length;
      isReady = true;
      pump();
      r();
    };
  });
  const ready = () => {
    cursor = isReady ? states.length : -1;
    const id = ++arming;
    cursorUsed = false;
    readyPromise.then(() => setTimeout(() => { if (id == arming && !cursorUsed) cursor = undefined; }));
    return drive(readyPromise, () => disposed);
  };
  const later = (go: Input['go'], missing?: Input['missing']) => { cursor = undefined; inputs.push({go, missing}); pump(); };

  let vtree: any;
  let timer: any;
  // states[0 .. renderedUpTo) were recorded before the latest render (1H-12)
  let renderedUpTo = 0;
  const arm = () => timer || (timer = setTimeout(() => markReady(), 12));
  if (sinks.DOM) {
    listen(sinks.DOM, v => {
      vtree = v;
      index(v);
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
    const start = clockNow();
    let seen = -1;
    while (!disposed) {
      const idle = clockNow() - lastActivity;
      if (clockNow() - start > cap) return false;
      if ((!sinks.DOM || renderedUpTo >= n || clockNow() - start > 100) && idle >= quiet && !busy()) {
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

  // G-070: a simulateEvent whose selector matches nothing fails the test. The error rejects
  // the pending next()/waitForState()/settle() calls; with none pending it is kept and thrown
  // by the next simulate*/wait/expectNoDiagnostics()/dispose() call.
  let failure: Error | undefined;
  const waiters = new Set<(e: Error) => void>();
  const failWith = (e: Error) => {
    if (!waiters.size) return void (failure = failure || e);
    const ws = [...waiters];
    waiters.clear();
    ws.forEach(r => r(e));
  };
  const takeFailure = () => { const f = failure; failure = undefined; return f; };
  const throwFailure = () => { const f = takeFailure(); if (f) throw f; };
  const noMatch = (selector: string, type: string, waited: boolean) => {
    const out = html();
    return new Error(`[Sygnal] simulateEvent('${selector}', '${type}'): the selector matched nothing in the rendered output` +
      (waited ? ` (waited ${eventWaitMs}ms for it to render; the eventWaitMs option sets this)` : '') +
      `. Check t.html() to see what rendered, or give the element an attribute and select it, e.g. [data-id="3"]` +
      ` (pass { allowMissing: true } to drop the event instead).\nRendered: ${out.length > 600 ? out.slice(0, 600) + '…' : out || '(nothing)'}`);
  };

  const simulateAction = (type: string, data?: any) => {
    throwFailure();
    later(() => (actions.emit({type, data}), true));
  };

  // E2: t.respond / t.fail. The answered request is picked when the call is delivered (in
  // order with simulate* calls), waiting up to 1s for the component to send one.
  const answered = new WeakSet<object>();
  const pendingRequests = (name: string) => {
    let live: Array<{raw: any; category: any}> = [];
    for (const raw of sinkValues(name)) {
      const r = typeof raw == 'string' ? {url: raw} : raw;
      if (!r || typeof r != 'object') continue;
      // { abort: true } cancels everything; with a category, or a latest: true request, the
      // ones in flight in that category
      if (r.abort && !('category' in r)) live = [];
      else if (r.abort || r.latest) live = live.filter(x => x.category !== r.category);
      if (!r.abort && !answered.has(raw)) live.push({raw, category: r.category});
    }
    return live;
  };
  const reply = (fn: string, name: string, err: boolean, build: (category: any, request: any) => any, opts: any) => {
    throwFailure();
    if (drivers[name]) throw new Error(`[Sygnal] t.${fn}('${name}'): ${name} has a real driver (passed in drivers), so there is nothing to script. t.respond/t.fail answer the fake source renderComponent provides when no driver is passed`);
    const o = typeof opts == 'string' ? {category: opts} : opts || {};
    const what = `t.${fn}('${name}'${typeof opts == 'string' ? `, …, '${opts}'` : ''})`;
    const input: Input = {
      // up to 1s (half of timeoutMs if lower), so a wait (next/settle) still times out later
      wait: Math.min(1000, defaultTimeout / 2),
      go: last => {
        let request = o.request, category = o.category;
        // request: null pushes a value no request asked for (a source that emits on its own)
        if (request === null) {
          request = undefined;
        } else if (request !== undefined) {
          // an explicit request that is no longer pending (superseded, aborted, answered) gets
          // nothing, like the real driver
          if (!pendingRequests(name).some(x => x.raw === request)) return true;
        } else {
          const live = pendingRequests(name).filter(x => !('category' in o) || x.category === category);
          if (!live.length) {
            if (!last) return false;
            const sent = sinkValues(name).length;
            failWith(new Error(`[Sygnal] ${what}: no pending ${name} request${'category' in o ? ` with category '${category}'` : ''} after ${Math.min(1000, defaultTimeout / 2)}ms. ` +
              (sent ? `The component sent ${sent} (t.requests('${name}')), all answered, aborted or superseded by a later latest: true request.` :
                `The component sent none: check the model entry that returns the ${name} request (t.requests('${name}') is empty).`)));
            return true;
          }
          request = live[live.length - 1].raw;
        }
        if (request && typeof request == 'object') answered.add(request);
        if (!('category' in o)) category = request?.category;
        const payload = build(category, request);
        const f = fake(name);
        let heard = false;
        f.subs.forEach(sub => {
          let hit = false;
          try { hit = sub.err === err && (sub.sel === undefined || (typeof sub.sel == 'function' ? sub.sel(payload) : sub.sel === category)); } catch (_) {}
          if (hit) { heard = true; sub.l.next(payload); }
        });
        if (!heard) {
          const ls = [...f.subs].filter(x => x.err === err).map(x => `${name}.${err ? 'errors' : 'select'}(${x.sel === undefined ? '' : typeof x.sel == 'function' ? 'fn' : `'${x.sel}'`})`);
          failWith(new Error(`[Sygnal] ${what}: nothing receives it: no intent listens to ${name}.${err ? 'errors' : 'select'}(${category === undefined ? '' : `'${category}'`})` +
            (ls.length ? ` (listening: ${ls.join(', ')})` : '') + `. ` +
            (err ? `Handle failures in the intent, e.g. FAILED: ${name}.errors('${category ?? 'category'}'), so a failed request can't leave the component loading.` :
              `Select the request's category in the intent, e.g. LOADED: ${name}.select('${category ?? 'category'}').`)));
        }
        return true;
      },
    };
    cursor = undefined;
    inputs.push(input);
    pump();
  };
  const respond = (name: string, value: any, opts?: string | FakeReplyOptions) =>
    reply('respond', name, false, (category, request) =>
      ({category, value, status: (opts as any)?.status ?? 200, request}), opts);
  const fail = (name: string, error: any, opts?: string | FakeReplyOptions) =>
    reply('fail', name, true, (category, request) => {
      let e = error;
      if (typeof e == 'number') { e = new Error(`HTTP ${error}`); e.status = error; }
      else if (typeof e == 'string') e = new Error(e);
      const o: any = typeof opts == 'object' ? opts : {};
      return {error: e, category, request, status: o.status ?? e?.status, body: o.body ?? e?.body};
    }, opts);

  const simulateEvent = (selector: string, type: string, init: SimulatedEventInit = {}) => {
    throwFailure();
    const {allowMissing, ...evInit} = init;
    const text = norm(String(selector));
    // 'document' / 'body' (and '') name a listener, not an element
    const page = !text || PAGE.test(text);
    // unsupported syntax throws here, at the call (G-070)
    const sel = page ? [] : parse(text);
    // nothing pending and the tree is quiet (as settle() would see it): fail at the call
    if (!page && !allowMissing && isReady && !inputs.length && vtree && renderedUpTo >= states.length &&
        clockNow() - lastActivity >= settleMs && !find(vtree, sel)) {
      throw noMatch(selector, type, false);
    }
    later(last => {
      const chain = page ? undefined : find(vtree, sel);
      const el = chain?.[chain.length - 1];
      if (!page && !el) {
        if (!last) return false;
        if (!allowMissing) {
          failWith(noMatch(selector, type, true));
          return true;
        }
        raise('SYG103', rootName,
          `simulateEvent('${selector}', '${type}') matched no rendered element within ${eventWaitMs}ms, so the event was dropped`,
          `Check the selector against the view's className/id, or wait until the element is rendered (await t.next(...) or t.settle())`,
          {selector, type});
        return true;
      }
      const match = (path: string[]) => {
        let ls = selText(path);
        if (!chain) return ls == text;
        let els = chain;
        if (PAGE.test(ls)) ls = ls.replace(PAGE, '');
        else {
          const scope = path.filter(isScope).pop();
          let cur: string | undefined;
          els = chain.filter(v => {
            const m = v.sel.match(/\.___[^.#]+/);
            if (m) cur = m[0];
            return cur == scope;
          });
        }
        if (!ls) return true;
        const lsel = tryParse(ls);
        return !!lsel && els.some((_, k) => matches(lsel, els.slice(0, k + 1)));
      };
      // G-039: wait until every listener this event would reach is subscribed
      if (!last) {
        for (const [k, path] of listeners) {
          if ((evTypes[k] || []).includes(type) && !live.get(k + '\u0000' + type) && match(path)) return false;
        }
      }
      if (el) check104(el);
      const d = el?.data || {}, p = d.props || {};
      const {target: t = {}, value, checked, dataset, data, ...rest} = evInit;
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
        const closestFrom = (from: number) => (s: string): any => {
          const cs = parse(String(s));
          for (let i = from; i >= 0; i--) {
            if (matches(cs, chain.slice(0, i + 1))) return i == chain.length - 1 ? target : like(i);
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
    }, page || allowMissing ? undefined : () => (find(vtree, sel) ? undefined : noMatch(selector, type, false)));
  };

  // first state at index >= from matching predicate; resolves after the full tree rendered it
  const waitMatch = (from: number, predicate: (state: any) => boolean, timeoutMs: number, name: string): Promise<any> =>
    new Promise((resolve, reject) => {
      const f = takeFailure();
      if (f) return reject(f);
      const found = (i: number) => {
        clearTimeout(timer);
        stateStream.removeListener(listener);
        treeRendered(i + 1).then(() => { waiters.delete(fail); resolve(states[i]); });
      };
      const test = (i: number) => { try { return predicate(states[i]); } catch (_) { return false; } };
      const fail = (err: Error) => { clearTimeout(timer); stateStream.removeListener(listener); waiters.delete(fail); reject(err); };
      waiters.add(fail);
      const base = states.length;
      const listener = {
        // the recording listener (added first) has already pushed the new state; a
        // remembered state replayed on addListener isn't new (states.length == base)
        next: () => { if (states.length > base && test(states.length - 1)) found(states.length - 1); },
        error: (err: any) => fail(err),
        complete: () => fail(new Error(`${name}: state stream completed without matching`)),
      };
      const start = clockNow();
      const timer = setTimeout(() => {
        let msg = `${name} timed out after ${timeoutMs}ms.`;
        const [why, pending] = explainNext(start);
        msg += why;
        if (pending) msg += ` Wait longer: t.${name}(pred, ms), or the renderComponent timeoutMs option (default for every wait).`;
        // G-065: a state from before the call matched; next() only looks at new ones
        for (let i = from - 1; i >= 0; i--) {
          if (test(i)) {
            msg += ` A state recorded before this next() call already matches the predicate (t.states[${i}]); next() only matches new states.` +
              ` Use t.waitForState(pred) to search the history too, or call next() before the input that causes the state.`;
            break;
          }
        }
        fail(new Error(msg));
      }, timeoutMs);
      for (let i = from; i < states.length; i++) if (test(i)) return found(i);
      stateStream.addListener(listener);
    });

  /**
   * G-053: the model next() calls scheduled during a wait that started at `start` (or still
   * pending): an explanation for a timeout, and whether one is still pending.
   */
  const explainNext = (start: number): [string, boolean] => {
    const now = clockNow(), byKey = new Map<string, Scheduled & {n: number}>();
    for (const s of scheduled) {
      if (s.due <= now && s.at < start) continue;
      const k = s.by + '\u0000' + s.type;
      byKey.set(k, {...s, n: (byKey.get(k)?.n || 0) + 1});
    }
    if (!byKey.size) return ['', false];
    let pending = false;
    const list = [...byKey.values()].map(s => {
      const left = s.due - now;
      if (left > 0) pending = true;
      return `next('${s.type}') scheduled by ${s.by} with a ${s.delay}ms delay` +
        (s.n > 1 ? ` (${s.n} times)` : '') + (left > 0 ? ` is still pending (fires in ${left}ms)` : '');
    });
    return [` Model next() calls during the wait: ${list.join('; ')}.`, pending];
  };

  const waitForState = (predicate: (state: any) => boolean, timeoutMs: number = defaultTimeout) => {
    checkMs('waitForState', timeoutMs);
    cursor = undefined;
    return drive(waitMatch(0, predicate, timeoutMs, 'waitForState'), () => disposed);
  };
  const next = (predicate: (state: any) => boolean = () => true, timeoutMs: number = defaultTimeout) => {
    checkMs('next', timeoutMs);
    if (cursor === undefined || (cursor < 0 && !isReady)) return drive(waitMatch(states.length, predicate, timeoutMs, 'next'), () => disposed);
    const id = arming;
    cursorUsed = true;
    const p = waitMatch(cursor < 0 ? readyAt : cursor, predicate, timeoutMs, 'next');
    // the first next() from the cursor to resolve disarms it (sequential next() calls move on)
    p.then(() => { if (id == arming) cursor = undefined; }, noop);
    return drive(p, () => disposed);
  };
  const settle = (timeoutMs: number = defaultTimeout): Promise<void> => {
    checkMs('settle', timeoutMs);
    return drive(settleWait(timeoutMs), () => disposed);
  };
  const settleWait = (timeoutMs: number): Promise<void> => new Promise((resolve, reject) => {
    cursor = undefined;
    const f = takeFailure();
    if (f) return reject(f);
    const done = (e?: Error) => { waiters.delete(done); e ? reject(e) : resolve(); };
    waiters.add(done);
    const start = clockNow();
    (async () => {
      await Promise.race([readyPromise, tick(timeoutMs)]);
      if (!await quiesce(states.length, settleMs, timeoutMs, () => !isReady || inputs.length > 0)) {
        const [why] = explainNext(start);
        throw new Error(`settle timed out after ${timeoutMs}ms: ${inputs.length ? `${inputs.length} simulated input(s) still pending` : `the component kept rendering (it never was quiet for settleMs = ${settleMs}ms)`}.` +
          why + (why ? ' A next() loop never goes quiet: wait for a specific state with t.next(pred) instead.' : ''));
      }
    })().then(() => done(), done);
  });

  const expectNoDiagnostics = () => {
    throwFailure();
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
    // G-070: an event still waiting for an element that never rendered fails the test
    const head = inputs[0];
    if (head && head.until && head.missing && !failure) failure = head.missing();
    inputs.length = 0;
    subs.forEach(([s, l]) => {
      try { s.removeListener(l); } catch (_) {}
    });
    childSinks.forEach(list => list.forEach(([s, l]) => { try { s.removeListener(l); } catch (_) {} }));
    childSinks.clear();
    try { sinks.__dispose?.(); } catch (_) {}
    rawDispose();
    restore();
    waiters.clear();
    throwFailure();
  };

  return {
    state$: stateStream,
    dom$: sinks.DOM || xs.never(),
    events$: sources.EVENTS || {select: () => xs.never()},
    sinks,
    sources,
    simulateAction,
    simulateEvent,
    ready,
    waitForState,
    next,
    settle,
    states,
    sinkValues,
    requests: sinkValues,
    respond,
    fail,
    emitted: sinkValues('EVENTS'),
    diagnostics: collected,
    expectNoDiagnostics,
    html,
    dispose,
    inspect,
  };
}
