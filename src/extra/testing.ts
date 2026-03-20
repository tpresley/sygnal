import {setup} from '../cycle/run/index';
import {withState} from '../cycle/state/index';
import {mockDOMSource} from '../cycle/dom/index';
import eventBusDriver from './eventDriver';
import logDriver from './logDriver';
import component from '../component';
import xs, {Stream} from './xstreamCompat';

export interface RenderOptions {
  /** Override or provide initial state (defaults to component's .initialState) */
  initialState?: any;
  /** Mock DOM configuration — maps selectors to event streams */
  mockConfig?: Record<string, any>;
  /** Additional drivers beyond DOM, EVENTS, STATE, and LOG */
  drivers?: Record<string, any>;
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
  /** Push an action directly into the intent→model pipeline */
  simulateAction: (actionName: string, data?: any) => void;
  /** Wait for state to satisfy a predicate (resolves with the matching state) */
  waitForState: (predicate: (state: any) => boolean, timeoutMs?: number) => Promise<any>;
  /** Collected state values — grows as new states are emitted */
  states: any[];
  /** Tear down the component and clean up all listeners */
  dispose: () => void;
}

/**
 * Render a Sygnal component in isolation for testing.
 *
 * Creates a minimal Cycle.js runtime with mocked DOM, event bus,
 * and state drivers. Returns streams and helpers for inspecting
 * component behavior.
 *
 * ```js
 * const t = renderComponent(Counter, { initialState: { count: 0 } })
 * t.simulateAction('INCREMENT')
 * await t.waitForState(s => s.count === 1)
 * t.dispose()
 * ```
 */
export function renderComponent(
  componentDef: any,
  options: RenderOptions = {}
): RenderResult {
  const {initialState, mockConfig = {}, drivers = {}} = options;

  const name = componentDef.name || componentDef.componentName || 'TestComponent';
  const view = componentDef;
  const {
    intent,
    model,
    context,
    calculated,
    storeCalculatedInState,
    onError,
  } = componentDef;

  const resolvedInitialState =
    initialState !== undefined ? initialState : componentDef.initialState;

  // Create a test action$ stream that simulateAction can push into.
  // The component's intent function will receive this as a source,
  // and we merge test actions with any real intent streams.
  const testActionListener: {next: (val: any) => void} = {next: () => {}};
  const testAction$: Stream<any> = xs.create({
    start(listener: any) {
      testActionListener.next = (val: any) => listener.next(val);
    },
    stop() {
      testActionListener.next = () => {};
    },
  });

  // Wrap the original intent to merge in test actions
  const wrappedIntent = intent
    ? (sources: any) => {
        const intentResult = intent(sources);
        // Intent returns a map of { ACTION: stream$ }
        // We add a special __TEST_ACTION__ entry that carries the test actions
        return {...intentResult, __TEST_ACTION__: testAction$};
      }
    : (sources: any) => ({__TEST_ACTION__: testAction$});

  // Wrap the model to handle __TEST_ACTION__ by dispatching to the real action
  const wrappedModel: Record<string, any> = {
    ...(model || {}),
    __TEST_ACTION__: {
      STATE: (state: any, action: any) => {
        if (!action || !action.type) return state;
        const {type, data} = action;

        // Find the model entry for this action
        let entry = model?.[type];

        // Check for shorthand entries ('ACTION | DRIVER')
        if (!entry) {
          for (const key of Object.keys(model || {})) {
            if (key.includes('|')) {
              const parts = key.split('|').map((s: string) => s.trim());
              if (parts[0] === type) {
                entry = {[parts[1]]: model[key]};
                break;
              }
            }
          }
        }

        if (!entry) return state;

        // Plain function = state reducer
        if (typeof entry === 'function') {
          const result = entry(state, data);
          // Match component.ts ABORT handling
          if (typeof result === 'symbol') return state;
          return result !== undefined ? result : state;
        }

        // Object with sink entries — apply STATE reducer if present
        if (typeof entry === 'object') {
          const stateReducer = entry.STATE || entry[stateSourceName];
          if (typeof stateReducer === 'function') {
            const result = stateReducer(state, data);
            if (typeof result === 'symbol') return state;
            return result !== undefined ? result : state;
          }
          // EFFECT and other non-state sinks
          const effectReducer = entry.EFFECT;
          if (typeof effectReducer === 'function') {
            const next = (nextType: string, nextData?: any) => {
              setTimeout(
                () => testActionListener.next({type: nextType, data: nextData}),
                10
              );
            };
            effectReducer(state, data, next, {});
          }
        }

        return state;
      },
    },
  };

  const stateSourceName = 'STATE';

  const app = component({
    name,
    view,
    intent: wrappedIntent,
    model: wrappedModel,
    context,
    initialState: resolvedInitialState,
    calculated,
    storeCalculatedInState,
    onError,
  });

  const wrapped = withState(app, stateSourceName);
  const mockDOM = () => mockDOMSource(mockConfig);

  const baseDrivers: Record<string, any> = {
    DOM: mockDOM,
    EVENTS: eventBusDriver,
    LOG: logDriver,
    ...drivers,
  };

  const {sources, sinks, run: _run} = setup(wrapped, baseDrivers as any);
  const rawDispose = _run();

  // Collect state values
  const states: any[] = [];
  let stateListener: any = null;
  const stateStream: Stream<any> =
    sources.STATE && sources.STATE.stream ? sources.STATE.stream : xs.never();

  stateListener = {
    next: (s: any) => states.push(s),
    error: () => {},
    complete: () => {},
  };
  stateStream.addListener(stateListener);

  // simulateAction: push into the test action stream
  const simulateAction = (actionName: string, data?: any) => {
    testActionListener.next({type: actionName, data});
  };

  // waitForState: resolve when the predicate matches
  const waitForState = (
    predicate: (state: any) => boolean,
    timeoutMs: number = 2000
  ): Promise<any> => {
    return new Promise((resolve, reject) => {
      // Check already-collected states
      for (const s of states) {
        try {
          if (predicate(s)) return resolve(s);
        } catch (_) {}
      }

      const timer = setTimeout(() => {
        try {
          stateStream.removeListener(listener);
        } catch (_) {}
        reject(new Error(`waitForState timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const listener = {
        next: (s: any) => {
          try {
            if (predicate(s)) {
              clearTimeout(timer);
              stateStream.removeListener(listener);
              resolve(s);
            }
          } catch (_) {}
        },
        error: (err: any) => {
          clearTimeout(timer);
          reject(err);
        },
        complete: () => {
          clearTimeout(timer);
          reject(new Error('waitForState: state stream completed without matching'));
        },
      };

      stateStream.addListener(listener);
    });
  };

  const dispose = () => {
    if (stateListener) {
      try {
        stateStream.removeListener(stateListener);
      } catch (_) {}
      stateListener = null;
    }
    rawDispose();
  };

  return {
    state$: stateStream,
    dom$: sinks.DOM || xs.never(),
    events$: sources.EVENTS || {select: () => xs.never()},
    sinks,
    sources,
    simulateAction,
    waitForState,
    states,
    dispose,
  };
}
