import xs, {Stream, MemoryStream} from 'xstream';
import {DevToolEnabledSource, FantasyObservable} from '../run/types';
import {VNode} from './snabbdom';
import {EventsFnOptions} from './DOMSource';
import {adapt} from '../run/adapt';
import {enrichEventStream} from './enrichEventStream';

/**
 * Optional simulated-event hub (used by renderComponent's simulateEvent): a
 * stream of `{type, event, match(path)}`; each source's events(type) also emits
 * the hub events whose `match` accepts its selector path (isolation scopes
 * included as '.___scope' segments).
 */
export type MockEventHub = Stream<{type: string; event: any; match: (path: string[]) => boolean}>;

/**
 * Optional listener callback (renderComponent): called with `live` undefined when events() is
 * called (SYG103/104 checks), then with true / false when that hub listener is subscribed /
 * unsubscribed (simulateEvent waits for a just-mounted child's listeners, G-039).
 */
export type MockOnEvents = (path: string[], eventType: string, live?: boolean) => void;

export type MockConfig = {
  [name: string]: FantasyObservable<any> | MockConfig;
};

const SCOPE_PREFIX = '___';

export class MockedDOMSource {
  private _elements: FantasyObservable<any>;

  constructor(
    private _mockConfig: MockConfig,
    private _hub?: MockEventHub,
    public _path: string[] = [],
    private _onEvents?: MockOnEvents
  ) {
    if (_mockConfig.elements) {
      this._elements = _mockConfig.elements as FantasyObservable<any>;
    } else {
      this._elements = adapt(xs.empty());
    }
  }

  public elements(): any {
    const out: Partial<DevToolEnabledSource> & FantasyObservable<any> = this
      ._elements;
    out._isCycleSource = 'MockedDOM';
    return out;
  }

  public element(): any {
    const output$: MemoryStream<Element> = this.elements()
      .filter((arr: Array<any>) => arr.length > 0)
      .map((arr: Array<any>) => arr[0])
      .remember();
    const out: DevToolEnabledSource & MemoryStream<Element> = adapt(output$);
    out._isCycleSource = 'MockedDOM';
    return out;
  }

  public events(
    eventType: string,
    options?: EventsFnOptions,
    bubbles?: boolean
  ): any {
    const configured = this._mockConfig[eventType] as any;
    const {_hub: hub, _path: path, _onEvents: on} = this;
    if (on) on(path, eventType);
    let hub$: Stream<any> | undefined;
    if (hub) {
      const ev$ = hub.filter(e => e.type === eventType && e.match(path)).map(e => e.event);
      let l: any;
      hub$ = on
        ? xs.create({
            start: (x: any) => {
              ev$.addListener(l = {next: (v: any) => x.next(v), error: (e: any) => x.error(e), complete: () => x.complete()});
              on(path, eventType, true);
            },
            stop: () => {
              ev$.removeListener(l);
              on(path, eventType, false);
            },
          })
        : ev$;
    }
    const out: DevToolEnabledSource & FantasyObservable<any> = enrichEventStream(adapt(
      hub$
        ? xs.merge(configured ? xs.fromObservable(configured) : xs.empty(), hub$)
        : configured || xs.empty()
    ));

    out._isCycleSource = 'MockedDOM';

    return out;
  }

  public select(selector: any): MockedDOMSource {
    // CT-1: a control selects by its marker; a component (any other function) is rejected
    // like the real DOM source does (SYG124 in the dev entry names the fixes)
    if (typeof selector == 'function') {
      if (!selector.__sygnalControl) {
        throw new Error(`DOM driver's select() expects the argument to be a string as a CSS selector`);
      }
      selector = '' + selector;
    }
    const mockConfigForSelector = this._mockConfig[selector] || {};

    return new MockedDOMSource(
      mockConfigForSelector as MockConfig,
      this._hub,
      this._path.concat(selector),
      this._onEvents
    );
  }

  public isolateSource(
    source: MockedDOMSource,
    scope: string
  ): MockedDOMSource {
    return source.select('.' + SCOPE_PREFIX + scope);
  }

  /** PLAN-4.6: isolateSink for one vnode (a copy, with the scope class) */
  public isolateValue(vnode: any, scope: string): any {
    // G-305: the scope's class token exactly (scope s1 is not s14)
    return !vnode || (vnode.sel && vnode.sel.split('.').indexOf(SCOPE_PREFIX + scope) > 0) ? vnode : {...vnode, sel: vnode.sel + `.${SCOPE_PREFIX}${scope}`};
  }

  public isolateSink(sink: any, scope: string): any {
    return adapt(
      xs.fromObservable<any>(sink).map((vnode: VNode) => {
        // B-025: a Switchable's DOM sink starts with undefined (nothing rendered yet); the
        // real DOM driver's isolateSink passes it through too
        if (!vnode) return vnode;
        if (vnode.sel && vnode.sel.indexOf(SCOPE_PREFIX + scope) !== -1) {
          return vnode;
        } else {
          vnode.sel += `.${SCOPE_PREFIX}${scope}`;
          return vnode;
        }
      })
    );
  }
}

export function mockDOMSource(
  mockConfig: MockConfig,
  hub?: MockEventHub,
  onEvents?: MockOnEvents
): MockedDOMSource {
  return new MockedDOMSource(mockConfig, hub, [], onEvents);
}
