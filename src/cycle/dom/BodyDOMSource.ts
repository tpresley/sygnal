import xs, {Stream, MemoryStream} from 'xstream';
import {EventsFnOptions} from './DOMSource';
import {fromEvent, named} from './fromEvent';

export class BodyDOMSource {
  constructor(private _name: string) {}

  public select(selector: string): BodyDOMSource {
    return this;
  }

  public elements(): MemoryStream<Array<HTMLBodyElement>> {
    return named(xs.of([document.body]), this._name);
  }

  public element(): MemoryStream<HTMLBodyElement> {
    return named(xs.of(document.body), this._name);
  }

  public events<K extends keyof HTMLBodyElementEventMap>(
    eventType: K,
    options?: EventsFnOptions,
    bubbles?: boolean
  ): Stream<HTMLBodyElementEventMap[K]>;
  public events(
    eventType: string,
    options: EventsFnOptions = {},
    bubbles?: boolean
  ): Stream<Event> {
    return named(fromEvent(document.body, eventType, options.useCapture, options.preventDefault), this._name);
  }
}
