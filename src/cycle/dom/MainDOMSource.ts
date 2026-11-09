import {Stream, MemoryStream} from 'xstream';
import {DOMSource, EventsFnOptions} from './DOMSource';
import {DocumentDOMSource} from './DocumentDOMSource';
import {BodyDOMSource} from './BodyDOMSource';
import {VNode} from './snabbdom';
import {enrichEventStream, EnrichedEventStream} from './enrichEventStream';
import {findElements} from './ElementFinder';
import {makeIsolateSink, makeIsolateValue, getScopeObj, Scope, IsolateSink} from './isolate';
import {IsolateModule} from './IsolateModule';
import {EventDelegator} from './EventDelegator';
import {named} from './fromEvent';
// [diagnostics hook] no-op when diagnostics are off
import {onSelector} from '../../extra/diagnostics/index';

export interface SpecialSelector {
  body: BodyDOMSource;
  document: DocumentDOMSource;
}

export class MainDOMSource {
  constructor(
    private _rootElement$: Stream<Element>,
    private _sanitation$: Stream<null>,
    private _namespace: Array<Scope> = [],
    public _isolateModule: IsolateModule,
    private _eventDelegator: EventDelegator,
    private _name: string
  ) {
  }

  // (methods and lazily made functions, not closures per source: one source per instance)
  public isolateSource(source: MainDOMSource, scope: string): MainDOMSource {
    return source._at(source._namespace.concat(getScopeObj(scope)));
  }
  private _at(namespace: Array<Scope>): MainDOMSource {
    return new MainDOMSource(
      this._rootElement$,
      this._sanitation$,
      namespace,
      this._isolateModule,
      this._eventDelegator,
      this._name
    );
  }
  private _is?: IsolateSink<VNode>;
  private _iv?: (node: any, scope: string, memo?: any) => any;
  get isolateSink(): IsolateSink<VNode> { return this._is ||= makeIsolateSink(this._namespace) as any }
  get isolateValue(): (node: any, scope: string, memo?: any) => any { return this._iv ||= makeIsolateValue(this._namespace) }

  private _elements(): Stream<Array<Element>> {
    return this._namespace.length === 0
      ? this._rootElement$.map(x => [x])
      : this._rootElement$.map(() => findElements(this._namespace, this._isolateModule));
  }

  public elements(): MemoryStream<Array<Element>> {
    return named(this._elements().remember(), this._name);
  }

  public element(): MemoryStream<Element> {
    return named(this._elements().filter(arr => arr.length > 0).map(arr => arr[0]).remember(), this._name);
  }

  get namespace(): Array<Scope> {
    return this._namespace;
  }

  public select<T extends keyof SpecialSelector>(
    selector: T
  ): SpecialSelector[T];
  public select(selector: string): MainDOMSource;
  public select(selector: any): DOMSource {
    // CT-1: a control (controls()) selects its elements by its marker, [data-control="<Key>"]
    if (selector?.__sygnalControl) selector = '' + selector;
    if (typeof selector !== 'string') {
      throw new Error(
        `DOM driver's select() expects the argument to be a ` +
          `string as a CSS selector`
      );
    }
    if (selector === 'document') {
      return new DocumentDOMSource(this._name);
    }
    if (selector === 'body') {
      return new BodyDOMSource(this._name);
    }

    if (selector !== ':root') onSelector(this, selector.trim());

    return this._at(selector === ':root' ? [] : this._namespace.concat({type: 'selector', scope: selector.trim()})) as DOMSource;
  }

  public events<K extends keyof HTMLElementEventMap>(
    eventType: K,
    options?: EventsFnOptions,
    bubbles?: boolean
  ): EnrichedEventStream<HTMLElementEventMap[K]>;
  // PLAN-5 0-S6: any other name (a custom element's 'wa-hover', a widget's or element's
  // CustomEvent): the overload above only typed the built-in names (types only)
  public events(eventType: string, options?: EventsFnOptions, bubbles?: boolean): EnrichedEventStream<Event>;
  public events(
    eventType: string,
    options: EventsFnOptions = {},
    bubbles?: boolean
  ): EnrichedEventStream<Event> {
    if (typeof eventType !== `string`) {
      throw new Error(
        `DOM driver's events() expects argument to be a ` +
          `string representing the event type to listen for.`
      );
    }
    return named(enrichEventStream(this._eventDelegator.addEventListener(eventType, this._namespace, options, bubbles)), this._name);
  }

  public dispose(): void {
    this._sanitation$.shamefullySendNext(null);
  }

}
