import {Stream, Producer, Listener} from 'xstream';

export type Predicate = (ev: Event) => boolean;
export type Comparator = Record<string, unknown>;
export type PreventDefaultOpt = boolean | Predicate | Comparator;

export function fromEvent(
  element: Element | Document,
  eventName: string,
  useCapture = false,
  preventDefault: PreventDefaultOpt = false,
  passive = false
): Stream<Event> {
  let next: ((e: Event) => void) | null = null;
  return Stream.create<Event>({
    start: function start(listener: Listener<Event>) {
      if (preventDefault) {
        next = function _next(event: Event) {
          preventDefaultConditional(event, preventDefault);
          listener.next(event);
        };
      } else {
        next = function _next(event: Event) {
          listener.next(event);
        };
      }
      element.addEventListener(eventName, next, {
        capture: useCapture,
        passive,
      });
    },
    stop: function stop() {
      element.removeEventListener(eventName, next as EventListener, useCapture);
      next = null;
    },
  } as Producer<Event>);
}

function matchObject(matcher: Record<string, unknown>, obj: Record<string, unknown>): boolean {
  const keys = Object.keys(matcher);
  const n = keys.length;
  for (let i = 0; i < n; i++) {
    const k = keys[i];
    if (typeof matcher[k] === 'object' && matcher[k] !== null && typeof obj[k] === 'object' && obj[k] !== null) {
      if (!matchObject(matcher[k] as Record<string, unknown>, obj[k] as Record<string, unknown>)) {
        return false;
      }
    } else if (matcher[k] !== obj[k]) {
      return false;
    }
  }
  return true;
}

export function preventDefaultConditional(
  event: Event,
  preventDefault: PreventDefaultOpt
): void {
  if (preventDefault) {
    if (typeof preventDefault === 'boolean') {
      event.preventDefault();
    } else if (isPredicate(preventDefault)) {
      if (preventDefault(event)) {
        event.preventDefault();
      }
    } else if (typeof preventDefault === 'object') {
      if (matchObject(preventDefault as Record<string, unknown>, event as unknown as Record<string, unknown>)) {
        event.preventDefault();
      }
    } else {
      throw new Error(
        'preventDefault has to be either a boolean, predicate function or object'
      );
    }
  }
}

function isPredicate(fn: PreventDefaultOpt): fn is Predicate {
  return typeof fn === 'function';
}
