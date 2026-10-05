import {start as startNext} from '../core/runtime';
import {mockDOMSource} from '../cycle/dom/mockDOMSource';
import {makeDOMDriver} from '../cycle/dom/makeDOMDriver';
import {enrichEventStream} from '../cycle/dom/enrichEventStream';
import eventBusDriver from './eventDriver';
import logDriver from './logDriver';
import {ownedCopy} from './owned';
import {renderToInnerHtml} from './ssr';
import {_getDiagnosticsConfig, configureDiagnostics, getDiagnosticsMode, isDiagnosticsEnabled, onDiagnostic, report} from './diagnostics/index';
import xs from './xstreamCompat';
import {tagRequest, inScope, makeFetchDriver} from './fetchDriver';
import {senderOf} from './replies';
import {makeSocketDriver} from './socketDriver';
import {makeRouter, paramsOf} from './router';
import {mergeHead} from './head';
import {timerDriver} from './timers';
import {browserDriver} from './browserSources';
import {makeReplies} from './replies';
import type {Stream} from 'xstream';
import type {Diagnostic, DiagnosticsMode} from './diagnostics/index';
import type {InspectGraph, InspectOptions} from './diagnostics/checks/public';
import {actionHooks} from './diagnostics/checks/actionLog';
import type {ActionCause, ActionListener, ActionRecord} from './diagnostics/checks/actionLog';
import {reportElementCommand, checkSentCommand, NATIVE_COMMAND_NAMES} from './diagnostics/checks/elementCommands';

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
 *   G-064: a descendant's model sink with no driver is recorded from the core's onSink
 *   hook and sent to the fake (its replies subscribed in onCreate, G-324; removed in
 *   onDispose); a passed driver wins.
 * - G-065: ready() arms a cursor (states.length when the component became
 *   ready, or at the call once ready) that the next next() starts from; any
 *   other t.* call disarms it.
 * - G-053: timing options eventWaitMs / settleMs / timeoutMs. Model next() calls
 *   are seen through the core's onNext hook; wait timeouts name them.
 * - Input is buffered until 12ms after the first render. With no render within 30ms
 *   (e.g. a model but no initialState), the 12ms start then. dispose() before ready
 *   leaves the buffered calls undelivered. D165/D176: an input's reducer runs when it is
 *   delivered, so a next() in the same tick starts at the state it causes; the cursor
 *   expires at the next macrotask (G-326).
 * - "Rendered by the whole tree" = the root rendered the state and no render,
 *   reducer, state or input happened anywhere for 10ms (checked twice; capped at
 *   250ms). Child renders are seen through the core's onRender hook.
 * - dispose() fires the component's DISPOSE action via sinks.__dispose.
 * - E11: fake timers (vi.useFakeTimers(), Jest's modern timers). The harness's own timers are
 *   faked with the app's, and its time is the clock's (clockNow). ready()/next()/
 *   waitForState()/settle() drive the clock (drive(): nextAsync until the wait settles), so
 *   they resolve without the test advancing it; their timeouts are clock time.
 * - E4 `dom: 'real'`: the DOM driver is run()'s makeDOMDriver on a fresh container in
 *   document.body; trackSource() wraps its sources so events() calls / subscriptions feed the
 *   same listener registry (paths with '.___scope' segments, `_hub`/`_path` like the mock).
 *   Real isolation keeps scopes in vnode data.isolate, not in the sel (scopeOfV reads both).
 *   simulateEvent finds the element with querySelector (container + mounted Portal content),
 *   maps it back to its vnode chain via vnode.elm (G-039 waits, SYG104), and fire()s a real
 *   event. The pump runs a macrotask after a render (the patch is a microtask after the sink
 *   emits) and each input waits for a QUIET_MS-quiet tree (capped at 100ms).
 * - 4-A1 real-mode waits: the driver's vnode input is gated. Each emitted tree is tagged with
 *   the number of states recorded when a view in the tree last ran (viewTag; a render
 *   follows the state in the next flush, a microtask later). A wait that matches holds renders of later states, resolves
 *   once its state is patched (and the tree is quiet, or a later state arrived), and releases
 *   the held render on the next macrotask, so the code after `await` reads the DOM of the
 *   state it got. The next next() starts after that state (`shown`), so the held states still
 *   match it. ready() resolves after the first patch; query()/queryAll()/html() before the
 *   first render throw (G-125).
 * - PLAN-4 2-C (GS-10) t.actions: ./diagnostics/checks/actionLog's actionHooks, a layer of the
 *   app's hooks (onAction, wrapHandler), so nothing is in the core. simulateAction() dispatches
 *   through the runtime API with the cause 'simulateAction'. t.explain() pairs each action whose
 *   STATE reducer produced a value with the next recorded root state.
 * - SYG103/104: the mock DOM source reports each events() call (selector path,
 *   isolation scopes included as '.___scope'); the onCreate hook maps each
 *   component's innermost scope to its name. The nearest '.___'
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

/**
 * E2 / PLAN-3 1-C: which request a t.respond()/t.fail() answers, as options. An object with
 * only these keys is options; any other object is a request pattern compared by value.
 */
export interface FakeReplyOptions {
  /** Only requests with this category */
  category?: string;
  /**
   * The request, compared by value: a request object (among equal pending requests that very
   * object, else the newest), a partial request, a URL string, or a predicate. `null`: push
   * the value without a request (for a source that emits on its own); `category` then sets
   * its category.
   */
  request?: any;
  /** Response status (respond: default 200), or fail(): an HTTP error response with this status */
  status?: number;
  /** fail(): the parsed error body */
  body?: any;
  /**
   * 6-B: that very request by its position in t.requests(name) (counting only those matching
   * `request`/`category`): 0 the first, -1 the newest; throws at the call when it isn't pending
   */
  nth?: number;
}
/** E2 / PLAN-3 1-C: a t.respond()/t.fail() target */
export type FakeReplyTarget = string | FakeReplyOptions | Record<string, any> | ((request: any) => boolean);

/**
 * PLAN-3 2-C: a connection declared on a fake socket source (t.connections(name)): the spec as
 * declared (`socket` or `sse`, action names, reconnect...) plus where and what it is.
 */
export interface FakeConnection {
  /** The connection's name in `{ connections: { [name]: spec } }` */
  name: string;
  /** The URL as declared (`socket` connections) */
  socket?: string;
  /** The URL as declared (`sse` connections) */
  sse?: string;
  /** The URL the socket was opened with (a socket path resolves to ws:/wss: on the page's host) */
  url: string;
  /** 'closed': dropped (t.drop), waiting for a retry or (reconnect: false) gone */
  state: 'connecting' | 'open' | 'closed';
  /** The name of the component that declared it */
  sender: string;
  [key: string]: any;
}
/**
 * PLAN-3 2-C: which connections a t.open/t.push/t.drop acts on: a connection name or URL (as
 * declared or as opened), a partial FakeConnection compared by value (`{ socket: '/ws/a' }`),
 * or a predicate. Nothing: the newest one that can take the call.
 */
export type FakeConnectionTarget = string | Record<string, any> | ((connection: FakeConnection) => boolean);

export interface RenderOptions {
  /** Override or provide initial state (defaults to component's .initialState) */
  initialState?: any;
  /**
   * D214: context from the ancestors the rendered component would have, for testing a child
   * alone: `renderComponent(Greeting, { context: { lang: 'fr' } })`. The view, reducers and
   * descendants read it as `context.lang`; the component's own `.context` entries win over a key
   * of the same name. Fixed values for the test's lifetime.
   */
  context?: Record<string, any>;
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
  /**
   * E4: 'mock' (default) renders into the mock DOM. 'real' patches the tree into a real
   * container element (needs a DOM: Vitest `environment: 'jsdom'` or 'happy-dom'), so
   * `checked`, `value`, `disabled`, focus (`document.activeElement`), refs and Portals are
   * real. simulateEvent then dispatches a real DOM event on the first matching element;
   * `t.container`, `t.query(sel)` and `t.queryAll(sel)` return real elements.
   */
  dom?: 'mock' | 'real';
  /**
   * PLAN-3 2-C: fake socket connections (a sink with no driver that gets `{ connections }`)
   * open by themselves (default true), reconnects included. false: they stay 'connecting' until
   * t.open(), for "Connecting…" assertions and failures to open (t.drop on a connecting one).
   */
  autoConnect?: boolean;
  /** PLAN-3 G-160: the driverless sink that receives the `connections` static (default 'WS') */
  socketSink?: string;
  /**
   * PLAN-3 3-A (exp): the driverless sink that receives the `resources` static (default
   * 'HTTP'). Its fake (5-1: makeFetchDriver over an in-memory fetch) keeps each resource fetch
   * pending until t.respond / t.fail (target: the resource name, its URL or a partial request)
   * answers it; t.requests lists it as `{ url, ...request, resource: name }` (5-5: a `{ prefetch }`
   * fetch as `{ url, ...request, prefetch: true }`).
   */
  resourceSink?: string;
  /**
   * PLAN-3 5-3: options for the HTTP fakes' makeFetchDriver (all but `fetch`), e.g.
   * `{ cache: queryCache() }` or `{ cache: queryCache({ staleTime: 30000 }), retry: 2 }` (D88; a
   * seeded cache: `queryCache({ initial: snapshot })`). Focus / reconnect refetches
   * come only from t.focus() / t.online(), never from the test's window.
   */
  http?: Record<string, any>;
  /**
   * PLAN-3 5-4c: the app's router (the object makeRouter() returns). With no driver for
   * `routerSink`, its real driver runs over an in-memory window (location, history with async
   * popstate, document listeners): t.navigate / t.back / t.forward / t.location / t.sent. Required
   * when the component declares `route` (else renderComponent throws, naming this option).
   */
  router?: any;
  /** PLAN-3 5-4c: the router fake's start URL (default '/') */
  url?: string;
  /** PLAN-3 5-4c: the sink the router fake serves (default 'ROUTER') */
  routerSink?: string;
  /** PLAN-3 5-4c: run the router's scroll handling in the fake (default false; positions are kept in memory) */
  routerScroll?: boolean;
  /** PLAN-3 5-4c: run the router's focus handling (default false; true: the router's own selector; a string: selectors) */
  routerFocus?: boolean | string;
  /** PLAN-3 5-4c: the sink the HEAD fake serves (default 'HEAD'); t.head() reads it */
  headSink?: string;
  /** PLAN-4 GS-7: the sink the timer fake serves (default 'TIMER'; the real makeTimerDriver()); t.timers() reads it */
  timerSink?: string;
  /** PLAN-5 B-3: the sink the browser fake serves (default 'BROWSER'); with no driver for it, the real browser driver runs over fake sources that t.browser drives */
  browserSink?: string;
  /** PLAN-5 B-3: the browser fake's environment at start (default: no media query matches, empty storage, visible, online, empty clipboard, no position, nothing denied) */
  browser?: BrowserFakeOptions;
  /** PLAN-3 5-4c: the HEAD fake's titleTemplate ('%s · App'), as makeHeadDriver's */
  titleTemplate?: string;
  /** PLAN-4 GS-11: the app-level error hook, as run()'s `onError` option */
  onError?: (error: any, info: {componentName?: string; action?: string; phase: string; driver?: string}) => void;
  /**
   * PLAN-4 GS-5: the fake storage behind a root's `persist()` ('local' and 'session' alike), as
   * key -> stored entry (`{ version, state }`, or a raw string). It is used as is, not copied:
   * writes land in it, and two renderComponent calls given the same object share one storage
   * (`sync: true` then applies one's writes in the other). Default: a new empty object.
   */
  storage?: Record<string, any>;
}

/**
 * PLAN-4 2-C (GS-10): one action in t.actions. `sinks` fills in as the action's reducers run
 * (STATE a microtask later), so the entry is live.
 */
export interface TestAction {
  /** The action name (a behavior's actions are namespaced, `pager.NEXT`) */
  type: string;
  /** Its data (the DOM event for a DOM intent stream) */
  data: any;
  /** The name of the component that ran it */
  component: string;
  /** That component instance's id (stable for its life; inspect()'s component id) */
  instance: string;
  /** The sinks that produced a value for it: not ABORT; STATE not the unchanged state; EFFECT when it ran */
  sinks: string[];
  /** Where it came from */
  cause: ActionCause;
  /** ms since renderComponent() was called (the fake clock under fake timers) */
  at: number;
}
export type {ActionCause};
/** PLAN-4 2-C: what t.explain() returns: the action, the root state it produced, and its STATE reducer */
export interface ExplainedAction extends TestAction {
  /** The first recorded root state after the action's STATE reducer ran */
  state: any;
  /** The STATE reducer: the model's function and its source text (JS exposes no source location) */
  reducer?: {action: string; sink: string; fn: Function; source: string};
}

/** PLAN-3 5-4c: what t.navigate takes: an href, or a route command */
export type FakeNavigateTarget = string | {to: string; params?: Record<string, any>; query?: Record<string, any>; hash?: string; replace?: boolean};

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
   * next() still scheduled, and a recorded state that already matched. `dom: 'real'` (4-A1):
   * right after another wait (no input in between) it starts after that wait's state.
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
   * PLAN-4 2-C (GS-10): every action the rendered tree ran (children and Collection items
   * included), in order: `{ type, data, component, instance, sinks, cause, at }`. cause is
   * 'intent' | 'next' | 'reply' | 'built-in' | 'simulateAction' | 'behavior'. Live array.
   */
  actions: TestAction[];
  /**
   * PLAN-4 2-C: the first action whose resulting root state matches `predicate`, with that state
   * and its STATE reducer (function and source text); undefined when none did.
   */
  explain: (predicate: (state: any) => boolean) => ExplainedAction | undefined;
  /** G-125: the latest recorded state (`states.at(-1)`; undefined before the first). Read-only */
  readonly state: any;
  /**
   * Live array of values emitted on a sink (EVENTS, PARENT, custom drivers, ...). A custom sink
   * with no driver is recorded for every component in the tree (children included, G-064).
   */
  sinkValues: (sinkName: string) => any[];
  /**
   * E2: the requests sent to a sink (live), as objects (G-171: a string is `{ url }`, a resource
   * fetch `{ url, ...request, resource: name }`); never `{ abort }` commands (G-141), `{ resources }`
   * declarations or `{ refresh }` commands. Answer the pending ones of a driverless sink with
   * respond() / fail().
   */
  requests: (sinkName: string) => any[];
  /**
   * E2 / PLAN-3 1-C / 5-1: answer a pending request on a fake source (a sink/source with no
   * driver, e.g. `HTTP` with no `drivers: { HTTP }`: makeFetchDriver over an in-memory fetch) with
   * a response whose body is `value` (JSON; text for a string): a request with reply actions
   * (`ok: 'LOADED'`) gets the parsed body as its LOADED action, on exactly its sender; a plain one
   * `{ category, value, status, request }` on `select()`. The request: the newest pending one
   * matching `target` (an ok/error action name, key, category, resource name or URL; a partial
   * request compared by value with its t.requests form; a predicate; FakeReplyOptions), or the
   * newest pending one. Throws at the call when
   * none matches, unless input is still queued before it or the component isn't ready: then
   * it waits up to 1s (half of timeoutMs if lower) for one. Resolves after the reply has been
   * reduced and rendered; rejects (and, un-awaited, fails the next wait) otherwise.
   */
  respond: (sinkName: string, value: any, target?: FakeReplyTarget) => Promise<void>;
  /**
   * E2 / PLAN-3 1-C: fail a pending request (chosen as in respond()): one with reply actions
   * (`error: 'FAILED'`) gets `{ error, request, status?, body? }` as its FAILED action; an
   * plain one `{ error, category, request, status, body }` on `errors()`. `error` may be an HTTP
   * status number or `{ status }` (an error response: the driver's Error 'HTTP 404: url' with
   * `status`/`body`), or an Error / message (a network failure: the fetch rejects with it).
   */
  fail: (sinkName: string, error: any, target?: FakeReplyTarget) => Promise<void>;
  /**
   * PLAN-3 2-C: a sink with no driver that gets `{ connections }` / `{ to }` values behaves like
   * makeSocketDriver (reply actions for open/message/close/error, diffed per component and name, shared by
   * URL, reconnect per spec on the test's timers). The connections declared now, in order.
   */
  connections: (sinkName: string) => FakeConnection[];
  /**
   * PLAN-3 5-3: the cache entries of an HTTP fake (renderComponent(C, { http: { cache: queryCache() } })):
   * `{ key, age, stale, subscribers, data, tags }` each (age in ms; undefined before data arrives);
   * [] without a queryCache
   */
  cache: (sinkName: string) => Array<{key: string; age?: number; stale: boolean; subscribers: number; data: any; tags?: string[]}>;
  /** PLAN-3 5-3: the window regains focus (queued like simulate*): stale mounted resources refetch (cache on) */
  focus: () => void;
  /** PLAN-3 5-3: the browser goes back online (queued like simulate*): stale mounted resources refetch (cache on) */
  online: () => void;
  /** PLAN-3 2-C: complete the open of connecting connection(s) (`autoConnect: false`, or a pending reconnect): `open` fires */
  open: (sinkName: string, target?: FakeConnectionTarget) => Promise<void>;
  /**
   * PLAN-3 2-C: the server sends `data` (objects as JSON text) on the open connection(s): `message`
   * fires (the data JSON-parsed when it parses). `{ event, connection? }`: an SSE named event.
   */
  push: (sinkName: string, data: any, target?: FakeConnectionTarget | {event?: string; connection?: FakeConnectionTarget}) => Promise<void>;
  /**
   * PLAN-3 2-C: the connection(s) close without the app closing them (a connecting one fails to
   * open: `error` first): `close` fires with `{ code, reason, willReconnect }` and the fake
   * reconnects per the spec. `close` defaults to `{ code: 1006, reason: '' }`.
   */
  drop: (sinkName: string, close?: {code?: number; reason?: string} | FakeConnectionTarget, target?: FakeConnectionTarget) => Promise<void>;
  /** PLAN-3 2-C: the `{ to, json | text | binary }` values the components sent (live; with `to`: those to that connection) */
  sent: (sinkName: string, to?: string) => any[];
  /**
   * PLAN-3 5-4c (router fake): navigate as a link click (a URL) or a command (`{ to, params,
   * query?, hash?, replace? }`) would, through `block`. Throws at the call for an unknown route,
   * a missing param or another origin; resolves once reduced and rendered.
   */
  navigate: (target: FakeNavigateTarget) => Promise<void>;
  /** PLAN-3 5-4c: the browser's back button on the in-memory history (throws with no entry to go back to) */
  back: () => Promise<void>;
  /** PLAN-3 5-4c: the browser's forward button */
  forward: () => Promise<void>;
  /** PLAN-3 5-4c: the in-memory location */
  readonly location: {path: string; search: string; hash: string; href: string};
  /** PLAN-3 5-4c: the HEAD fake's merged head (titleTemplate applied) */
  head: () => {title: string | undefined; meta: Record<string, any>; link: any[]};
  /** PLAN-4 GS-7: the timer fake's active timers, in start order: `{ name, every | after | frame, action, background?, component }` */
  timers: () => Array<Record<string, any>>;
  /** PLAN-5 B-3: the browser fake's controls (see BrowserFake) */
  browser: BrowserFake;
  /** PLAN-4 GS-5: the fake storage's entry for `key` (`{ version, state }`), undefined when none. Pending writes are flushed by t.settle() */
  storage: (key: string) => any;
  /** Live array of EVENTS sink emissions ({type, data}) */
  emitted: any[];
  /** Live array of diagnostics reported while rendered */
  diagnostics: Diagnostic[];
  /**
   * PLAN-4 GS-2: the element commands (`ELEMENT`) the tree's instances sent, one entry per
   * command (arrays flattened), as sent: `[{ focus: Email }]`. The mock DOM only records them;
   * `dom: 'real'` also runs them. Any other sink name: its sinkValues.
   */
  commands: (sinkName?: string) => any[];
  /** Throws (with the formatted texts) if any warn/error diagnostics were collected */
  expectNoDiagnostics: () => void;
  /**
   * Latest rendered VNode serialized to HTML. G-125: throws before the first render (await
   * t.ready() first); '' for a component that renders nothing.
   */
  html: () => string;
  /** Tear down the component, clean up listeners and restore the diagnostics mode */
  dispose: () => void;
  /**
   * The app graph (2B) of the rendered tree: components, actions, selectors (with the mock DOM's
   * match / isolation results), EVENTS and diagnostics. Requires `import 'sygnal/diagnostics'`.
   */
  inspect: (options?: Pick<InspectOptions, 'actions'>) => InspectGraph;
  /** `{ dom: 'real' }`: the element the tree is mounted in (removed on dispose()); else null */
  container: Element | null;
  /**
   * The first element matching a selector in the rendered tree (Portal content included), or
   * null. `{ dom: 'real' }`: the real element (`document.activeElement === t.query(...)`). 6-B:
   * the mock DOM gives a MockElement, a snapshot of what the view rendered (`.textContent`,
   * `.value`, `.checked`, `.disabled`, getAttribute, querySelector...). Throws before the first
   * render (await t.ready() first). 4-A1: after `await` of any wait, it shows the state the wait
   * resolved with (a later render is held back until the next macrotask).
   */
  query: (selector: string) => Element | null;
  /** Every element matching a selector in the rendered tree (Portals included), as query() */
  queryAll: (selector: string) => Element[];
  /**
   * PLAN-5 W-1: a widget's host by selector or control: `.props` (what the view passed it),
   * `.instance` (`dom: 'real'`: what mount returned) and `.dispatch(name, detail)` (the event
   * mount's `dispatch` sends, through simulateEvent; D201: `.emit` is an alias)
   */
  widget: (target: any) => {readonly props: any; readonly instance: any; dispatch: (name: string, detail?: any) => void; emit: (name: string, detail?: any) => void};
}

const isScope = (s: string) => s.startsWith('.___');
/** CT-1: a control (controls()) as its selector, [data-control="<Key>"]; anything else as is */
const selOf = (s: any) => typeof s == 'function' && s.__sygnalControl ? '' + s : s;
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
const SUPPORTED = "tag, *, .class, #id, [attr], [attr=\"v\"] (also ^= $= *= ~=), :first-child, :last-child, :only-child, :nth-child(an+b|odd|even), :nth-last-child(), :first-of-type, :last-of-type, :only-of-type, :nth-of-type(), :nth-last-of-type(), :not(...), :checked, :disabled, :enabled, the descendant (' ') and child ('>') combinators, ',' lists";
const IDENT = /^(?:[\w-]|\\.)+/;
const STATES = ['checked', 'disabled', 'enabled'];
const FORM = ['button', 'input', 'select', 'textarea', 'option', 'optgroup', 'fieldset'];
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
    const e: any = new Error(`[Sygnal] Unsupported selector syntax in '${src}': ${what}. Supported: ${SUPPORTED}. Or give the element an attribute and select it, e.g. [data-id="3"]. With renderComponent(C, { dom: 'real' }) any CSS selector works`);
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
        } else if (STATES.includes(k) && arg === undefined) {
          // 6-B: element state, as the view rendered it
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
    if (STATES.includes(ps.k)) {
      if (ps.k == 'checked' ? !flag(v, 'checked') && !(tagOf(v) == 'option' && flag(v, 'selected')) : !FORM.includes(tagOf(v)) || flag(v, 'disabled') == (ps.k == 'enabled')) return false;
      continue;
    }
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
/** root → element chains of every element (document order) matching `sel`, below `v` (and `v` with `self`) */
function findAll(v: any, sel: Sel, chain: any[], out: any[][], self = true): any[][] {
  if (!v || typeof v != 'object') return out;
  const c = v.sel ? chain.concat(v) : chain;
  if (v.sel && self && matches(sel, c)) out.push(c);
  for (const k of [].concat(v.children || [], v.data?.portalChildren || [])) findAll(k, sel, c, out);
  return out;
}

// ── Mock elements (PLAN-3 6-B, G-185) ────────────────────────────────────────
// t.query() / t.queryAll() on the mock DOM return these: read-only snapshots of one rendered
// vnode with the common Element reads (text, attributes, classes, form state, traversal,
// querySelector). They show what the view rendered: an input's value is its `value` prop, a
// checkbox is checked when the view says so; nothing is typed, focused or laid out.
const PROP_OF: Record<string, string> = {class: 'className', for: 'htmlFor', readonly: 'readOnly', tabindex: 'tabIndex'};
/** a boolean property (checked, disabled, ...) as rendered: the prop, else the attribute */
function flag(v: any, name: string): boolean {
  const d = v.data || {}, p = d.props || {}, a = d.attrs || {};
  if (name in p) return !!p[name];
  const x = name in a ? a[name] : a[name.toLowerCase()];
  return x != null && x !== false;
}
function classesOf(v: any): string[] {
  const d = v.data || {}, p = d.props || {}, a = d.attrs || {};
  const all: string[] = v.sel.split('#').flatMap((x: string) => x.split('.').slice(1)).concat(
    `${p.className || ''} ${a.class || ''}`.split(/\s+/), Object.keys(d.class || {}).filter(k => d.class[k]));
  return all.filter((c, i) => c && !c.startsWith('___') && all.indexOf(c) == i);
}
/** an attribute as getAttribute() reads it (null: absent) */
function attrOf(v: any, name: string): string | null {
  const d = v.data || {}, p = d.props || {}, a = d.attrs || {};
  const n = name.toLowerCase();
  if (n == 'class') { const c = classesOf(v); return c.length ? c.join(' ') : null; }
  if (n == 'id' && v.sel.includes('#')) return v.sel.split('#')[1].split('.')[0];
  const x = name in a ? a[name] : n in a ? a[n]
    : name in p ? p[name] : PROP_OF[n] && PROP_OF[n] in p ? p[PROP_OF[n]]
    : n.startsWith('data-') ? (d.dataset || {})[n.slice(5).replace(/-(\w)/g, (_: any, l: string) => l.toUpperCase())]
    : undefined;
  return x == null || x === false ? null : x === true ? '' : String(x);
}
function textOf(v: any): string {
  if (v == null || typeof v == 'boolean') return '';
  if (typeof v != 'object') return String(v);
  if (v.sel == '!') return '';
  return (v.text != null ? String(v.text) : '') + [].concat(v.children || []).map(textOf).join('');
}
const mockEls = new WeakMap<any, MockElement>();
/** the MockElement for the last vnode of a root → element chain */
const mockOf = (chain: any[], html: (v: any) => string): MockElement =>
  chain.reduce((parent: MockElement | null, v: any) => {
    const m = mockEls.get(v);
    return m && m._p === parent ? m : new MockElement(v, parent, html);
  }, null)!;
class MockElement {
  declare readonly nodeType: 1;
  declare private _v: any;
  declare readonly _p: MockElement | null;
  declare private _html: (v: any) => string;
  constructor(v: any, parent: MockElement | null, html: (v: any) => string) {
    Object.defineProperties(this, {_v: {value: v}, _p: {value: parent}, _html: {value: html}, nodeType: {value: 1}});
    mockEls.set(v, this);
  }
  private chain(): any[] {
    const c: any[] = [];
    for (let e: MockElement | null = this; e; e = e._p) c.unshift(e._v);
    return c;
  }
  get tagName() { return tagOf(this._v).toUpperCase(); }
  get nodeName() { return this.tagName; }
  get localName() { return tagOf(this._v); }
  get id() { return attrOf(this._v, 'id') ?? ''; }
  get className() { return classesOf(this._v).join(' '); }
  get classList() {
    const c = classesOf(this._v);
    return Object.assign(c, {contains: (x: string) => c.includes(x), item: (i: number) => c[i] ?? null, value: c.join(' ')});
  }
  get dataset() {
    const d = this._v.data || {}, out: Record<string, string> = {...str(d.dataset)};
    for (const src of [d.props || {}, d.attrs || {}]) {
      for (const k in src) if (k.startsWith('data-') && src[k] != null) out[k.slice(5).replace(/-(\w)/g, (_: any, l: string) => l.toUpperCase())] = String(src[k]);
    }
    return out;
  }
  get style() { return {...(this._v.data?.style || {})}; }
  get textContent() { return textOf(this._v); }
  get innerText() { return this.textContent; }
  get outerHTML() { return this._html(this._v); }
  get innerHTML() {
    const o = this.outerHTML, end = `</${this.localName}>`;
    return o.endsWith(end) ? o.slice(o.indexOf('>') + 1, -end.length) : '';
  }
  get value(): string {
    const v = this._v, p = v.data?.props || {}, tag = this.localName;
    if (p.value != null) return String(p.value);
    const a = attrOf(v, 'value');
    if (a !== null) return a;
    if (tag == 'textarea' || tag == 'option') return this.textContent;
    if (tag == 'select') {
      const o = this.querySelector('option:checked') || this.querySelector('option');
      return o ? o.value : '';
    }
    return tag == 'input' && /^(checkbox|radio)$/.test(this.type) ? 'on' : '';
  }
  get checked() { return flag(this._v, 'checked'); }
  get selected() { return flag(this._v, 'selected'); }
  get disabled() { return flag(this._v, 'disabled'); }
  get readOnly() { return flag(this._v, 'readOnly') || flag(this._v, 'readonly'); }
  get required() { return flag(this._v, 'required'); }
  get hidden() { return flag(this._v, 'hidden'); }
  get type() { return attrOf(this._v, 'type') ?? (this.localName == 'input' ? 'text' : this.localName == 'button' ? 'submit' : ''); }
  get name() { return attrOf(this._v, 'name') ?? ''; }
  /** as written in the view (a real <a>'s href is absolute) */
  get href() { return attrOf(this._v, 'href') ?? ''; }
  get src() { return attrOf(this._v, 'src') ?? ''; }
  get placeholder() { return attrOf(this._v, 'placeholder') ?? ''; }
  get title() { return attrOf(this._v, 'title') ?? ''; }
  get alt() { return attrOf(this._v, 'alt') ?? ''; }
  get htmlFor() { return attrOf(this._v, 'for') ?? ''; }
  getAttribute(name: string) { return attrOf(this._v, name); }
  hasAttribute(name: string) { return attrOf(this._v, name) !== null; }
  get parentElement() { return this._p; }
  get children(): MockElement[] { return kids(this._v).map(k => mockOf([...this.chain(), k], this._html)); }
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0] ?? null; }
  get lastElementChild() { const c = this.children; return c[c.length - 1] ?? null; }
  matches(selector: string) { return matches(parse(norm(selector)), this.chain()); }
  closest(selector: string): MockElement | null {
    const sel = parse(norm(selector));
    for (let e: MockElement | null = this; e; e = e._p) if (matches(sel, e.chain())) return e;
    return null;
  }
  querySelectorAll(selector: string): MockElement[] {
    return findAll(this._v, parse(norm(selector)), this.chain().slice(0, -1), [], false).map(ch => mockOf(ch, this._html));
  }
  querySelector(selector: string): MockElement | null { return this.querySelectorAll(selector)[0] ?? null; }
  /** vitest / pretty-format print an element as its HTML */
  toJSON() { return this.outerHTML; }
  // no events, focus or layout on a snapshot
  focus(): never { throw realOnly('focus'); }
  blur(): never { throw realOnly('blur'); }
  click(): never { throw realOnly('click'); }
  dispatchEvent(_e?: any): never { throw realOnly('dispatchEvent'); }
  addEventListener(..._a: any[]): never { throw realOnly('addEventListener'); }
  getBoundingClientRect(): never { throw realOnly('getBoundingClientRect'); }
}
const realOnly = (fn: string) => new Error(`[Sygnal] element.${fn}(): t.query() on the default mock DOM returns a snapshot of what the view rendered. Fire events with t.simulateEvent(selector, type), or use real elements: renderComponent(C, { dom: 'real' })`);

/**
 * The isolation scope a vnode starts ('.___scope'): the mock DOM appends it to the sel, the
 * real DOM driver's isolateSink puts it last in data.isolate (E4).
 */
function scopeOfV(v: any): string | undefined {
  const m = v.sel.match(/\.___[^.#]+/);
  if (m) return m[0];
  const iso = v.data?.isolate;
  return iso && iso.length ? '.___' + iso[iso.length - 1].scope : undefined;
}
/** root → element chain of the vnode patched into `el` (E4, real DOM) */
function chainOf(v: any, el: any, chain: any[] = []): any[] | undefined {
  if (!v || typeof v != 'object') return;
  const c = v.sel ? chain.concat(v) : chain;
  if (v.sel && v.elm === el) return c;
  for (const k of [].concat(v.children || [], v.data?.portalChildren || [])) {
    const r = chainOf(k, el, c);
    if (r) return r;
  }
}

// ── Real DOM (E4) ────────────────────────────────────────────────────────────
const INNER = Symbol('sygnal.testing.inner');
/**
 * Wraps a real DOM source (MainDOMSource / DocumentDOMSource / BodyDOMSource) so its events()
 * calls and subscriptions are reported like the mock's (G-039 waits, SYG103/104 bookkeeping),
 * with the same '.___scope' path; everything else is the real source.
 */
function trackSource(inner: any, path: string[], hub$: any, on: (path: string[], type: string, live?: boolean) => void): any {
  const own: any = {
    [INNER]: inner,
    _hub: hub$,
    _path: path,
    select: (sel: any) => trackSource(inner.select(sel), path.concat(selOf(sel)), hub$, on),
    events: (type: string, options?: any, bubbles?: boolean) => {
      on(path, type);
      const ev$ = inner.events(type, options, bubbles);
      let l: any;
      const out = enrichEventStream(xs.create({
        start: (x: any) => {
          ev$.addListener(l = {next: (v: any) => x.next(v), error: (e: any) => x.error(e), complete: () => x.complete()});
          on(path, type, true);
        },
        stop: () => { ev$.removeListener(l); on(path, type, false); },
      }));
      out._isCycleSource = ev$._isCycleSource;
      return out;
    },
  };
  if (typeof inner.isolateSource == 'function') {
    own.isolateSource = (source: any, scope: string) =>
      trackSource(inner.isolateSource(source[INNER] || source, scope), (source._path || path).concat('.___' + scope), hub$, on);
  }
  return new Proxy(inner, {
    get: (t, k) => k in own ? own[k] : typeof t[k] == 'function' ? t[k].bind(t) : t[k],
    has: (t, k) => k in own || k in t,
  });
}
// events the browser fires without bubbling (cf. eventTypesThatDontBubble; submit/reset do bubble)
const NO_BUBBLE = /^(blur|focus|mouseenter|mouseleave|pointerenter|pointerleave|load|unload|scroll|scrollend|invalid|close|cancel|toggle|beforetoggle|error|abort)$/;
/** dispatch a real DOM event, like a user would cause it (E4) */
function fire(el: any, type: string, init: SimulatedEventInit) {
  const {target: t = {}, value, checked, dataset, data, key, ...rest} = init;
  if ('value' in init) el.value = value;
  if ('checked' in init) el.checked = checked;
  for (const k in t) if (k != 'dataset') try { el[k] = t[k]; } catch (_) {}
  const ds = {...dataset, ...data, ...t.dataset};
  if (el.dataset) for (const k in ds) el.dataset[k] = String(ds[k]);
  const doc = el.ownerDocument || el;
  // focus()/blur() move document.activeElement and fire the events themselves
  if (type == 'focus' && typeof el.focus == 'function') {
    el.focus();
    if (doc.activeElement === el) return;
  }
  if (type == 'blur' && doc.activeElement === el && typeof el.blur == 'function') return el.blur();
  // click() runs the default action (checkbox/radio toggle, label, submit) and skips disabled controls
  if (type == 'click' && !Object.keys(rest).length && typeof el.click == 'function') return el.click();
  const W: any = (doc.defaultView || globalThis);
  const Ctor = /^key/.test(type) ? W.KeyboardEvent
    : /^(focus|blur|focusin|focusout)$/.test(type) ? W.FocusEvent
    : /^pointer/.test(type) ? W.PointerEvent || W.MouseEvent
    : /click|^mouse|^contextmenu$/.test(type) ? W.MouseEvent
    : /^(drag|drop)/.test(type) ? W.DragEvent || W.MouseEvent
    : /^(before)?input$/.test(type) ? W.InputEvent
    : W.Event;
  const ev = new (Ctor || W.Event)(type, {bubbles: !NO_BUBBLE.test(type), cancelable: true, ...(key !== undefined && {key}), ...rest});
  const extra: any = {...rest, ...(key !== undefined && {key})};
  if (/^(drag|drop)/.test(type) && !ev.dataTransfer) {
    const store: Record<string, string> = {};
    extra.dataTransfer = {setData: (f: string, v: string) => { store[f] = String(v); }, getData: (f: string) => store[f] ?? '', ...rest.dataTransfer};
  }
  for (const k in extra) if (ev[k] !== extra[k]) try { Object.defineProperty(ev, k, {value: extra[k]}); } catch (_) {}
  el.dispatchEvent(ev);
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

// PLAN-4 GS-5: a synchronous storage over a plain record (key -> parsed entry, or a raw string
// that isn't JSON), for persist(). The record's subscribers (persist's sync) hear every write,
// as other tabs hear a 'storage' event; persist skips its own writes.
const storageSubs = new WeakMap<object, Set<(k: string, v: string | null) => void>>();
const fakeStorage = (rec: Record<string, any>) => {
  let subs = storageSubs.get(rec);
  if (!subs) storageSubs.set(rec, subs = new Set());
  const notify = (k: string, v: string | null) => subs!.forEach(f => f(k, v));
  return {
    getItem: (k: string) => rec[k] == null ? null : typeof rec[k] == 'string' ? rec[k] : JSON.stringify(rec[k]),
    setItem: (k: string, v: string) => {
      v = String(v);
      try { rec[k] = JSON.parse(v); } catch (_) { rec[k] = v; }
      notify(k, v);
    },
    removeItem: (k: string) => { delete rec[k]; notify(k, null); },
    subscribe: (f: (k: string, v: string | null) => void) => (subs!.add(f), () => { subs!.delete(f); }),
  };
};
/** PLAN-5 B-3: renderComponent's `browser` option */
export interface BrowserFakeOptions {
  /** media query -> matches */
  media?: Record<string, boolean>;
  /** localStorage, key -> stored string */
  storage?: Record<string, string>;
  /** sessionStorage, key -> stored string */
  sessionStorage?: Record<string, string>;
  visible?: boolean;
  online?: boolean;
  clipboard?: string;
  /** the position a geolocation declaration starts with (coords; the rest default) */
  position?: Record<string, any>;
  /** permissions denied from the start */
  deny?: Array<'geolocation' | 'clipboard'>;
}

/** PLAN-5 B-3: t.browser. Each input resolves once its actions are reduced and the tree rendered */
export interface BrowserFake {
  /** the declarations of `intersection: target` hear `{ visible, ratio (1 or 0), index: 0, dataset: {} , ...data }`; `at`: only the at-th of them (start order). Throws when nothing declares it */
  intersect: (target: string | true, visible?: boolean, data?: Record<string, any> & {at?: number}) => Promise<void>;
  /** the declarations of `resize: target` hear `{ width, height, index: 0, dataset: {}, ...size }` */
  resize: (target: string | true, size: Record<string, any> & {at?: number}) => Promise<void>;
  /** a position (the coords; accuracy 0, the rest null, timestamp now) or an error `{ code, message }` for the geolocation declarations */
  geolocation: (position: Record<string, any>) => Promise<void>;
  /** a media query now matches (or not) */
  media: (query: string, matches: boolean) => Promise<void>;
  visibility: (visible: boolean) => Promise<void>;
  online: (online: boolean) => Promise<void>;
  /** with a value: another tab writes the key (a non-string is stored as JSON; null removes it); without: the stored string or null */
  storage: {(key: string): string | null; (key: string, value: any, area?: 'local' | 'session'): Promise<void>};
  /** with text: the clipboard's text now; without: its text */
  clipboard: {(): string; (text: string): Promise<void>};
  /** deny permissions: copy/paste fail with NotAllowedError, geolocation with code 1 (running ones too) */
  deny: (...kinds: Array<'geolocation' | 'clipboard'>) => void;
  /** the running declarations: `{ name, ...spec, component }`, in start order */
  active: () => Array<Record<string, any>>;
}

/**
 * PLAN-5 B-3: the browser fake's sources (the real browser driver runs over them): no DOM or
 * browser API. `live` holds the started declarations ({ k: kind, s: spec, c: its BrowserCtx });
 * t.browser.* reaches them. `o` is renderComponent's `browser` option (the environment at start).
 * G-387: intersection / resize start with the report a real observer sends for an element at
 * first (not visible, size 0), and under `dom: 'real'` (`real`) a selector that matches no
 * element of the component, once it has rendered, is SYG668.
 */
const browserFake = (o: any = {}, real?: boolean) => {
  const live = new Set<any>(), runners = new Map<any, any>();
  const env: any = {media: {...o.media}, local: {...o.storage}, session: {...o.sessionStorage}, deny: new Set(o.deny || []),
    visible: o.visible ?? true, online: o.online ?? true, clip: o.clipboard ?? '', pos: o.position};
  const failed = (x: any) => ({name: x?.name, message: x?.message});
  const area = (s: any) => env[s.area == 'session' ? 'session' : 'local'];
  const read = (s: any) => { const v = area(s)[s.storage ?? s.setItem ?? s.removeItem]; return v == null ? null : s.json ? JSON.parse(v) : v; };
  const pos = (p: any) => ({latitude: 0, longitude: 0, accuracy: 0, altitude: null, altitudeAccuracy: null, heading: null, speed: null, timestamp: Date.now(), ...p});
  const DENIED = {code: 1, message: 'User denied Geolocation'};
  // a declaration kind: registered while it runs; `now` gives the value it starts with (undefined: none)
  const on = (k: string, now?: (s: any, c: any) => any) => (s: any, c: any) => {
    const e = {k, s, c};
    live.add(e);
    if (now) { let v; try { v = now(s, c); } catch (x) { c.fail(failed(x)); } if (v !== undefined) c.send(v); }
    return () => { live.delete(e); };
  };
  // dom: 'real': the target's elements after the next render (or now, when there are some)
  const seen = (k: string) => (s: any, c: any) => {
    if (real && c.dom) {
      let sync = true;
      const $ = c.dom.select(s[k] === true ? '' : '' + s[k]).elements(), l = {next: (els: any[]) => {
        if (sync && !els.length) return;
        els.length || c.miss('none');
        Promise.resolve().then(() => $.removeListener(l));
      }};
      $.addListener(l);
      sync = false;
    }
    return {index: 0, dataset: {}, ...(k == 'resize' ? {width: 0, height: 0} : {visible: false, ratio: 0})};
  };
  const each = (k: string, f: (e: any) => void, key?: any) => [...live].filter(e => e.k == k && (key === undefined || e.s[k] === key)).forEach(f);
  // a write to the fake storage, seen by the storage declarations of that key and area
  // G-384: an unchanged value is silent (as the browser's own `storage` event and the real driver)
  const write = (key: string, v: any, a = 'local') => {
    const st = env[a == 'session' ? 'session' : 'local'], old = st[key] ?? null;
    v == null ? delete st[key] : st[key] = typeof v == 'string' ? v : JSON.stringify(v);
    if (old === (st[key] ?? null)) return;
    each('storage', e => { if ((e.s.area == 'session' ? 'session' : 'local') == (a == 'session' ? 'session' : 'local')) { try { e.c.send({key, value: read(e.s)}); } catch (x) { e.c.fail(failed(x)); } } }, key);
  };
  const clipFail = (fail: any) => fail({name: 'NotAllowedError', message: 'Clipboard permission denied'});
  const src = {
    d: {
      intersection: on('intersection', seen('intersection')),
      resize: on('resize', seen('resize')),
      media: on('media', s => ({matches: !!env.media[s.media], media: s.media})),
      storage: on('storage', s => ({key: s.storage, value: read(s)})),
      visibility: on('visibility', () => ({visible: env.visible})),
      online: on('online', () => ({online: env.online})),
      geolocation: on('geolocation', (_, c) => env.deny.has('geolocation') ? void c.fail(DENIED) : env.pos && pos(env.pos)),
    },
    c: {
      copy: (v: any, ok: any, fail: any) => env.deny.has('clipboard') ? clipFail(fail) : (env.clip = '' + v.copy, ok({text: env.clip})),
      paste: (_: any, ok: any, fail: any) => env.deny.has('clipboard') ? clipFail(fail) : ok({text: env.clip}),
      setItem: (v: any, ok: any) => { write(v.setItem, v.json ? JSON.stringify(v.value) : '' + v.value, v.area); ok({key: v.setItem}); },
      removeItem: (v: any, ok: any) => { write(v.removeItem, null, v.area); ok({key: v.removeItem}); },
    },
  };
  return {src, runners, live, env, each, write, pos, DENIED};
};
// a model next() call, seen through the component's debug log (the 5.x core's makeOnAction /
// makeEffectHandler: "... next() action: <TYPE> 400ms delay")
const RESERVED_SINKS = /^(STATE|EFFECT|PARENT|READY|DOM|ELEMENT)$/;
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
/**
 * PLAN-3 1-C: what t.respond / t.fail return: a Promise that notes when it is awaited (then()),
 * so an un-awaited failing call can still fail the next wait, and an awaited one under fake
 * timers can drive the clock. Its then() returns a plain Promise.
 */
class Reply extends Promise<void> {
  _seen?: () => void;
  static get [Symbol.species]() { return Promise; }
  then(a?: any, b?: any): any { this._seen?.(); return super.then(a, b); }
}
/**
 * PLAN-3 5-1 (H-9): the reply the HTTP fake's in-memory fetch resolves with: a Response-like
 * object the real driver parses (a string body is text/plain, anything else JSON).
 */
const fakeResponse = (status: number, body: any, url: string): any => {
  const text = typeof body == 'string' ? body : body === undefined ? '' : JSON.stringify(body);
  const type = typeof body == 'string' ? 'text/plain;charset=UTF-8' : 'application/json';
  const isType = (k: string) => /^content-type$/i.test(k);
  return {
    ok: status > 199 && status < 300, status, statusText: '', url, redirected: false, type: 'basic', bodyUsed: false,
    headers: typeof Headers == 'function' ? new Headers({'content-type': type}) : {get: (k: string) => isType(k) ? type : null, has: isType},
    text: async () => text,
    json: async () => JSON.parse(text),
    clone: () => fakeResponse(status, body, url),
  };
};
/** a request field compared by value (t.respond / t.fail targets) */
const same = (a: any, b: any): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a != 'object' || typeof b != 'object' || Array.isArray(a) != Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length == kb.length && ka.every(k => same(a[k], b[k]));
};
/**
 * PLAN-3 2-C: where makeSocketDriver (no baseUrl) opens a declared URL (its resolve(); keep the
 * two in step), and the transport identity it shares by (its key, without the share flag)
 */
const sockUrl = (u: string, sse: boolean) => {
  const loc = (globalThis as any).location;
  if (sse || /^wss?:/i.test(u) || !loc) return u;
  try {
    const r = new URL(u, loc.href);
    r.protocol = r.protocol == 'https:' ? 'wss:' : 'ws:';
    return r.href;
  } catch (_) { return u; }
};
const alive = (s: any) => s && s.readyState < 2;
const sockKey = (sse: boolean, url: string, arg: any) => (sse ? 'e' + !!(arg && arg.withCredentials) : 's' + JSON.stringify(arg)) + url;
/**
 * PLAN-3 2-C: the in-memory WebSocket / EventSource the fake's makeSocketDriver opens. The
 * harness drives it (t.open / t.push / t.drop); the driver's own close() is the app's close.
 */
const fakeSocketClass = (sse: boolean, made: (s: any) => void) => class {
  readyState = 0;
  sse = sse;
  byApp = false;
  k: string;
  url: string;
  ls: Record<string, any[]> = {};
  onopen: any; onmessage: any; onerror: any; onclose: any;
  constructor(url: string, arg?: any) {
    this.url = String(url);
    this.k = sockKey(sse, this.url, arg);
    made(this);
  }
  send() {}
  close() { if (this.readyState < 2) { this.readyState = 3; this.byApp = true; } }
  addEventListener(type: string, f: any) { (this.ls[type] = this.ls[type] || []).push(f); }
};
const brief = (v: any) => {
  let s: string;
  try { s = typeof v == 'string' ? `'${v}'` : JSON.stringify(v); } catch (_) { s = String(v); }
  return s && s.length > 80 ? s.slice(0, 80) + '…' : s;
};
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
/**
 * PLAN-3 5-4c: the in-memory window the router fake gives makeRouter's real driver: a location,
 * a history whose go() fires popstate a task later (like a browser), window listeners, scroll
 * kept in memory, and a document whose listeners are recorded in `docLs` (the mock DOM's link
 * clicks call them) and, with `real` (dom: 'real'), also added to the real document, so real
 * clicks bubble into the driver's link interception. `baseURI` is the in-memory URL, so relative
 * links resolve against it.
 */
function memoryWindow(start: string, real: boolean, query: (s: string) => any, observe: boolean) {
  const entries = [{url: start, state: null as any}];
  const on: Record<string, any[]> = {}, docLs: Record<string, any[]> = {};
  let i = 0;
  const at = () => new URL(entries[i].url);
  const fire = (type: string) => (on[type] || []).slice().forEach(f => f({type}));
  const D: any = real ? document : null;
  const w: any = {
    location: {
      get href() { return entries[i].url; }, get pathname() { return at().pathname; }, get search() { return at().search; },
      get hash() { return at().hash; }, get origin() { return at().origin; },
    },
    history: {
      get state() { return entries[i].state; }, get length() { return entries.length; },
      pushState(state: any, _: any, url: string) { entries.splice(i + 1); entries.push({url: new URL(url, entries[i].url).href, state}); i++; },
      replaceState(state: any, _: any, url?: string) { entries[i] = {url: url ? new URL(url, entries[i].url).href : entries[i].url, state}; },
      go(n: number) { const j = i + n; if (n && j >= 0 && j < entries.length) setTimeout(() => { i = j; fire('popstate'); }); },
      back() { this.go(-1); }, forward() { this.go(1); },
    },
    addEventListener(t: string, f: any) { (on[t] = on[t] || []).push(f); },
    removeEventListener(t: string, f: any) { on[t] = (on[t] || []).filter(x => x !== f); },
    document: {
      addEventListener(t: string, f: any) { (docLs[t] = docLs[t] || []).push(f); D?.addEventListener(t, f); },
      removeEventListener(t: string, f: any) { docLs[t] = (docLs[t] || []).filter(x => x !== f); D?.removeEventListener(t, f); },
      querySelector: (s: string) => (D ? query(s) : null),
      getElementById: (id: string) => (D ? D.getElementById(id) : null),
      get body() { return D?.body; },
      get baseURI() { return entries[i].url; },
    },
    scrollX: 0, scrollY: 0,
    scrollTo(x: any, y?: any) { if (typeof x == 'object') ({left: x = w.scrollX, top: y = w.scrollY} = x); w.scrollX = x; w.scrollY = y; },
    MutationObserver: real && observe ? (globalThis as any).MutationObserver : undefined,
  };
  return {w, docLs, index: () => i, size: () => entries.length};
}
/**
 * PLAN-3 5-4c: an element-like `<a>` for the router's click handler (mock DOM), from the vnode:
 * its attrs, its props (href, target, rel, download) and its dataset as data-* attributes
 */
const anchorOf = (v: any): any => {
  const d = v.data || {}, all: Record<string, any> = {...d.attrs};
  for (const k in d.props || {}) if (k != 'className') all[k] = d.props[k];
  for (const k in d.dataset || {}) all['data-' + k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())] = d.dataset[k];
  const get = (k: string) => all[k] == null || all[k] === false ? null : all[k] === true ? '' : String(all[k]);
  return {localName: 'a', getAttribute: get, hasAttribute: (k: string) => get(k) != null, getAttributeNS: () => null};
};
/**
 * PLAN-3 5-4c: the HEAD fake: the real driver's entry rules (one entry per component instance,
 * replaced by its next value, removed by a falsy value or its dispose), kept for t.head() to
 * merge with head.ts's mergeHead instead of written to a document
 */
const headFake = () => {
  const entries = new Map<any, any>();
  const {replies} = makeReplies(s => { entries.delete(s); });
  const driver = (sink$: Stream<any>) => {
    sink$.addListener({
      next: (v: any) => {
        if (!v || typeof v != 'object') return;
        const s = senderOf(v), h = 'head' in v ? v.head : v;
        h && typeof h == 'object' ? entries.set(s, h) : entries.delete(s);
      },
      error: () => {}, complete: () => {},
    });
    return {...replies, __sygnalStatic: 'head'};
  };
  return {entries, driver};
};
let savedConfig: ReturnType<typeof _getDiagnosticsConfig>;
let savedStrict: any;

/*
 * PLAN-4 GS-2, mock DOM: could the element a command targets have this method? The core runs any
 * method of the element; the mock DOM has no elements, so: the documented commands, common
 * methods of form fields and media, and (with a DOM) the prototype of the control's tag.
 */
const COMMON_METHODS = ['play', 'pause', 'load', 'fastSeek', 'showPicker', 'requestSubmit', 'reset', 'checkValidity', 'reportValidity', 'setCustomValidity', 'setSelectionRange', 'setRangeText', 'stepUp', 'stepDown', 'requestFullscreen', 'scroll', 'scrollTo', 'scrollBy', 'animate', 'requestPointerLock'];
const elementHas = (target: any, m: string, tag = typeof target == 'function' && typeof target.spec == 'string' ? target.spec : 'div'): boolean => {
  if (NATIVE_COMMAND_NAMES.includes(m) || COMMON_METHODS.includes(m)) return true;
  if (typeof document == 'undefined') return false;
  try {
    return typeof (document.createElement(tag) as any)[m] == 'function';
  } catch (_) {
    return false;
  }
};

/*
 * PLAN-4 GS-2: jsdom has no <dialog> methods, no popovers and no scrollIntoView. While a
 * `dom: 'real'` test runs, the missing ones are added (and removed after the last one): show() /
 * showModal() set `open`; close(returnValue) clears it, sets returnValue and fires `close`; the
 * popover methods fire `beforetoggle` / `toggle` (with oldState / newState); scrollIntoView()
 * does nothing (spy on it after renderComponent). A browser's own methods are never replaced.
 * PLAN-5 2-T (D211): also ResizeObserver (observes nothing), CSS.escape and
 * Element.prototype.scrollTo (does nothing), which Zag's machines use.
 */
let domFakes: (() => void) | undefined;
function fakeElementMethods(W: any): () => void {
  const added: Array<[any, string, any?]> = [];
  const add = (proto: any, name: string, fn: Function) => {
    if (proto && !(name in proto)) { proto[name] = fn; added.push([proto, name]); }
  };
  const D = W.HTMLDialogElement?.prototype, E = W.HTMLElement?.prototype;
  add(D, 'show', function (this: any) { this.open = true; });
  add(D, 'showModal', function (this: any) { this.open = true; });
  add(D, 'close', function (this: any, returnValue?: any) {
    if (!this.open) return;
    if (returnValue !== undefined) this.returnValue = String(returnValue);
    this.open = false;
    this.dispatchEvent(new W.Event('close'));
  });
  const shown = new WeakSet<any>();
  const toggle = (el: any, open: boolean) => {
    if (shown.has(el) == open) return;
    const ev = (type: string) => {
      const e = new W.Event(type, {cancelable: type == 'beforetoggle'});
      Object.defineProperties(e, {oldState: {value: open ? 'closed' : 'open'}, newState: {value: open ? 'open' : 'closed'}});
      return el.dispatchEvent(e);
    };
    if (!ev('beforetoggle') && open) return;
    open ? shown.add(el) : shown.delete(el);
    ev('toggle');
  };
  add(E, 'showPopover', function (this: any) { toggle(this, true); });
  add(E, 'hidePopover', function (this: any) { toggle(this, false); });
  add(E, 'togglePopover', function (this: any, options?: any) {
    const force = options && typeof options == 'object' ? options.force : options;
    toggle(this, force === undefined ? !shown.has(this) : !!force);
    return shown.has(this);
  });
  add(W.Element?.prototype, 'scrollIntoView', function () {});
  // PLAN-5 2-T (D211): what Zag's machines (sygnal/ui/menu, select, combobox; fromZag) need:
  // ResizeObserver (positioning), CSS.escape (selectors) and scrollTo (the highlighted option)
  add(W.Element?.prototype, 'scrollTo', function () {});
  const RO = class { observe() {} unobserve() {} disconnect() {} };
  // G-440: CSSOM's serialize-an-identifier (a leading digit, or '-' + digit, is hex-escaped)
  const esc = (v: any) => {
    const s = String(v);
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i), ch = s[i], hex = '\\' + c.toString(16) + ' ';
      out += !c ? '\uFFFD'
        : c < 32 || c == 127 || (c > 47 && c < 58 && (!i || i == 1 && s[0] == '-')) ? hex
        : !i && ch == '-' && s.length == 1 ? '\\-'
        : c > 127 || /[\w-]/.test(ch) ? ch
        : '\\' + ch;
    }
    return out;
  };
  // (a global the environment declares as undefined counts as missing)
  const set = (g: any, name: string, v: any) => {
    if (g[name]) return;
    // defined over it (Vitest's jsdom globals are accessors that would store into the window)
    const own = Object.getOwnPropertyDescriptor(g, name);
    if (own && !own.configurable) return;
    Object.defineProperty(g, name, {value: v, configurable: true, writable: true});
    added.push([g, name, own]);
  };
  for (const g of new Set([W, globalThis])) {
    set(g, 'ResizeObserver', RO);
    g.CSS ? set(g.CSS, 'escape', esc) : set(g, 'CSS', {escape: esc});
  }
  return () => added.forEach(([proto, name, own]) => { delete proto[name]; if (own) Object.defineProperty(proto, name, own); });
}

export function renderComponent(
  componentDef: any,
  options: RenderOptions = {}
): RenderResult {
  const {initialState, mockConfig = {}, drivers = {}, diagnostics, strict, dom = 'mock', autoConnect = true, socketSink = 'WS', resourceSink = 'HTTP', http: httpOptions, context: ancestors} = options;
  const {intent, model = {}} = componentDef;
  // E4: real DOM mode
  const real = dom == 'real';
  if (dom != 'mock' && !real) throw new Error(`[Sygnal] renderComponent: dom must be 'mock' (default) or 'real' (got ${String(dom)})`);
  if (real && (typeof document == 'undefined' || !document.body)) {
    throw new Error(`[Sygnal] renderComponent(C, { dom: 'real' }) needs a DOM, and there is no document here. Run the test in a DOM environment: add the comment // @vitest-environment jsdom at the top of the test file, or set test.environment: 'jsdom' (or 'happy-dom') in the Vitest config (npm i -D jsdom)`);
  }
  if (real && options.mockConfig) throw new Error(`[Sygnal] renderComponent: mockConfig drives the mock DOM, so it can't be used with { dom: 'real' }. Use simulateEvent instead`);
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
  // PLAN-3 5-4c: the router fake (makeRouter's real driver over an in-memory window) when the
  // app's router is passed and no driver is; the HEAD fake unless a HEAD driver is passed
  const {router, url, routerSink = 'ROUTER', headSink = 'HEAD', titleTemplate} = options;
  const compName = componentDef.name || componentDef.componentName || 'TestComponent';
  if (router !== undefined && !(router && typeof router == 'object' && router.options && typeof router.driver == 'function')) {
    throw new Error(`[Sygnal] renderComponent: the router option takes the object makeRouter() returns (import { router } from './routes.js'), not ${typeof router == 'function' ? 'router.driver' : 'a ' + typeof router}`);
  }
  const fakeRouter = !!router && !drivers[routerSink];
  if (!router && componentDef.route && !drivers[routerSink]) {
    throw new Error(`[Sygnal] renderComponent(${compName}, { router }): ${compName} declares \`route\`, so the test needs the app's router: the object makeRouter() returns (import { router } from './routes.js'). renderComponent then runs its real driver over an in-memory history starting at the url option (default '/'). Or pass a ${routerSink} driver in drivers`);
  }
  if (url !== undefined && !fakeRouter) throw new Error(`[Sygnal] renderComponent: url is the router fake's start URL: pass the app's router too (renderComponent(${compName}, { router, url }))`);

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
  // PLAN-4 GS-2: element commands run on the real DOM (jsdom gets the missing methods), and their
  // SYG640/SYG641 are reported without the dev entry too
  if (real && !domFakes) domFakes = fakeElementMethods(document.defaultView || globalThis);
  const ownBridge = !core.elementCommand;
  if (ownBridge) core.elementCommand = reportElementCommand;
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
  // 4-A1 (real DOM): states recorded when a view in the tree last ran (see onModel)
  let viewTag = 0;
  const recorded = () => states.length;
  // G-053: model next() calls of the tree's components (for the timeout explanations)
  type Scheduled = {type: string; delay: number; at: number; due: number; by: string};
  const scheduled: Scheduled[] = [];
  // 2-C: component number (a request's sender) → name, for t.connections (a tagged copy of a
  // value keeps the sender, not the name)
  const senderNames = new Map<any, string>();
  // PLAN-4 2-C (GS-10): t.actions, from the action log (./diagnostics/checks/actionLog), which
  // patches each instance of this tree from the onIntent / onModel hooks (0 B in apps)
  const t0 = clockNow();
  const actionList: TestAction[] = [];
  const entryOf = new WeakMap<ActionRecord, TestAction>();
  const stateReducer = new WeakMap<TestAction, Function>();
  const resulting = new WeakMap<TestAction, {s: any}>();
  let awaiting: TestAction[] = [];
  const actionListener: ActionListener = {
    action(r) {
      const e: TestAction = {type: r.type, data: r.data, component: r.component, instance: r.instance, sinks: r.sinks, cause: r.cause, at: r.time - t0};
      entryOf.set(r, e);
      actionList.push(e);
    },
    sink(r, sink, reducer) {
      const e = entryOf.get(r);
      if (!e || sink != 'STATE') return;
      if (typeof reducer == 'function') stateReducer.set(e, reducer);
      awaiting.push(e);
    },
  };
  // PLAN-4 GS-2: t.commands('ELEMENT'). The core runs an instance's ELEMENT sink itself (after
  // initModel$, which ends with onModel): recorded here; on the mock DOM not run, but checked
  // (SYG641 when sent, SYG640 when the target is still missing from its view after 1 s)
  const commandLog: any[] = [];
  const commandTimers = new Set<any>();
  // PLAN-5 W-1 (F-c): the widget whose host a target matches among the sender's own elements
  // (1-R G-369: scoped as probe() is; its commands run for a selector target too, D196); an
  // undeclared one is SYG142, as on the real DOM
  const widgetOf = (target: any, c: any, k = 'ww'): any => {
    if (typeof target == 'function' && !target.__sygnalControl) return;
    const sel = tryParse(norm(String(selOf(target) ?? '')));
    const scope = scopeOf(c) || undefined;
    const ch = sel && vtree && findAll(vtree, sel, [], []).find(ch => {
      let s: any;
      for (const v of ch) s = scopeOfV(v) || s;
      return s == scope;
    });
    return ch && ch[ch.length - 1]?.data?.[k];
  };
  const findVc = (target: any, c: any) => widgetOf(target, c, 'vc');
  const checkCommand = (c: any, cmd: any) => {
    if (typeof cmd != 'object' || Array.isArray(cmd)) return;
    const m = Object.keys(cmd)[0], target = cmd[m];
    if (m === undefined) return;
    const w = target?.spec?.commands ? undefined : widgetOf(target, c);
    // PLAN-5 V-1: scrollToIndex / scrollToId are methods of a VirtualCollection's container
    const vc = m.startsWith('scrollTo') && findVc(target, c)?.commands[m];
    // G-369: a control wrapping a widget has its widget's host tag
    if (!vc && (w ? !w.commands[m] && !elementHas(0, m, w.def.tag || 'div') : !target?.spec?.commands?.[m] && !elementHas(target, m, target?.spec?.def?.tag))) {
      return reportElementCommand(c, cmd, w ? {tagName: w.def.tag || 'div', __sw: {w}} : {});
    }
    // D194: focusWithin(selector) looks under the sender's root, children included
    const within = target?.within, sel = within ?? (target == null ? '' : String(target));
    const id = setTimeout(() => {
      commandTimers.delete(id);
      if (disposed || (sel && !tryParse(sel))) return;
      const p = sel && vtree && probe(sel, scopeOf(c) || undefined);
      if (!p || !(p.own || (within != null && p.child))) reportElementCommand(c, cmd);
    }, 1e3);
    commandTimers.add(id);
  };
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
      const sc = scopeOfV(v) || cur;
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
    // E4: on the real DOM, 'sygnal/diagnostics' runs its own (real-DOM) SYG104 check
    if (real && core.__uninstallChecks) return;
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
      // CT-1: a control is named by its identifier
      const control = /^\[data-control="([^"]+)"\]$/.exec(selector)?.[1];
      raise('SYG104', name,
        `${control ? `The control ${control}` : `DOM.select('${selector}')`} in ${name} matches elements inside ${childName} (isolated), so ${name} never receives their events`,
        `Handle the event in ${childName}${control ? ` (DOM.<event>(${control}) in its intent)` : ''} and send it up with PARENT (read it here with CHILD.select(${childName})), or use EVENTS`,
        control ? {selector, child: childName, control} : {selector, child: childName});
    });
  };

  const restore = () => {
    offDiag();
    if (ownBridge && core.elementCommand === reportElementCommand) core.elementCommand = undefined;
    if (!--active) {
      configureDiagnostics(savedConfig);
      core.strict = savedStrict;
      domFakes?.();
      domFakes = undefined;
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
  const hub = port();

  // E2: scriptable fake sources (t.respond / t.fail) for sinks/sources with no driver. Same
  // source API as makeFetchDriver / driverFromAsync: select(category?) and errors(category?),
  // where the selector is a category string, a predicate, or nothing (everything).
  // R4-2: isolated like the drivers: a source at scope path `ns` sees the replies to requests
  // made at or under it; requests are tagged by isolateSink (or, for a child-only sink with no
  // driver, with the component's place in the tree, see nsOf)
  // PLAN-3 5-1 (H-9): the HTTP half IS makeFetchDriver, run over an in-memory fetch. Every
  // fetch is a pending entry until t.respond / t.fail resolve it with a Response-like object (or
  // reject it); the driver aborts superseded / cancelled / disposed requests through their
  // AbortSignal, which takes them off the pending list. So latest, abort, timeouts, isolation,
  // reply actions (each to exactly its sender) and resources are the driver's own rules, with no
  // copy here. `subs` mirrors each select()/errors() subscription, for `request: null` pushes and
  // for the "nothing receives it" check on plain replies.
  type FakeSub = {l: any; sel: any; err: boolean; ns: any[]};
  // value: what t.requests lists (normalised); req: the request the driver got; res: the resource;
  // pf: a { prefetch } fetch (5-5: answered into the cache, no reply)
  type Pending = {value: any; req: any; category: any; res?: string; pf?: any; live: boolean; settle: (ok: boolean, v: any) => void};
  type Fake = {select: any; errors: any; subs: Set<FakeSub>; at: (ns: any[]) => any; pending: Pending[]; in$: any; http: any; ws: Sock};
  const fakes = new Map<string, Fake>();
  // 5-3: the fake drivers' focus / online listeners (t.focus, t.online)
  const signals = new Set<(s: string) => void>();
  // the value record() is sending (as listed in t.requests), and what the driver's _tap named
  let sending: any, tapped: any[] | undefined;
  const fake = (name: string): Fake => {
    let f = fakes.get(name);
    if (!f) {
      const subs = new Set<FakeSub>();
      const pending: Pending[] = [];
      const in$ = xs.create();
      const ws = sockFake();
      const http = makeFetchDriver({
        ...httpOptions,
        // 5-3: focus / online come from t.focus() / t.online() only
        _on: (f: any) => { signals.add(f); return () => signals.delete(f); },
        _tap: (req: any, res?: string, pf?: any) => { tapped = [req, res, pf]; },
        fetch: (url: string, init: any) => new Promise((resolve, reject) => {
          const [req, res, pf] = tapped || [{url}];
          tapped = undefined;
          // G-171(1): a resource fetch is listed as { url, ...request, resource: name }; 5-5: a
          // { prefetch } fetch as { url, ...request, prefetch: true }
          const value = res !== undefined ? {...req, resource: res} : pf ? {...req, prefetch: true} : sending !== undefined ? sending : req;
          if (res !== undefined || pf) requests(name).push(value);
          const p: Pending = {value, req, category: req.category, res, pf, live: true, settle: (ok, v) => { p.live = false; (ok ? resolve : reject)(v); }};
          pending.push(p);
          init?.signal?.addEventListener?.('abort', () => {
            if (!p.live) return;
            p.live = false;
            const e: any = new Error('The operation was aborted.');
            e.name = 'AbortError';
            reject(e);
          });
        }),
      })(in$);
      const at = (ns: any[]): any => {
        const own = (err: boolean) => (sel?: any) => {
          let sub: FakeSub;
          return xs.create({
            start: (l: any) => { subs.add((sub = {l, sel, err, ns})); },
            stop: () => { subs.delete(sub); },
          });
        };
        const hs = ns.reduce((s, sc) => s.isolateSource(s, sc), http);
        // 2-C: the socket driver's source, isolated alike (events without an action reach select(name?))
        const sock = ns.reduce((s, sc) => s.isolateSource(s, sc), ws.src);
        return {
          select: (sel?: any) => xs.merge(hs.select(sel), own(false)(sel), sock.select(sel)),
          errors: (sel?: any) => xs.merge(hs.errors(sel), own(true)(sel)),
          subs, at, pending, in$, http, ws,
          // 5-3: the driver's matcher / inspection (the dev checks' SYG632, t.cache)
          __matches: http.__matches, __inspect: http.__inspect,
          isolateSource: (_: any, scope: any) => at(ns.concat(scope)),
          isolateSink: (sink$: any, scope: any) => sink$.map((v: any) => tag(v, scope)),
          // G-160: the fake named by `socketSink` receives the components' connections static
          // 3-A: and the one named by `resourceSink` the resources static
          ...(name == socketSink ? {__sygnalStatic: 'connections'} : name == resourceSink ? {__sygnalStatic: 'resources'} : {}),
          __sygnalReplies: true,
          // both drivers' reply actions; a disposed sender's connections leave t.connections
          replies: (sender: any) => xs.merge(http.replies(sender), ws.src.replies(sender),
            xs.create({start: noop, stop: () => { ws.conns.delete(sender); }})),
        };
      };
      fakes.set(name, (f = at([])));
    }
    return f!;
  };
  // PLAN-3 2-C: the socket half of a fake source. Values with `connections` / `to` go to a real
  // makeSocketDriver over in-memory sockets, so diffing, reply actions, sharing, queueing and
  // reconnect are the driver's own. `conns` mirrors what each sender has declared (sender →
  // name → Conn) and which fake socket serves each connection, for t.connections and targets.
  type Conn = {by: string; name: string; spec: any; sse: boolean; url: string; k: string; own: boolean; s?: any};
  type Sock = {src: any; in$: any; conns: Map<any, Map<string, Conn>>; sockets: any[]; sent: any[]; declaring: Conn[] | null};
  const sockFake = (): Sock => {
    const w: Sock = {src: null, in$: xs.create(), conns: new Map(), sockets: [], sent: [], declaring: null};
    const made = (s: any) => {
      w.sockets.push(s);
      const all = [...w.conns.values()].flatMap(m => [...m.values()]).filter(c => c.k == s.k);
      if (w.declaring) {
        // a declaration opened it: the first new connection with its key (and, shared, the
        // other new shared ones)
        const first = w.declaring.find(c => c.k == s.k && !c.s);
        if (first) [first, ...(first.own ? [] : w.declaring.filter(c => c.k == s.k && !c.s && !c.own))].forEach(c => { c.s = s; });
      } else {
        // a reconnect: replaces the oldest dropped socket with its key
        const old = all.map(c => c.s).filter(x => x && !alive(x)).sort((a, b) => w.sockets.indexOf(a) - w.sockets.indexOf(b))[0];
        all.forEach(c => { if (c.s === old) c.s = s; });
      }
      // autoConnect: it opens on the next macrotask (or at once when a t.push / t.drop needs it)
      if (autoConnect) {
        s.auto = true;
        setTimeout(() => { if (s.readyState === 0 && !disposed) sockOpen(s); });
      }
    };
    w.src = makeSocketDriver({WebSocket: fakeSocketClass(false, made), EventSource: fakeSocketClass(true, made)})(w.in$);
    return w;
  };
  const sockValue = (v: any) => !!v && typeof v == 'object' && ('connections' in v || 'to' in v);
  const sockRecord = (w: Sock, v: any) => {
    if ('to' in v && !('connections' in v)) w.sent.push(v);
    else if (!('then' in v || 'catch' in v)) {
      const sender = senderOf(v), next = v.connections || {}, old = w.conns.get(sender) || new Map(), now = new Map<string, Conn>();
      const fresh: Conn[] = [];
      Object.keys(next).forEach(name => {
        const spec = next[name];
        if (!spec || typeof spec != 'object' || (typeof spec.socket != 'string' && typeof spec.sse != 'string') || 'then' in spec || 'catch' in spec) return;
        const sse = typeof spec.sse == 'string', url = sockUrl(sse ? spec.sse : spec.socket, sse);
        const k = sockKey(sse, url, sse ? spec : spec.protocols), own = spec.share === false;
        const c = old.get(name);
        if (c && c.k == k && c.own == own) { c.spec = spec; now.set(name, c); }
        else { const n: Conn = {by: v.__emitterName ?? senderNames.get(sender), name, spec, sse, url, k, own}; now.set(name, n); fresh.push(n); }
      });
      w.conns.set(sender, now);
      w.declaring = fresh;
      try { w.in$.shamefullySendNext(v); } finally { w.declaring = null; }
      // joined a shared socket that was already there
      fresh.forEach(c => { if (!c.s && !c.own) c.s = w.sockets.filter(s => s.k == c.k && alive(s)).pop(); });
      return;
    }
    w.in$.shamefullySendNext(v);
  };
  const sockFire = (s: any, type: string, ev: any) => {
    try { s['on' + type]?.(ev); } catch (e) { console.error(e); }
  };
  const sockOpen = (s: any) => { s.readyState = 1; sockFire(s, 'open', {type: 'open'}); };
  const sockState = (c: Conn) => !c.s || c.s.readyState == 0 ? 'connecting' : c.s.readyState == 1 ? 'open' : 'closed';
  const sockView = (c: Conn): FakeConnection => ({...c.spec, name: c.name, url: c.url, state: sockState(c), sender: c.by});
  // G-131: a string request is scope-tagged as { url } (like makeFetchDriver's isolateSink),
  // remembering the string, so t.requests still shows what the component sent
  const STR = '__sygnalString';
  const tag = (v: any, scope: any) => {
    // (G-335: a request is a string or a plain object; an array, a Date, ... is sent as is)
    if (typeof v != 'string' && !(v && typeof v == 'object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null))) return v;
    const r = tagRequest(v, scope), str = typeof v == 'string' ? v : v[STR];
    if (str !== undefined) Object.defineProperty(r, STR, {value: str});
    return r;
  };
  const requests = (k: string) => (reqValues[k] = reqValues[k] || []);
  const reqValues: Record<string, any[]> = {};
  // a sink value: recorded (t.sinkValues: everything) and, on a fake source, sent to its driver.
  // G-141 / G-171(1): t.requests lists the requests, normalised (a string is { url }); never the
  // { abort } commands, { resources } declarations or { refresh } commands. A resource's fetches
  // are listed by the fake's fetch, with `resource: name`.
  // 5-7: resource names declared on each sink, so t.respond(name, …, 'quote') right after the
  // state change that (re)fetches 'quote' waits for that fetch instead of throwing
  const declaredRes = new Map<string, Set<string>>();
  // states.length when the last simulate* call was made: no state since then = its change is pending
  let simAt = -1;
  // G-189: true from a simulate* call until the requests it causes have left: a sink that also
  // carries `resources` sends them two microtasks after the action (G-158)
  let sendDue = false, dueSeq = 0;
  const record = (name: string, v: any, track: boolean) => {
    const shown = v && typeof v == 'object' && v[STR] !== undefined ? v[STR] : v;
    if (v && typeof v == 'object' && v.resources && typeof v.resources == 'object') {
      const set = declaredRes.get(name) || new Set<string>();
      Object.keys(v.resources).forEach(k => set.add(k));
      declaredRes.set(name, set);
    }
    sinkValues(name).push(shown);
    const obj = !!v && typeof v == 'object';
    const listed = !(obj && (v.abort || v.resources || v.refresh || 'invalidate' in v || 'prefetch' in v));
    const value = typeof shown == 'string' ? {url: shown} : shown;
    if (listed) requests(name).push(value);
    if (!track) return;
    // 2-C: a socket value goes to the fake's socket driver (it reports SYG610/SYG611 itself)
    if (obj && sockValue(v)) return sockRecord(fake(name).ws, v);
    const f = fake(name);
    sending = listed ? value : undefined;
    try { f.in$.shamefullySendNext(v); } finally { sending = tapped = undefined; }
  };
  const names = Object.keys(model).filter(n => n != 'INITIALIZE');
  // GS-1: a behavior's actions ('pager.NEXT') can be simulated too; behaviors.ts merges these
  // marked streams (__sygnalTestActions) with the behavior's own trigger
  const uses = componentDef.uses || {};
  for (const k in uses) for (const a in uses[k]?.model || {}) names.push(k + '.' + a);
  // G-275: the caller's initialState is owned (the dev statics freeze leaves it alone). G-289: a
  // copy is marked, not the caller's object
  const init = initialState !== undefined ? ownedCopy(initialState) : componentDef.initialState;
  // G-028: with no intent, model or initialState nothing would ever emit state, so the view
  // never renders. Leave intent/model unset so the component falls back to the same no-op
  // model run() uses, and renders.
  // (behavior actions count: a host with only `uses` still gets the simulateAction streams)
  const bare = !intent && !Object.keys(model).length && !names.length && init === undefined;
  let started = false;
  const onEvents = (path: string[], type: string, on?: boolean) => {
    const k = path.join('\u0000');
    if (on === undefined) {
      if (!listeners.has(k)) listeners.set(k, path), newListener = true;
      (evTypes[k] = evTypes[k] || []).push(type);
    } else {
      // G-039: subscribed / unsubscribed listeners (a just-mounted child subscribes late)
      const lk = k + '\u0000' + type;
      live.set(lk, (live.get(lk) || 0) + (on ? 1 : -1));
      // (the core subscribes the intent while starting, before retry exists: a microtask
      // later; G-299: not at all when the start threw)
      if (on) started ? retry(0) : queueMicrotask(() => { if (started) retry(0); });
    }
  };
  // E4: the real DOM driver (as run() sets it up) patching into a fresh container
  let container: Element | null = null;
  let realDOM: any;
  if (real) {
    container = document.createElement('div');
    // a class, not an attribute: the DOM driver's first patch keeps only the root's id and class
    container.className = 'sygnal-test';
    document.body.appendChild(container);
    realDOM = makeDOMDriver(container, {snabbdomOptions: {experimental: {fragments: true}}} as any);
  }
  // 4-A1: real-mode patch tracking. Every vtree the DOM sink emits is tagged with the number
  // of states recorded when it rendered (renderNo); the driver's input is gated so the harness
  // knows which render is in the DOM (patchedUpTo, lastPatched) and can hold a newer one back
  // while a wait resolves (holds: the state index a wait resolved at; a vtree rendered after a
  // newer state waits in `held` until the waiting code has run, i.e. the next macrotask).
  const renderNo = new WeakMap<object, number>();
  let patchedUpTo = 0, lastPatched: any, held: any, gateOut: any;
  const holds: number[] = [];
  const tagOf = (v: any) => renderNo.get(v) ?? states.length;
  // G-348: each emitted tree is tagged when it arrives, in both listeners (the gate runs first:
  // the driver subscribes before the harness). A view that runs again with the same output
  // re-emits its last vnode (P46-P), so the tag left from the earlier emission would read as a
  // stale render and hold every input until the next real render
  const tagTree = (v: any) => { if (v && typeof v == 'object') renderNo.set(v, viewTag || states.length); };
  const holdLimit = () => (holds.length ? Math.min(...holds) + 1 : Infinity);
  const toDOM = (v: any) => {
    // the driver patches synchronously when the document is ready; snabbdom sets vnode.elm
    gateOut?.next(v);
    if (v?.elm) patchedUpTo = Math.max(patchedUpTo, tagOf(v)), lastPatched = v;
  };
  const gated = (vnode$: any) => {
    let l: any;
    return xs.create({
      start(out: any) {
        gateOut = out;
        vnode$.addListener(l = {
          next: (v: any) => {
            tagTree(v);
            // (a state replaced before it ever rendered isn't waited for: the newer render goes in)
            if (tagOf(v) > holdLimit() && patchedUpTo >= holdLimit()) held = v;
            else { held = undefined; toDOM(v); }
          },
          error: (e: any) => out.error(e),
          complete: () => out.complete(),
        });
      },
      stop() { vnode$.removeListener(l); gateOut = undefined; },
    });
  };
  const release = (h: number) => {
    const k = holds.indexOf(h);
    if (k < 0) return;
    holds.splice(k, 1);
    if (held && !disposed && tagOf(held) <= holdLimit()) {
      const v = held;
      held = undefined;
      toDOM(v);
      bump();
    }
  };
  // PLAN-3 5-4c: the router fake: the app router's options with an in-memory window (scroll and
  // focus off unless asked for, no Vike navigate), commands the app sent (t.sent), and t.*'s own
  // commands merged into the driver's input (no sender: they go through `block` like a click)
  type RouterFake = {mem: ReturnType<typeof memoryWindow>; r: any; cmd$: any; sent: any[]};
  let rt: RouterFake | undefined;
  if (fakeRouter) {
    const loc = (globalThis as any).location;
    const origin = loc && /^https?:$/.test(loc.protocol) ? loc.origin : 'http://localhost';
    const mem = memoryWindow(new URL(url ?? '/', origin + '/').href, real, (s: string) => queryIn(s), !!(options.routerScroll || options.routerFocus));
    const o = router.options;
    const r = makeRouter({...o, navigate: undefined, location: undefined, history: undefined, document: undefined, window: mem.w,
      scroll: !!options.routerScroll, focus: options.routerFocus ? (typeof options.routerFocus == 'string' ? options.routerFocus : o.focus) : false});
    rt = {mem, r, cmd$: xs.create(), sent: []};
  }
  const routerDriver = (sink$: any) => {
    const f = rt!;
    const app$ = sink$.map((v: any) => {
      // the `{ route }` declarations are the core's, not commands
      if (v && typeof v == 'object' && !('route' in v && Object.keys(v).length == 1)) f.sent.push(v);
      return v;
    });
    return f.r.driver(xs.merge(app$, f.cmd$));
  };
  const hd = drivers[headSink] ? undefined : headFake();
  // PLAN-4 GS-7: the timer fake (the real makeTimerDriver() over a runner map t.timers() reads),
  // unless a driver is passed under timerSink; the test's timers (fake ones too) drive it
  const {timerSink = 'TIMER'} = options;
  const tm = drivers[timerSink] ? undefined : new Map<any, any>();
  // PLAN-5 B-3: the browser fake (the real browser driver over fake sources, browserFake), unless
  // a driver is passed under browserSink; t.browser.* drives it
  const {browserSink = 'BROWSER'} = options;
  const bw = drivers[browserSink] ? undefined : browserFake(options.browser, real);
  // PLAN-4 GS-5: the fake storage a root's persist() uses (the __storage source; see persist.ts)
  const store = options.storage || {}, ps = componentDef.persist && {local: fakeStorage(store), session: fakeStorage(store), f: new Set<() => void>()};
  const allDrivers: any = {
    DOM: real
      ? (vnode$: any, name: string) => trackSource(realDOM(gated(vnode$), name), [], hub.$, onEvents)
      : () => mockDOMSource(mockConfig, hub.$, onEvents),
    EVENTS: eventBusDriver,
    LOG: logDriver,
    ...(hd && {[headSink]: hd.driver}),
    // (it stands down when a timer driver is passed under another key: one runs the timers)
    ...(tm && {[timerSink]: (s$: any) => timerDriver(tm)(s$.filter(() => !Object.keys(sources || {}).some(k => k != timerSink && sources[k]?.__sygnalStatic == 'timers')))}),
    ...(bw && {[browserSink]: (s$: any, n: string) => browserDriver([bw.src], bw.runners)(s$.filter(() => !Object.keys(sources || {}).some(k => k != browserSink && sources[k]?.__sygnalStatic == 'browser')), n)}),
    ...(rt && {[routerSink]: routerDriver}),
    ...drivers,
    ...(options.onError && {__e: () => options.onError}),
    ...(ps && {__storage: () => ps}),
  };
  const faked = new Set<string>();
  for (const k in model) {
    const e = model[k];
    for (const n of e && typeof e == 'object' ? Object.keys(e) : []) {
      if (!allDrivers[n] && !/^(STATE|EFFECT|PARENT|READY|ELEMENT|PERSIST)$/.test(n)) {
        allDrivers[n] = () => fake(n);
        faked.add(n);
      }
    }
  }
  // G-160, 3-A: the connections / resources statics of any component in the tree get their
  // fakes. The core reads its drivers once, at start, so the two fakes are drivers from the
  // start (unused otherwise)
  for (const n of [socketSink, resourceSink]) {
    if (!allDrivers[n]) { allDrivers[n] = () => fake(n); faked.add(n); }
  }
  // PLAN-4.6 R4: the harness's bookkeeping is a layer of the app's hooks (04 §3.4), recorded
  // from InstanceViews. `api`: the runtime API (simulateAction dispatches through it)
  let api: any;
  const testActions: string[] = [];
  const isRes = (n: string) => RESERVED_SINKS.test(n) || n == 'PERSIST';
  // a component's place in the tree below the root (the child-only fakes' scope path, R4-2)
  const nsCache = new Map<number, any[]>();
  const nsOfView = (iv: any): any[] => {
    if (iv.isRoot) return [];
    let ns = nsCache.get(iv.id);
    if (!ns) {
      const p = api?.get(iv.parentId);
      nsCache.set(iv.id, ns = (p ? nsOfView(p) : []).concat(iv.id));
    }
    return ns;
  };
  const viewScope = (iv: any) => {
    const d = iv.sources.DOM;
    return d && d._hub === hub.$ && (d._path || []).filter(isScope).pop();
  };
  // the child-only sinks of an instance (no driver: its sends are recorded and answered by the fake)
  const childSinks2 = (iv: any) => [...iv.def.sinks].filter((n: string) => !(n in allDrivers) && !isRes(n));
  const replySubs = new Map<any, Array<[any, any]>>();
  const nextHooks = () => {
    const log = actionHooks(actionListener);
    return {
      ...log,
      onCreate(iv: any) {
        log.onCreate(iv);
        bump();
        // (every instance, with or without an intent: SYG104 names the child, inspect() its id)
        const sc = viewScope(iv);
        if (sc) owners.set(sc, iv.name);
        if (iv.sources.DOM?._hub == hub.$) scopeIds.set(sc || '', iv.id);
        senderNames.set(iv.id, iv.name);
        if (iv.def.view?.route && !(routerSink in allDrivers)) failWith(new Error(`[Sygnal] ${iv.name} declares \`route\`, and nothing answers it: pass the app's router, renderComponent(${compName}, { router }) (the object makeRouter() returns), or a ${routerSink} driver in drivers`));
        // the replies to its child-only requests (as the core subscribes a driver's replies).
        // G-324: here, for every instance: wrapSources runs only for an instance with an intent
        const extra = childSinks2(iv);
        if (extra.length) {
          const subs: Array<[any, any]> = [];
          for (const n of extra) {
            const r$ = fake(n).at(nsOfView(iv)).replies(iv.id), l = {next: (a: any) => a && api?.dispatch(iv.id, a.type, a.data, 'reply'), error: noop, complete: noop};
            r$.addListener(l);
            subs.push([r$, l]);
          }
          replySubs.set(iv.id, subs);
        }
      },
      wrapSources(iv: any, so: any) {
        const extra = childSinks2(iv);
        if (typeof Proxy != 'function') return;
        // E2 / G-151: a source no driver provides (driver-like name, or one of its sinks) is the
        // scriptable fake, scoped to the component (R4-2)
        let ns: any[] | undefined;
        return new Proxy(so, {
          get: (t: any, k: any) => typeof k == 'string' && !(k in t) && (DRIVER_NAME.test(k) || extra.includes(k)) ? fake(k).at(ns ||= nsOfView(iv)) : t[k],
          has: (t: any, k: any) => k in t || (typeof k == 'string' && extra.includes(k)),
        });
      },
      onRender() { bump(); if (real) viewTag = recorded(); },
      onReducer() { bump(); },
      onNext(iv: any, type: string, _d: any, ms: number) {
        const at = clockNow();
        if (scheduled.length > 50) scheduled.splice(0, scheduled.length - 50);
        scheduled.push({type, delay: ms, at, due: at + ms, by: iv.name});
      },
      // G-064 / G-151: a value on a sink no driver takes: recorded (t.sinkValues, t.requests) and
      // sent to the fake, stamped with its sender and tagged with its place in the tree
      onSink(iv: any, type: any, sink: string, v: any) {
        bump();
        if (type === null || sink in allDrivers || isRes(sink)) return;
        // G-335: only a plain object is copied and stamped (an array or a Date keeps its type)
        if (v && typeof v == 'object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)) v = Object.defineProperties({...v}, {__emitterId: {value: iv.id, configurable: true}, __emitterName: {value: iv.name, configurable: true}});
        record(sink, nsOfView(iv).reduceRight(tag, v), true);
      },
      onDispose(iv: any) {
        nsCache.delete(iv.id);
        const subs = replySubs.get(iv.id);
        if (subs) { replySubs.delete(iv.id); subs.forEach(([s, l]) => { try { s.removeListener(l); } catch (_) {} }); }
        const sc = viewScope(iv);
        if (!sc) return;
        owners.delete(sc);
        scopeIds.delete(sc);
        listeners.forEach((path, k) => { if (path.filter(isScope).pop() == sc) listeners.delete(k); });
      },
      // t.commands('ELEMENT') records the commands sent and checks them as recordCommands does
      // (SYG641 when sent, unless the dev entry does; mock DOM: SYG640/641 by the view); the
      // mock DOM doesn't run them (false)
      onElementCommand(iv: any, v: any) {
        bump();
        const c = {get name() { return iv.name; }, get _disposed() { return iv.disposed; }, get sources() { return iv.sources; }, DOMSourceName: 'DOM'};
        for (const cmd of ([] as any[]).concat(v)) if (cmd) {
          commandLog.push(cmd);
          if (!core.__uninstallChecks) checkSentCommand(c, cmd);
          if (!real) checkCommand(c, cmd);
        }
        return real ? undefined : false;
      },
    };
  };
  let sources: any, sinks: any;
  try {
    // the root runs with the test intent, model, initial state and name, and the drivers above.
    // G-325: without an intent, every model action is simulate-only (no false SYG102)
    if (!intent) testActions.push(...names);
    const p = startNext(componentDef, allDrivers, {
      useDefaultDrivers: false, onError: options.onError,
      __hooks: nextHooks(),
      // simulateAction dispatches through the runtime (cause 'simulateAction'), so the root runs
      // its own intent; testActions: the model actions it doesn't name (wiring, inspect())
      __override: {intent: intent ? (s: any) => { const r = intent(s); if (r && typeof r == 'object') testActions.push(...names.filter(n => !(n in r))); return r; } : undefined,
        model: bare ? undefined : model, initialState: init, name: compName, testActions,
        // D214: the ancestors' context as constant entries under the component's own
        ...(ancestors && {context: {...Object.fromEntries(Object.keys(ancestors).map((k) => [k, () => ancestors[k]])), ...componentDef.context}})},
    });
    ({sources, sinks} = p);
    api = p.api;
  } catch (e) {
    restore();
    container?.remove();
    throw e;
  }

  started = true;
  const subs: Array<[any, any]> = [];
  const listen = (s: any, next: (v: any) => void) => {
    const l = {next, error: noop, complete: noop};
    s.addListener(l);
    subs.push([s, l]);
  };

  const states: any[] = [];
  let syncAt: number | undefined;
  const stateStream: Stream<any> = sources.STATE?.stream || xs.never();
  listen(stateStream, s => {
    states.push(s);
    // PLAN-4.6 R4 (D176): a reducer runs synchronously, so a state caused by input
    // the harness didn't deliver (a real element's click(), a driver answering at once) can be
    // recorded before the test's next() call in the same tick: a next() called in that tick
    // starts at the first such state (internal; a later tick starts after the call, as documented)
    if (syncAt === undefined) { syncAt = states.length - 1; queueMicrotask(() => { syncAt = undefined; }); }
    // 2-C: the actions whose STATE reducer ran since the last state produced this one
    for (const e of awaiting) resulting.set(e, {s});
    awaiting = [];
    bump();
  });

  const values: Record<string, any[]> = {};
  const sinkValues = (k: string) => (values[k] = values[k] || []);
  for (const k in sinks) {
    if (k != 'DOM' && k != 'STATE' && typeof sinks[k]?.addListener == 'function') {
      listen(sinks[k], v => record(k, k == 'EVENTS' ? {type: v.type, data: v.data} : k == 'PARENT' ? v.value : v, faked.has(k)));
    }
  }
  // Input queue (G-049/G-039): simulateAction/simulateEvent calls are delivered in order,
  // once the component is ready. An event whose selector matches no rendered element yet, or
  // whose matching listeners aren't subscribed yet, holds the queue until it can be delivered
  // (re-tried on every render), at most eventWaitMs; then it is delivered to the live listeners
  // (or, with no matching element, fails the test, G-070; with allowMissing it is dropped
  // with SYG103).
  type Input = {go: (last: boolean) => boolean, until?: number, wait?: number, at?: number, missing?: () => Error | undefined};
  const inputs: Input[] = [];
  let isReady = false, retryTimer: any;
  const pump = () => {
    if (!isReady || disposed) return;
    while (inputs.length) {
      const head = inputs[0];
      // E4: on the real DOM an input acts on the patched DOM, like a user: it waits until the
      // tree has been quiet for QUIET_MS (at most 100ms), so e.g. a button enabled by the
      // previous input is enabled when it is clicked
      const idle = clockNow() - lastActivity;
      if (real) {
        const waited = clockNow() - (head.at = head.at || clockNow());
        if (idle < QUIET_MS && waited < 100) return retry(QUIET_MS - idle);
        // 4-A1: and every recorded state's render is in the DOM (under load a render can lag the
        // quiet window), at most eventWaitMs; not while a render is held for a resolving wait
        const behind = !!vtree && (lastPatched !== vtree || patchedUpTo < states.length);
        if ((behind && waited < eventWaitMs) || held) return retry(1);
      }
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
  let fromInput = false;
  let readyAt = 0, cursor: number | undefined, shown: number | undefined, arming = 0, cursorUsed = false;
  // G-346: one expiry timer at a time, cleared once a next() uses the cursor (no timer is left
  // pending after `await t.next()`, e.g. vi.getTimerCount() under fake timers)
  let expiry: any = 0;
  const unexpire = () => { if (expiry) { clearTimeout(expiry); expiry = 0; } };
  const expire = (id: number) => {
    unexpire();
    expiry = setTimeout(() => { expiry = 0; if (id == arming && !cursorUsed) cursor = undefined; });
  };
  const readyPromise = new Promise<void>(r => {
    markReady = () => {
      // G-346: the fallback (no first render) has nothing left to do
      clearTimeout(fallback);
      readyAt = states.length;
      isReady = true;
      pump();
      r();
    };
  });
  const ready = () => {
    // (D176: a state of this tick, e.g. from a simulate* call just before, is "now")
    cursor = isReady ? Math.min(fromInput && cursor !== undefined && cursor >= 0 ? cursor : states.length, syncAt ?? states.length) : -1;
    fromInput = false;
    shown = undefined;
    const id = ++arming;
    cursorUsed = false;
    readyPromise.then(() => { if (id == arming && !cursorUsed && !disposed) expire(id); });
    // 4-A1: on the real DOM, ready() also waits until the first render is in the DOM
    // R4-8: rejected by dispose()
    return drive(new Promise<void>((resolve, reject) => {
      readyWaiters.add(reject);
      (real ? readyPromise.then(() => untilPatched()) : readyPromise).then(() => { readyWaiters.delete(reject); resolve(); });
    }), () => disposed);
  };
  const readyWaiters = new Set<(e: Error) => void>();
  const later = (go: Input['go'], missing?: Input['missing']) => {
    const was = fromInput && cursor !== undefined ? cursor : undefined;
    cursor = shown = undefined;
    // D165: an input's STATE reducer is applied synchronously, so the state it causes can be
    // recorded before the test's next() call: next() starts at the input (several simulate*
    // calls in the same tick: the cursor stays at the first one's state)
    cursor = was ?? states.length;
    if (!fromInput) queueMicrotask(() => { fromInput = false; });
    fromInput = true; cursorUsed = false;
    // G-326: like ready()'s, the cursor expires at the next macrotask unless a next() used it,
    // so a test that moves the clock (or waits) before next() gets the state after the call
    expire(++arming);
    inputs.push({go, missing});
    pump();
  };

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
      if (real) tagTree(v);
      bump();
      check104();
      arm();
      // E4: the real DOM is patched a microtask after the sink emits
      real ? retry(0) : pump();
    });
  }
  // 1H-4: a component that never renders on its own (a model but no initialState: no state
  // until an action sets it) still becomes ready, so buffered input is delivered.
  // G-176: one that has a state but hasn't rendered it yet is only slow (a loaded machine):
  // keep waiting for its first render (at most timeoutMs), or ready() resolves before it and
  // query() returns null
  const fallbackFrom = clockNow();
  const fallbackCheck = () => {
    if (!timer && sinks.DOM && states.length && clockNow() - fallbackFrom < defaultTimeout) fallback = setTimeout(fallbackCheck, 10);
    else arm();
  };
  let fallback = setTimeout(fallbackCheck, sinks.DOM ? 30 : 0);

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
  /**
   * 4-A1 (real DOM): resolves once a render of states[0 .. n) is in the DOM and either the tree
   * has been quiet for QUIET_MS (children have rendered it too) or a newer state has arrived
   * (its render is held back by the caller's hold, so the DOM still shows state n - 1). A state
   * that never renders (same view) counts after 100ms of quiet. Gives up after 250ms.
   */
  const patchedTree = async (n: number): Promise<void> => {
    const start = clockNow();
    let seen = -1;
    while (!disposed && clockNow() - start <= 250) {
      const idle = clockNow() - lastActivity;
      const current = !vtree || lastPatched === vtree;
      if (patchedUpTo >= n && (held || states.length > n)) return;
      if ((patchedUpTo >= n || clockNow() - start > 100) && current && idle >= QUIET_MS) {
        if (seen === activity) return;
        seen = activity;
        await tick(3);
      } else {
        seen = -1;
        await tick(Math.max(1, QUIET_MS - idle));
      }
    }
  };
  /** 4-A1 (real DOM): until the latest render is in the DOM (at most 250ms) */
  const untilPatched = async (): Promise<void> => {
    const start = clockNow();
    while (!disposed && vtree && (lastPatched !== vtree || held) && clockNow() - start <= 250) await tick(1);
  };

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
    const out = renderHtml();
    return new Error(`[Sygnal] simulateEvent('${selector}', '${type}'): the selector matched nothing in the rendered output` +
      (waited ? ` (waited ${eventWaitMs}ms for it to render; the eventWaitMs option sets this)` : '') +
      `. Check t.html() to see what rendered, or give the element an attribute and select it, e.g. [data-id="3"]` +
      ` (pass { allowMissing: true } to drop the event instead).\nRendered: ${out.length > 600 ? out.slice(0, 600) + '…' : out || '(nothing)'}`);
  };

  const due = () => {
    const n = ++dueSeq;
    sendDue = true;
    Promise.resolve().then(noop).then(noop).then(noop).then(() => { if (n == dueSeq) sendDue = false; });
  };
  const simulateAction = (type: string, data?: any) => {
    simAt = states.length; due();
    throwFailure();
    later(() => (api.dispatch('root', type, data, 'simulateAction'), true));
  };

  // E2: t.respond / t.fail. PLAN-3 1-C: the request is chosen by content (G-140, E2 13-t4):
  // a string is an ok/error action name, key or category; a function a predicate; an object
  // (or `{ request }`) a partial request compared by value, preferring the very object of
  // t.requests among equal ones. With no target: the newest pending request.
  // When to pick: a call made while simulate*/respond/fail calls are still queued, or before
  // the component is ready, is queued behind them and picks its request when it is delivered,
  // waiting up to 1s for it (a debounce); otherwise the request must be pending at the call,
  // or the call throws (`expect(() => t.respond(...)).toThrow()`).
  // The returned promise resolves once the reply has been reduced and the tree rendered. A
  // failure later on rejects it; when nothing awaits it, it also fails the next wait.
  const replyWaits = new Set<(e?: Error, quiet?: boolean) => void>();
  const OPTION_KEYS = ['category', 'request', 'status', 'body', 'nth'];
  type Target = {match: (r: Pending) => boolean; exact?: any; desc: string; push?: boolean; o: any};
  // a pending request is matched by its t.requests form (`value`): a string request is { url },
  // a resource fetch carries `resource: name`
  const targetOf = (opts: any): Target => {
    const isOpts = !!opts && typeof opts == 'object' && !Array.isArray(opts) && Object.keys(opts).every(k => OPTION_KEYS.includes(k));
    const o = isOpts ? opts : {};
    // request: null pushes a value no request asked for (a source that emits on its own)
    if (isOpts && o.request === null) return {match: () => false, desc: '', push: true, o};
    let tg = isOpts ? o.request : opts;
    if (isOpts && typeof tg == 'string') tg = {url: tg};
    const cat = 'category' in o ? (r: Pending) => r.category === o.category : () => true;
    if ('nth' in o && !Number.isInteger(o.nth)) throw new Error(`[Sygnal] t.respond/t.fail: nth must be an integer (a position in t.requests(name): 0 the first, -1 the newest; got ${brief(o.nth)})`);
    const catDesc = ('category' in o ? ` with category '${o.category}'` : '') + ('nth' in o ? ` at nth: ${o.nth}` : '');
    if (tg === undefined) return {match: cat, desc: catDesc, o};
    if (typeof tg == 'string') {
      // an ok/error action name, key, category, resource name or URL
      return {match: r => { const v = r.value || {}; return cat(r) && [v.ok, v.error, v.key, v.category, r.res, v.url].includes(tg); }, desc: ` matching '${tg}'${catDesc}`, o};
    }
    if (typeof tg == 'function') {
      return {match: r => { try { return cat(r) && !!tg(r.value); } catch (_) { return false; } }, desc: ` matching the predicate${catDesc}`, o};
    }
    if (tg && typeof tg == 'object') {
      const keys = Object.keys(tg);
      return {match: r => cat(r) && !!r.value && keys.every(k => same(tg[k], r.value[k])), exact: isOpts ? o.request : tg, desc: ` matching ${brief(tg)}${catDesc}`, o};
    }
    throw new Error(`[Sygnal] t.respond/t.fail: the target must be an action name, key, category, resource name or URL, a request object, a predicate or { request, category, status, body } options (got ${typeof tg})`);
  };
  // 6-B (G-185): `nth` picks one request of t.requests(name) (those matching the rest of the
  // target) by position, pending or not: identical requests can't be told apart by content
  const nthOf = (name: string, tg: Target): {list: Pending[]; hit?: Pending} => {
    const ps = fakes.get(name)?.pending || [];
    const list = requests(name).map(v => ps.find(p => p.value === v) ||
      {value: v, req: v, category: v?.category, res: v?.resource, live: false, settle: noop} as Pending).filter(tg.match);
    const n = tg.o.nth;
    return {list, hit: list[n < 0 ? list.length + n : n]};
  };
  const pick = (name: string, tg: Target): Pending | undefined => {
    if ('nth' in tg.o) {
      const {hit} = nthOf(name, tg);
      return hit?.live ? hit : undefined;
    }
    const live = (fakes.get(name)?.pending || []).filter(r => r.live && tg.match(r));
    return (tg.exact !== undefined && live.filter(r => r.value === tg.exact || r.req === tg.exact).pop()) || live.pop();
  };
  const noPending = (what: string, name: string, tg: Target, waited: number) => {
    if ('nth' in tg.o) {
      const {list, hit} = nthOf(name, tg), all = requests(name).length;
      return new Error(`[Sygnal] ${what}: ` + (hit
        ? `t.requests('${name}')[${requests(name).indexOf(hit.value)}] (the one${tg.desc}) is not pending: it was answered, aborted, or superseded by a later latest: true request or a refetch of its resource. That is what expect(() => t.respond(...)).toThrow() asserts.`
        : `no pending ${name} request${tg.desc}${waited ? ` after ${waited}ms` : ''}: t.requests('${name}') has ${list.length} request${list.length == 1 ? '' : 's'}${list.length < all ? ` matching (${all} in all)` : ''}.`));
    }
    const sent = requests(name).length, live = fakes.get(name)?.pending.filter(r => r.live) || [];
    return new Error(`[Sygnal] ${what}: no pending ${name} request${tg.desc}${waited ? ` after ${waited}ms` : ''}. ` +
      (live.length ? `Pending: ${live.map(r => brief(r.value)).join(', ')}. ` : '') +
      (sent ? `The component sent ${sent} (t.requests('${name}'))${live.length ? '; the others were' : ','} all answered, aborted or superseded by a later latest: true request.` :
        `The component sent none: check the model entry that returns the ${name} request (t.requests('${name}') is empty).`) +
      (waited ? '' : ` t.respond/t.fail answer a request already sent, or one sent by the simulate* calls queued before them: wait for a later one first (await t.next(...) or t.settle()).`));
  };
  /**
   * 5-1: `deliver(e, o)` settles the pending fetch `e` (the driver then routes the reply);
   * `payload(category, o, e?)` is what select()/errors() would get, for a `request: null` push
   * and for the "nothing receives it" check on a plain reply.
   */
  const reply = (fn: string, name: string, err: boolean, opts: any, deliver: (e: Pending, o: any) => void, payload: (category: any, o: any, e?: Pending) => any): Promise<void> => {
    throwFailure();
    if (drivers[name]) throw new Error(`[Sygnal] t.${fn}('${name}'): ${name} has a real driver (passed in drivers), so there is nothing to script. t.respond/t.fail answer the fake source renderComponent provides when no driver is passed`);
    const tg = targetOf(opts);
    const what = `t.${fn}('${name}'${typeof opts == 'string' ? `, …, '${opts}'` : ''})`;
    // a resource named by the target may still be about to fetch (its request follows the state
    // change): queue the call like one made behind queued input
    const later = typeof opts == 'string' && !!declaredRes.get(name)?.has(opts) && states.length <= simAt ||
      // G-189: called at once after a simulate* call, on a sink that carries `resources`: the
      // requests it causes leave two microtasks later (G-158), so the call waits for them.
      // G-218: so does any request: behind a same-tick STATE reducer (several queued simulate*
      // calls), an action's non-STATE sinks run in a microtask (B-003)
      sendDue && !tg.push && !('nth' in tg.o);
    return scripted(() => tg.push ? {} : pick(name, tg), w => noPending(what, name, tg, w), hit => {
      const f = fake(name), o = tg.o;
      const e: Pending | undefined = tg.push ? undefined : hit;
      const category = 'category' in o ? o.category : e?.category;
      // the driver delivers a resource's reply, and a reply action for a request that names one
      // for this outcome (from a component), as that action; a prefetch into the cache; anything
      // else on select()/errors()
      if (e && (e.res !== undefined || e.pf || (senderOf(e.req) !== undefined && (err ? e.req.error : e.req.ok)))) return deliver(e, o);
      const data = payload(category, o, e);
      let heard = false;
      f.subs.forEach(sub => {
        let hit = false;
        // a pushed value no request asked for (request: null) reaches every scope
        try { hit = sub.err === err && (!e || inScope(sub.ns, e.req)) && (sub.sel === undefined || (typeof sub.sel == 'function' ? sub.sel(data) : sub.sel === category)); } catch (_) {}
        if (hit) { heard = true; if (!e) sub.l.next(data); }
      });
      if (heard) return e && deliver(e, o);
      if (e) e.live = false;
      const ls = [...f.subs].filter(x => x.err === err).map(x => `${name}.${err ? 'errors' : 'select'}(${x.sel === undefined ? '' : typeof x.sel == 'function' ? 'fn' : `'${x.sel}'`})`);
      return new Error(`[Sygnal] ${what}: nothing receives it: no intent listens to ${name}.${err ? 'errors' : 'select'}(${category === undefined ? '' : `'${category}'`})` +
        (ls.length ? ` (listening: ${ls.join(', ')})` : '') + `. ` +
        (err ? `Name a reply action for the failure (error: 'FAILED' on the request), or handle it in the intent, e.g. FAILED: ${name}.errors('${category ?? 'category'}'), so a failed request can't leave the component loading.` :
          `Name a reply action for the reply (ok: 'LOADED' on the request), or select it in the intent, e.g. LOADED: ${name}.select('${category ?? 'category'}').`));
    }, later);
  };
  /**
   * G-140 / PLAN-3 1-C: a scripted input (t.respond/t.fail, 2-C's t.open/t.push/t.drop). With
   * nothing queued before it and the component ready, `find()` must match now or the call
   * throws `none(0)`; otherwise it is queued and finds its target when delivered, waiting up to
   * 1s (half of timeoutMs if lower). `act(hit)` delivers it (an Error: it failed). The promise
   * resolves once the result has been reduced and the whole tree rendered.
   */
  const scripted = (find: () => any, none: (waited: number) => Error, act: (hit: any) => Error | void, later = false): Promise<void> => {
    throwFailure();
    if (isReady && !inputs.length && !disposed && !later && !find()) throw none(0);
    let ok!: () => void, ko!: (e: Error) => void, seen = false, open = true;
    const inner = new Promise<void>((a, b) => { ok = a; ko = b; });
    inner.catch(noop);
    const out = new Reply((a, b) => inner.then(a, b));
    Promise.prototype.then.call(out, undefined, noop);
    out._seen = () => {
      if (seen) return;
      seen = true;
      // E11: under fake timers, an awaited reply drives the clock like the harness's waits
      if (open && fakeClock()) drive(inner, () => disposed).catch(noop);
    };
    const settle = (e?: Error, quiet?: boolean) => {
      if (!open) return;
      open = false;
      replyWaits.delete(settle);
      if (!e) return ok();
      if (!seen && !quiet) failWith(e);
      ko(e);
    };
    replyWaits.add(settle);
    const wait = Math.min(1000, defaultTimeout / 2);
    const input: Input = {
      // up to 1s (half of timeoutMs if lower), so a wait (next/settle) still times out later
      wait,
      go: last => {
        const hit = find();
        if (!hit) {
          if (!last) return false;
          settle(none(wait));
          return true;
        }
        const failed = act(hit);
        if (failed) {
          settle(failed);
          return true;
        }
        // resolved once the reply has been reduced and the whole tree rendered (in the DOM)
        treeRendered(states.length).then(() => real ? untilPatched() : undefined).then(() => settle(), noop);
        return true;
      },
    };
    cursor = shown = undefined;
    inputs.push(input);
    pump();
    return out;
  };
  // PLAN-5 B-3: t.browser, the browser fake's controls. An event-like input (intersect, resize,
  // geolocation) must reach a declaration (else it throws, as t.respond); an environment change
  // (media, storage, visibility, online, clipboard) is kept and sent to the declarations of it
  const bwOf = (what: string) => {
    if (!bw) throw new Error(`[Sygnal] t.browser.${what}(): ${browserSink} has a real driver (passed in drivers); t.browser drives the fake renderComponent provides when no driver is passed`);
    return bw;
  };
  const toLive = (what: string, k: string, key: any, at: number | undefined, f: (e: any) => void) => {
    const b = bwOf(what);
    const hits = () => { const l = [...b.live].filter(e => e.k == k && (key === undefined || e.s[k] === key)); return at === undefined ? l : l.slice(at, at + 1); };
    const desc = `${k}${key === undefined ? '' : ` ${typeof key == 'string' ? `'${key}'` : key}`}`;
    return scripted(() => hits().length ? hits() : undefined,
      (waited) => new Error(`[Sygnal] t.browser.${what}(): nothing declares ${desc}${at === undefined ? '' : ` at ${at}`}${waited ? ` (waited ${waited}ms)` : ''}. Declared: ${[...b.live].map(e => `${e.k} ${JSON.stringify(e.s[e.k])}`).join(', ') || 'none'}`),
      (l: any[]) => { l.forEach(f); });
  };
  const envChange = (what: string, f: (b: any) => void) => { const b = bwOf(what); return scripted(() => true, () => new Error(''), () => { f(b); }); };
  const tBrowser = {
    intersect: (target: string | true, visible = true, o: any = {}) => {
      const {at, ...d} = o;
      return toLive('intersect', 'intersection', target, at, e => e.c.send({visible, ratio: visible ? 1 : 0, index: 0, dataset: {}, ...d}));
    },
    resize: (target: string | true, size: any) => {
      const {at, ...d} = size || {};
      return toLive('resize', 'resize', target, at, e => e.c.send({width: 0, height: 0, index: 0, dataset: {}, ...d}));
    },
    geolocation: (p: any) => {
      const err = p && 'code' in p;
      if (!err) bwOf('geolocation').env.pos = p;
      return toLive('geolocation', 'geolocation', undefined, undefined, e => err ? e.c.fail({code: p.code, message: p.message ?? ''}) : e.c.send(bw!.pos(p)));
    },
    media: (query: string, matches: boolean) => envChange('media', b => { b.env.media[query] = matches; b.each('media', (e: any) => e.c.send({matches, media: query}), query); }),
    visibility: (visible: boolean) => envChange('visibility', b => { b.env.visible = visible; b.each('visibility', (e: any) => e.c.send({visible})); }),
    online: (online: boolean) => envChange('online', b => { b.env.online = online; b.each('online', (e: any) => e.c.send({online})); }),
    storage: function (key: string, value?: any, area: 'local' | 'session' = 'local'): any {
      if (arguments.length < 2) return bwOf('storage').env[area == 'session' ? 'session' : 'local'][key] ?? null;
      return envChange('storage', b => b.write(key, value, area));
    },
    clipboard: function (text?: string): any {
      if (!arguments.length) return bwOf('clipboard').env.clip;
      return envChange('clipboard', b => { b.env.clip = '' + text; });
    },
    deny: (...kinds: string[]) => {
      const b = bwOf('deny');
      kinds.forEach(k => b.env.deny.add(k));
      if (kinds.includes('geolocation')) b.each('geolocation', (e: any) => e.c.fail(b.DENIED));
    },
    active: () => {
      const b = bwOf('active'), list: any[] = [];
      b.runners.forEach((r: any) => { for (const name in r.on) { const {s} = r.on[name]; if ([...b.live].some((e: any) => e.s === s)) list.push({name, ...s, component: r.c}); } });
      return list;
    },
  };
  // 5-1: the fetch resolves with a Response-like object (status, the body as JSON, or text for a
  // string), which the driver parses as it would a server's (a Response passed in is used as is)
  const urlOf = (e: Pending) => e.value?.url ?? e.req.url ?? '';
  const respond = (name: string, value: any, opts?: FakeReplyTarget) =>
    reply('respond', name, false, opts,
      (e, o) => e.settle(true, typeof Response == 'function' && value instanceof Response ? value : fakeResponse(o.status ?? 200, value, urlOf(e))),
      (category, o, e) => ({category, value, status: o.status ?? 200, request: e?.req}));
  // 5-1: a number (or a `status` option) is an HTTP error response the driver turns into its
  // Error('HTTP 404: url') with `status` / `body`; an Error or a message is a network failure
  // (the fetch rejects with it)
  // D199: `{ status, body }` (not an Error) is an error response too, as the JSDoc says
  const failureOf = (error: any, o: any) => {
    const resp = !!error && typeof error == 'object' && !(error instanceof Error) && typeof error.status == 'number';
    const status = typeof error == 'number' ? error : resp ? error.status : o.status;
    const x = typeof error == 'string' ? new Error(error) : error;
    return {status, x, resp, body: o.body ?? (x && typeof x == 'object' ? x.body : undefined)};
  };
  const fail = (name: string, error: any, opts?: FakeReplyTarget) =>
    reply('fail', name, true, opts,
      (e, o) => {
        const {status, x, body} = failureOf(error, o);
        status !== undefined ? e.settle(true, fakeResponse(status, body, urlOf(e))) : e.settle(false, x);
      },
      (category, o, e) => {
        const {status, x, resp, body} = failureOf(error, o);
        const err = typeof error == 'number' || resp ? Object.assign(new Error(`HTTP ${status}`), {status}) : x;
        return {error: err, category, request: e?.req, status: status ?? x?.status, body};
      });

  // PLAN-3 2-C: socket fakes. t.connections lists what the components declared; t.open /
  // t.push / t.drop act on the fake sockets serving the connections `target` picks (a name or
  // URL, a partial connection, a predicate; nothing: the newest socket that can take the call),
  // with t.respond's rules (scripted()): they throw at the call when nothing matches.
  const conns = (name: string): Conn[] => [...(fakes.get(name)?.ws.conns.values() || [])].flatMap(m => [...m.values()]);
  const connections = (name: string) => conns(name).map(sockView);
  // 5-3: the driver's own view of its cache; t.focus / t.online fire the fake drivers' signals
  const cache = (name: string) => fake(name).http.__inspect().cache || [];
  const signal = (s: string) => later(() => (signals.forEach(f => f(s)), true));
  const sent = (name: string, to?: string) => {
    const all = fake(name).ws.sent;
    return to === undefined ? all : all.filter(v => v.to === to);
  };
  const connTarget = (tg: any): [(c: Conn) => boolean, string] => {
    if (tg === undefined) return [() => true, ''];
    if (typeof tg == 'string') return [c => c.name === tg || c.url === tg || (c.sse ? c.spec.sse : c.spec.socket) === tg, ` matching '${tg}'`];
    if (typeof tg == 'function') return [c => { try { return !!tg(sockView(c)); } catch (_) { return false; } }, ' matching the predicate'];
    if (tg && typeof tg == 'object') {
      return [c => { const v: any = sockView(c); return Object.keys(tg).every(k => same(tg[k], v[k])); }, ` matching ${brief(tg)}`];
    }
    throw new Error(`[Sygnal] the connection target must be a connection name or URL, a partial connection ({ socket: '/ws/a' }) or a predicate (got ${typeof tg})`);
  };
  const sockCall = (fn: string, name: string, tg: any, states: number[], act: (s: any) => void): Promise<void> => {
    if (drivers[name]) throw new Error(`[Sygnal] t.${fn}('${name}'): ${name} has a real driver (passed in drivers), so there is nothing to script. t.${fn} drives the fake socket source renderComponent provides when no driver is passed`);
    const [match, desc] = connTarget(tg);
    const kind = states.length > 1 ? 'open or connecting' : states[0] ? 'open' : 'connecting';
    const w = () => fake(name).ws;
    const find = () => {
      const ok = new Set<any>();
      // (autoConnect: a socket about to open counts as open)
      conns(name).forEach(c => { if (c.s && states.includes(c.s.auto && !c.s.readyState ? 1 : c.s.readyState) && match(c)) ok.add(c.s); });
      const list = [...ok];
      return list.length ? (tg === undefined ? [list.sort((a, b) => w().sockets.indexOf(a) - w().sockets.indexOf(b)).pop()] : list) : undefined;
    };
    const none = (waited: number) => {
      const list = connections(name);
      return new Error(`[Sygnal] t.${fn}('${name}'${desc ? ', …' : ''}): no ${kind} ${name} connection${desc}${waited ? ` after ${waited}ms` : ''}. ` +
        (list.length ? `Connections: ${list.map(c => `${c.name} (${c.socket ?? c.sse}, ${c.state})`).join(', ')}.` :
          `None is declared: declare it with { connections: { room: { socket: '/ws/…' } } } on the ${name} sink first (t.connections('${name}') is empty).`) +
        (states.includes(1) && list.some(c => c.state == 'connecting') ? ` A connecting one (autoConnect: false) opens with t.open('${name}').` : '') +
        (!states.includes(1) && autoConnect ? ` With autoConnect (the default) connections open by themselves: renderComponent(C, { autoConnect: false }) holds them for t.open.` : '') +
        (waited ? '' : ` A call made while simulate* / t.* calls are still queued waits for them; otherwise the connection must be there at the call.`));
    };
    return scripted(find, none, (hit: any[]) => hit.forEach(s => {
      if (s.auto && !s.readyState) sockOpen(s);
      act(s);
    }));
  };
  const open = (name: string, target?: FakeConnectionTarget) => sockCall('open', name, target, [0], sockOpen);
  const push = (name: string, data: any, target?: any) => {
    const o = target && typeof target == 'object' && !Array.isArray(target) && Object.keys(target).length && Object.keys(target).every(k => k == 'event' || k == 'connection') ? target : {connection: target};
    const raw = typeof data == 'string' || (data && typeof data == 'object' && (data instanceof ArrayBuffer || ArrayBuffer.isView(data) || (typeof Blob != 'undefined' && data instanceof Blob))) ? data : JSON.stringify(data);
    const ev = o.event;
    return sockCall('push', name, o.connection, [1], s => {
      const m = {type: ev || 'message', data: raw};
      if (!ev || ev == 'message') sockFire(s, 'message', m);
      if (s.sse) (s.ls[ev || 'message'] || []).forEach((f: any) => { try { f(m); } catch (e) { console.error(e); } });
    });
  };
  const drop = (name: string, close?: any, target?: any) => {
    const info = close && typeof close == 'object' && !Array.isArray(close) && Object.keys(close).every(k => k == 'code' || k == 'reason');
    const tg = info || close === undefined ? target : close;
    const {code = 1006, reason = ''} = info ? close : {};
    return sockCall('drop', name, tg, [0, 1], s => {
      const connecting = s.readyState == 0;
      if (s.sse) {
        // EventSource gave up (CLOSED): the driver's reconnect applies
        s.readyState = 2;
        return sockFire(s, 'error', {type: 'error'});
      }
      s.readyState = 3;
      if (connecting) sockFire(s, 'error', {type: 'error'});
      sockFire(s, 'close', {type: 'close', code, reason, wasClean: false});
    });
  };
  // PLAN-3 5-4c: the router fake's test API. t.navigate / t.back / t.forward follow
  // t.respond's rules (scripted()): they throw at the call when they can't act, and resolve once
  // the result has been reduced and rendered.
  const needRouter = (fn: string): RouterFake => {
    if (rt) return rt;
    throw new Error(drivers[routerSink]
      ? `[Sygnal] t.${fn}(): ${routerSink} has a real driver (passed in drivers), so there is no in-memory history to drive. Drop it from drivers and pass the app's router: renderComponent(${compName}, { router })`
      : `[Sygnal] t.${fn}() needs the router fake: renderComponent(${compName}, { router }), with the object makeRouter() returns (import { router } from './routes.js')`);
  };
  const navigate = (target: any): Promise<void> => {
    const f = needRouter('navigate'), routes = f.r.routes, L = f.mem.w.location;
    let cmd: any;
    if (typeof target == 'string') {
      // an href, as a link has it: navigating to it is what a click on that link does
      const u = new URL(target, L.href);
      if (u.origin != L.origin) throw new Error(`[Sygnal] t.navigate('${target}'): that URL is on another origin (${u.origin}, the test's is ${L.origin}); the router leaves external links to the browser. Navigate to a path: t.navigate('/tasks/2')`);
      cmd = {url: u.pathname + u.search + u.hash};
    } else if (target && typeof target == 'object' && typeof target.to == 'string') {
      const pat = routes[target.to];
      if (pat == null || pat == '*') throw new Error(`[Sygnal] t.navigate({ to: '${target.to}' }): no route named '${target.to}'. Routes: ${Object.keys(routes).filter(k => routes[k] != '*').join(', ')}`);
      const missing = paramsOf(pat).filter(k => target.params?.[k] == null);
      if (missing.length) throw new Error(`[Sygnal] t.navigate({ to: '${target.to}' }): route '${target.to}' (${pat}) needs params: ${missing.join(', ')}. t.navigate({ to: '${target.to}', params: { ${missing.join(', ')} } })`);
      cmd = {...target};
    } else {
      throw new Error(`[Sygnal] t.navigate(): pass a URL ('/tasks/2') or { to: 'task', params: { id: 2 }, query?, hash?, replace? } (got ${brief(target)})`);
    }
    return scripted(() => true, () => new Error(''), () => { f.cmd$.shamefullySendNext(cmd); });
  };
  // the browser's back / forward buttons: the history moves, popstate fires a task later
  const traverse = (fn: string, n: number): Promise<void> => {
    const f = needRouter(fn), can = () => f.mem.index() + n >= 0 && f.mem.index() + n < f.mem.size();
    return scripted(can, w => new Error(`[Sygnal] t.${fn}(): no history entry to go ${n < 0 ? 'back' : 'forward'} to${w ? ` after ${w}ms` : ''} (at ${f.mem.w.location.pathname}, entry ${f.mem.index() + 1} of ${f.mem.size()}). Navigate first: await t.navigate('/…')`),
      () => { f.mem.w.history.go(n); });
  };
  const routerLocation = () => {
    const L = needRouter('location').mem.w.location;
    return {path: L.pathname, search: L.search, hash: L.hash, href: L.href};
  };
  // mock DOM: a click on (or inside) an <a> also reaches the router's document click listener,
  // as it would bubble to the document: the driver's own interception decides
  const routerClick = (chain: any[], ev: any) => {
    const ls = rt?.mem.docLs.click;
    if (!ls?.length) return;
    let k = chain.length - 1;
    while (k >= 0 && String(chain[k]?.sel || '').split(/[.#]/)[0].toLowerCase() != 'a') k--;
    if (k < 0) return;
    const a = anchorOf(chain[k]);
    const e: any = {
      type: 'click', button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...ev,
      defaultPrevented: !!ev.defaultPrevented, target: a, composedPath: () => [a],
      preventDefault() { e.defaultPrevented = true; },
    };
    ls.slice().forEach((l: any) => l(e));
  };
  const sentTo = (name: string, to?: string) => (rt && name == routerSink ? rt.sent : sent(name, to));
  const head = () => {
    if (!hd) throw new Error(`[Sygnal] t.head(): ${headSink} has a real driver (passed in drivers), so the fake that records the head isn't there. Read the document it writes, or drop it from drivers`);
    const m = mergeHead([...hd.entries.values()], titleTemplate);
    return {title: m.title, meta: Object.fromEntries(m.meta.map(([, k, c]) => [k, c])), link: m.link.map(([, l]) => l)};
  };

  // E4: where real elements are looked up: the container, and the Portal content this tree
  // mounted outside it
  const roots = (): Element[] => {
    const out: Element[] = [container!];
    const walk = (v: any) => {
      if (!v || typeof v != 'object') return;
      const pe = v.data?._portalVnode?.elm;
      if (pe && !container!.contains(pe)) out.push(pe);
      for (const k of [].concat(v.children || [], v.data?.portalChildren || [])) walk(k);
    };
    walk(vtree);
    return out;
  };
  // G-125/4-A1: reading the output before the first render can only mislead (null, '')
  const notYet = (call: string) => {
    if (!isReady && !(real ? lastPatched : vtree)) {
      throw new Error(`[Sygnal] ${call} ran before the component's first render${real ? ' was in the DOM' : ''}. Wait for it first: await t.ready() (or await t.next(...))`);
    }
  };
  // 6-B (G-185): on the mock DOM, MockElement snapshots of the latest rendered tree
  const mockAll = (s: string): any[] => findAll(vtree, parse(norm(s)), [], []).map(c => mockOf(c, htmlOf));
  const queryAll = (s: string): Element[] => {
    s = selOf(s);
    notYet(`t.queryAll('${s}')`);
    if (!real) return mockAll(s);
    return roots().flatMap(r => Array.from(r.querySelectorAll(s)));
  };
  const queryIn = (s: string): Element | null => {
    for (const r of roots()) {
      const e = r.querySelector(s);
      if (e) return e;
    }
    return null;
  };
  const query = (s: string): Element | null => {
    s = selOf(s);
    notYet(`t.query('${s}')`);
    if (!real) return mockAll(s)[0] ?? null;
    return queryIn(s);
  };

  // PLAN-5 W-1: a widget host (selector or control): the props it was rendered with (the mock
  // DOM: the host vnode's; real: the mounted instance's), its instance (real) and dispatch, which
  // sends the CustomEvent mount's dispatch() would (through simulateEvent, so in input order);
  // D201: emit is an alias
  const widget = (target: any) => {
    const sel = String(selOf(target));
    const host = (): any => {
      const el: any = query(sel);
      const r = real ? el?.__sw : el?._v?.data?.ww && {p: el._v.data.wp};
      if (!r) throw new Error(`[Sygnal] t.widget('${sel}'): no ${el ? `mounted widget is the matched <${el.localName}>` : 'element matches it'}. Give the widget a className and pass its selector (t.widget('.due')), or pass its control`);
      return r;
    };
    const dispatch = (name: string, detail?: any) => simulateEvent(target, name, {detail} as any);
    return {
      get props() { return host().p; },
      get instance() { return host().i; },
      dispatch,
      emit: dispatch,
    };
  };

  const simulateEvent = (target: any, type: string, init: SimulatedEventInit = {}) => {
    simAt = states.length; due();
    throwFailure();
    const {allowMissing, within: inside, ...evInit} = init;
    // CT-1: a control is its selector (also for `within`)
    const raw = String(selOf(target)), text = norm(raw);
    // 'document' / 'body' (and '') name a listener, not an element
    const page = !text || PAGE.test(text);
    // CT-1: `within` scopes the target to the first element matching it (e.g. one Collection item)
    const within = inside == null || page ? '' : norm(String(selOf(inside)));
    const selector = within ? `${raw}' within '${within}` : raw;
    // unsupported syntax throws here, at the call (G-070); the real DOM takes any CSS selector
    const sel = page || real ? [] : parse(text);
    const box = within && !real ? parse(within) : undefined;
    if (real && !page) {
      try { container!.querySelector(text); if (within) container!.querySelector(within); } catch (_) {
        throw new Error(`[Sygnal] simulateEvent('${selector}', '${type}'): not a valid CSS selector`);
      }
    }
    // the root → element chain of the target in the mock vtree (inside the `within` element)
    const findChain = (): any[] | undefined => {
      if (!box) return find(vtree, sel);
      const outer = find(vtree, box);
      return outer && findAll(outer[outer.length - 1], sel, outer.slice(0, -1), [], false)[0];
    };
    // E4: the real element: document / body / the root element for '' / the first match
    const realEl = (): any => text == 'document' ? document : text == 'body' ? document.body
      : !text ? container!.firstElementChild
      : within ? queryIn(within)?.querySelector(text)
      : queryIn(text.replace(PAGE, '') || text);
    const has = () => real ? !!realEl() : !!findChain();
    // nothing pending and the tree is quiet (as settle() would see it): fail at the call
    if (!page && !allowMissing && isReady && !inputs.length && vtree && renderedUpTo >= states.length &&
        clockNow() - lastActivity >= settleMs && !has()) {
      throw noMatch(selector, type, false);
    }
    later(last => {
      const rel = real ? realEl() : undefined;
      const chain: any[] | undefined = page ? undefined : real ? rel && (chainOf(vtree, rel) || []) : findChain();
      const el = real ? rel : chain?.[chain.length - 1];
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
      // the chain index of the deepest element a listener at `path` hears this event on
      // (-1: a document/body listener), or undefined when it doesn't hear it
      const depthOf = (path: string[]): number | undefined => {
        let ls = selText(path);
        if (!chain) return ls == text ? 0 : undefined;
        let els = chain;
        const pageLs = PAGE.test(ls);
        if (pageLs) ls = ls.replace(PAGE, '');
        else {
          const scope = path.filter(isScope).pop();
          let cur: string | undefined;
          els = chain.filter(v => {
            const m = scopeOfV(v);
            if (m) cur = m;
            return cur == scope;
          });
        }
        if (!ls) return pageLs || !els.length ? -1 : chain.indexOf(els[0]);
        const lsel = tryParse(ls);
        if (!lsel) return undefined;
        for (let k = els.length - 1; k >= 0; k--) {
          if (matches(lsel, els.slice(0, k + 1))) return pageLs ? -1 : chain.indexOf(els[k]);
        }
        return undefined;
      };
      const match = (path: string[]) => depthOf(path) !== undefined;
      // G-039: wait until every listener this event would reach is subscribed
      if (!last) {
        for (const [k, path] of listeners) {
          if ((evTypes[k] || []).includes(type) && !live.get(k + '\u0000' + type) && match(path)) return false;
        }
      }
      if (real) {
        if (chain?.length) check104(chain[chain.length - 1]);
        fire(el, type, evInit);
        return true;
      }
      if (el) check104(el);
      const d = el?.data || {}, p = d.props || {};
      const {target: t = {}, value, checked, dataset, data, ...rest} = evInit;
      const vval = p.value ?? d.attrs?.value;
      const target: any = {
        tagName: el?.sel.split(/[.#]/)[0].toUpperCase(),
        // D199 (spike 0-S2): name/id/type/getAttribute, so listeners that delegate by name
        // (`e.target.name`, a form-level input listener) work on the mock DOM as on the real one
        ...(el && {name: attrOf(el, 'name') ?? '', id: attrOf(el, 'id') ?? '', type: attrOf(el, 'type') ?? '', getAttribute: (n: string) => attrOf(el, n)}),
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
      const noBubble = NO_BUBBLE.test(type);
      const event = {
        type,
        target,
        currentTarget: target,
        ownerTarget: target,
        dataTransfer: {},
        preventDefault: noop,
        stopPropagation: noop,
        bubbles: !noBubble,
        ...rest,
      };
      // G-145: like native bubbling, listeners on deeper elements (a child's) hear the
      // event before those on their ancestors (the parent's wrapper), then document/body.
      // 1-F: an event that doesn't bubble (dialog close, focus, ...) reaches the target only
      if (!chain) hub.emit({type, event, match});
      else for (let k = chain.length - 1; k >= (noBubble ? chain.length - 1 : -1); k--) hub.emit({type, event, match: (p: string[]) => depthOf(p) === k});
      // PLAN-3 5-4c: and a link click reaches the router fake's document listener
      if (type == 'click' && chain) routerClick(chain, event);
      return true;
    }, page || allowMissing ? undefined : () => (has() ? undefined : noMatch(selector, type, false)));
  };

  // first state at index >= from matching predicate; resolves after the full tree rendered it
  const waitMatch = (from: number, predicate: (state: any) => boolean, timeoutMs: number, name: string): Promise<any> =>
    new Promise((resolve, reject) => {
      const f = takeFailure();
      if (f) return reject(f);
      // 4-A1: on the real DOM, the wait resolves once the newest state at the match (h) is
      // patched into the DOM, and a render of a later state is held back until the code after
      // the `await` has run (the next macrotask), so t.query() reads the matched state
      let h = -1;
      const unhold = () => { if (h >= 0) { const k = h; h = -1; setTimeout(() => release(k)); } };
      const found = (i: number) => {
        clearTimeout(timer);
        stateStream.removeListener(listener);
        if (real) {
          holds.push(h = states.length - 1);
          patchedTree(h + 1).then(() => {
            waiters.delete(fail);
            // the states after h weren't in the DOM yet: the next next() may still match them
            if (h >= 0) shown = h + 1;
            resolve(states[i]);
            unhold();
          });
        } else {
          // G-129: the next next() starts after this state (as on the real DOM), so a state
          // that arrived while this one's render settled can still match
          treeRendered(i + 1).then(() => { waiters.delete(fail); if (!disposed) shown = i + 1; resolve(states[i]); });
        }
      };
      const test = (i: number) => { try { return predicate(states[i]); } catch (_) { return false; } };
      const fail = (err: Error) => { clearTimeout(timer); stateStream.removeListener(listener); waiters.delete(fail); unhold(); reject(err); };
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
    cursor = shown = undefined;
    return drive(waitMatch(0, predicate, timeoutMs, 'waitForState'), () => disposed);
  };
  const next = (predicate: (state: any) => boolean = () => true, timeoutMs: number = defaultTimeout) => {
    checkMs('next', timeoutMs);
    // 4-A1/G-129: right after a wait, start after the state it returned (real DOM: the state the DOM shows)
    if (cursor === undefined && shown !== undefined) return drive(waitMatch(Math.min(shown, states.length), predicate, timeoutMs, 'next'), () => disposed);
    if (cursor === undefined || (cursor < 0 && !isReady)) return drive(waitMatch(cursor === undefined && syncAt !== undefined ? syncAt : states.length, predicate, timeoutMs, 'next'), () => disposed);
    const id = arming;
    cursorUsed = true;
    unexpire();
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
    cursor = shown = undefined;
    const f = takeFailure();
    if (f) return reject(f);
    let wait: any;
    const done = (e?: Error) => { clearTimeout(wait); waiters.delete(done); e ? reject(e) : resolve(); };
    waiters.add(done);
    const start = clockNow();
    (async () => {
      await Promise.race([readyPromise, new Promise(r => { wait = setTimeout(r, timeoutMs); })]);
      clearTimeout(wait);
      // 4-A1: on the real DOM, quiet also means the latest render is in the DOM
      const busy = () => !isReady || inputs.length > 0 || (real && !!vtree && (lastPatched !== vtree || !!held));
      if (!await quiesce(states.length, settleMs, timeoutMs, busy)) {
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
  const html = () => {
    notYet('t.html()');
    return renderHtml();
  };
  const htmlOf = (v: any) =>
    renderToInnerHtml(() => unmark(v)).replace(/ class="([^"]*)"/g, (_, c: string) =>
      (c = c.split(' ').filter(x => !x.startsWith('___')).join(' ')) ? ` class="${c}"` : ''
    );
  const renderHtml = () => vtree ? htmlOf(vtree) : '';

  const inspect = (o: Pick<InspectOptions, 'actions'> = {}): InspectGraph => {
    if (!core.inspect) throw Error(`[Sygnal] t.inspect() needs import 'sygnal/diagnostics'`);
    return core.inspect({ids: [...scopeIds.values()], diagnostics: collected, mock: {listeners, evTypes, owners, scopeIds, probe, vtree}, ...(o.actions !== undefined && {actions: o.actions})});
  };

  // PLAN-4 2-C: the first action whose resulting root state matches
  const explain = (pred: (state: any) => boolean): ExplainedAction | undefined => {
    if (typeof pred != 'function') throw new Error('[Sygnal] t.explain(predicate): pass a function of the state, e.g. t.explain(s => s.status === \'error\')');
    for (const e of actionList) {
      const r = resulting.get(e);
      let hit = false;
      if (r) try { hit = !!pred(r.s); } catch (_) {}
      if (!hit) continue;
      const fn = stateReducer.get(e);
      let source = '';
      try { source = fn ? Function.prototype.toString.call(fn) : ''; } catch (_) {}
      return {...e, sinks: [...e.sinks], state: r!.s, ...(fn && {reducer: {action: e.type, sink: 'STATE', fn, source: source.length > 400 ? source.slice(0, 400) + '…' : source}})};
    }
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    commandTimers.forEach(clearTimeout);
    clearTimeout(timer);
    clearTimeout(fallback);
    clearTimeout(retryTimer);
    unexpire();
    // G-070: an event still waiting for an element that never rendered fails the test
    const head = inputs[0];
    if (head && head.until && head.missing && !failure) failure = head.missing();
    inputs.length = 0;
    subs.forEach(([s, l]) => {
      try { s.removeListener(l); } catch (_) {}
    });
    try { sinks.__dispose?.(); } catch (_) {}
    // E4: unmount (the container and the Portal content mounted outside it)
    const mounted = real ? roots() : [];
    // 2-C: every fake connection closes (as the app's own close: no close action)
    // 5-1: and every fetch still in flight is aborted
    fakes.forEach(f => { f.ws.src.dispose(); f.ws.conns.clear(); f.http.dispose(); });
    mounted.forEach(e => e.remove());
    restore();
    // R4-8: every pending wait (ready, next, waitForState, settle) rejects now, its timers
    // cleared, so nothing hangs (fake timers) or fails much later
    const ws = [...waiters, ...readyWaiters];
    waiters.clear();
    readyWaiters.clear();
    const gone = new Error('[Sygnal] renderComponent was disposed while this wait was pending (t.ready/t.next/t.waitForState/t.settle). Await every wait before t.dispose()');
    ws.forEach(w => w(gone));
    // a t.respond/t.fail still queued rejects too (it never fails a later wait: there is none)
    const rs = [...replyWaits];
    replyWaits.clear();
    rs.forEach(r => r(new Error('[Sygnal] renderComponent was disposed before this t.respond/t.fail was delivered'), true));
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
    // GS-5: then the pending persist() writes
    settle: (ms?: number) => settle(ms).then(() => { if (ps) ps.f.forEach((f: () => void) => f()); }),
    states,
    actions: actionList,
    explain,
    get state() { return states[states.length - 1]; },
    sinkValues,
    requests,
    respond,
    fail,
    connections,
    cache,
    focus: () => signal('focus'),
    online: () => signal('online'),
    open,
    push,
    drop,
    sent: sentTo,
    navigate,
    back: () => traverse('back', -1),
    forward: () => traverse('forward', 1),
    get location() { return routerLocation(); },
    head,
    timers: () => {
      if (!tm) throw new Error(`[Sygnal] t.timers(): ${timerSink} has a real driver (passed in drivers); t.timers lists the timers of the fake renderComponent provides when no driver is passed`);
      const list: any[] = [];
      tm.forEach(r => { for (const name in r.on) { const {ok, d, s} = r.on[name]; if (ok && !d) list.push({name, ...s, action: s.action ?? s.frame, component: r.c}); } });
      return list;
    },
    browser: tBrowser,
    storage: (key: string) => store[key],
    emitted: sinkValues('EVENTS'),
    diagnostics: collected,
    commands: (name = 'ELEMENT') => name == 'ELEMENT' ? commandLog : sinkValues(name),
    expectNoDiagnostics,
    html,
    dispose,
    inspect,
    container,
    query,
    queryAll,
    widget,
  };
}
