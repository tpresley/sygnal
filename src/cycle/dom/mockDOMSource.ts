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

/** Optional listener-registration callback (renderComponent's SYG103/104 checks) */
export type MockOnEvents = (path: string[], eventType: string) => void;

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
    const {_hub: hub, _path: path} = this;
    if (this._onEvents) this._onEvents(path, eventType);
    const out: DevToolEnabledSource & FantasyObservable<any> = enrichEventStream(adapt(
      hub
        ? xs.merge(
            configured ? xs.fromObservable(configured) : xs.empty(),
            hub.filter(e => e.type === eventType && e.match(path)).map(e => e.event)
          )
        : configured || xs.empty()
    ));

    out._isCycleSource = 'MockedDOM';

    return out;
  }

  public select(selector: string): MockedDOMSource {
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

  public isolateSink(sink: any, scope: string): any {
    return adapt(
      xs.fromObservable<any>(sink).map((vnode: VNode) => {
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
