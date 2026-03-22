import xs, {Stream, MemoryStream} from 'xstream';
import {adapt} from '../run/adapt';
import {DevToolEnabledSource} from '../run/types';
import {EventsFnOptions} from './DOMSource';
import {fromEvent} from './fromEvent';
import {enrichEventStream, EnrichedEventStream} from './enrichEventStream';

export class DocumentDOMSource {
  private _selector: string | null;

  constructor(private _name: string, selector?: string) {
    this._selector = selector || null;
  }

  public select(selector: string): DocumentDOMSource {
    return new DocumentDOMSource(this._name, selector);
  }

  public elements(): MemoryStream<Array<Document | Element>> {
    if (this._selector) {
      const out: DevToolEnabledSource & MemoryStream<Array<Element>> = adapt(
        xs.of(Array.from(document.querySelectorAll(this._selector)))
      );
      out._isCycleSource = this._name;
      return out;
    }
    const out: DevToolEnabledSource & MemoryStream<Array<Document>> = adapt(
      xs.of([document])
    );
    out._isCycleSource = this._name;
    return out;
  }

  public element(): MemoryStream<Document | Element | null> {
    if (this._selector) {
      const out: DevToolEnabledSource & MemoryStream<Element | null> = adapt(
        xs.of(document.querySelector(this._selector))
      );
      out._isCycleSource = this._name;
      return out;
    }
    const out: DevToolEnabledSource & MemoryStream<Document> = adapt(
      xs.of(document)
    );
    out._isCycleSource = this._name;
    return out;
  }

  public events<K extends keyof DocumentEventMap>(
    eventType: K,
    options?: EventsFnOptions,
    bubbles?: boolean
  ): EnrichedEventStream<DocumentEventMap[K]>;
  public events(
    eventType: string,
    options: EventsFnOptions = {},
    bubbles?: boolean
  ): EnrichedEventStream<Event> {
    let stream: Stream<Event>;

    stream = fromEvent(
      document,
      eventType,
      options.useCapture,
      options.preventDefault
    );

    if (this._selector) {
      const selector = this._selector;
      stream = stream.filter((ev: Event) => {
        const target = ev.target;
        if (!(target instanceof Element)) return false;
        return target.matches(selector) || target.closest(selector) !== null;
      });
    }

    const out: DevToolEnabledSource & EnrichedEventStream<Event> = enrichEventStream(adapt(stream));
    out._isCycleSource = this._name;
    return out as EnrichedEventStream<Event>;
  }
}
