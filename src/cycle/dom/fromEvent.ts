import {Stream, Producer, Listener} from 'xstream';
import {deliver} from '../../shared';

export type Predicate = (ev: Event) => boolean;
export type Comparator = Record<string, unknown>;
export type PreventDefaultOpt = boolean | Predicate | Comparator;

/** a source's stream, named for the devtools graph */
export const named = (stream: any, name: string): any => {
  stream._isCycleSource = name;
  return stream;
};

export function fromEvent(
  element: Element | Document,
  eventName: string,
  useCapture = false,
  preventDefault: PreventDefaultOpt = false
): Stream<Event> {
  let next: ((e: Event) => void) | null = null;
  return Stream.create<Event>({
    start: function start(listener: Listener<Event>) {
      // (7.2: delivered with the event recorded for the core's onDispatch hook)
      next = function _next(event: Event) {
        preventDefaultConditional(event, preventDefault);
        deliver(event, () => listener.next(event));
      };
      // (passive false: a document's touch and wheel listeners are passive unless told otherwise)
      element.addEventListener(eventName, next, {capture: useCapture, passive: false});
    },
    stop: function stop() {
      element.removeEventListener(eventName, next as EventListener, useCapture);
      next = null;
    },
  } as Producer<Event>);
}

const isObj = (x: unknown) => typeof x === 'object' && x !== null;

function matchObject(matcher: Record<string, any>, obj: Record<string, any>): boolean {
  return Object.keys(matcher).every(k =>
    isObj(matcher[k]) && isObj(obj[k]) ? matchObject(matcher[k], obj[k]) : matcher[k] === obj[k]
  );
}

export function preventDefaultConditional(
  event: Event,
  preventDefault: PreventDefaultOpt
): void {
  if (
    preventDefault && (
      preventDefault === true ||
      (typeof preventDefault === 'function' ? preventDefault(event)
      : typeof preventDefault === 'object' ? matchObject(preventDefault, event)
      : fail())
    )
  ) event.preventDefault();
}

const fail = () => {
  throw new Error('preventDefault has to be either a boolean, predicate function or object');
};
