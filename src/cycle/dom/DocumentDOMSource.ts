import xs, {Stream, MemoryStream} from 'xstream';
import {EventsFnOptions} from './DOMSource';
import {fromEvent, named} from './fromEvent';
import {enrichEventStream, EnrichedEventStream} from './enrichEventStream';

export class DocumentDOMSource {
  private _selector: string | null;

  constructor(private _name: string, selector?: string) {
    this._selector = selector || null;
  }

  // CT-1: a control works as is: querySelectorAll() and matches() stringify their argument,
  // and a control stringifies to its selector
  public select(selector: string): DocumentDOMSource {
    return new DocumentDOMSource(this._name, selector);
  }

  public elements(): MemoryStream<Array<Document | Element>> {
    return named(xs.of(this._selector ? Array.from(document.querySelectorAll(this._selector)) : [document]), this._name);
  }

  public element(): MemoryStream<Document | Element | null> {
    return named(xs.of(this._selector ? document.querySelector(this._selector) : document), this._name);
  }

  public events<K extends keyof DocumentEventMap>(
    eventType: K,
    options?: EventsFnOptions,
    bubbles?: boolean
  ): EnrichedEventStream<DocumentEventMap[K]>;
  // PLAN-5 0-S6: any other name (a custom element's 'wa-hover', a widget's or element's
  // CustomEvent): the overload above only typed the built-in names (types only)
  public events(eventType: string, options?: EventsFnOptions, bubbles?: boolean): EnrichedEventStream<Event>;
  public events(
    eventType: string,
    options: EventsFnOptions = {},
    bubbles?: boolean
  ): EnrichedEventStream<Event> {
    const selector = this._selector;
    let stream: Stream<Event> = fromEvent(document, eventType, options.useCapture, options.preventDefault);
    if (selector) stream = stream.filter((ev: Event) => ev.target instanceof Element && ev.target.closest(selector) !== null);
    return named(enrichEventStream(stream), this._name);
  }
}
