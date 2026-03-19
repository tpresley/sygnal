import {Stream} from 'xstream';

export interface EnrichedEventStream<T = Event> extends Stream<T> {
  value(fn?: (val: string) => any): Stream<any>;
  checked(fn?: (val: boolean) => any): Stream<any>;
  data(name: string, fn?: (val: string | undefined) => any): Stream<any>;
  target(fn?: (el: EventTarget | null) => any): Stream<any>;
  key(fn?: (key: string) => any): Stream<any>;
}

/**
 * Adds chainable convenience methods to a DOM event stream.
 *
 *   DOM.select('.input').events('input').value()
 *   DOM.input('.input').value()
 *   DOM.select('.item').events('click').data('id')
 *   DOM.click('.item').data('id', Number)
 *   DOM.change('.checkbox').checked()
 *   DOM.keydown('.field').key()
 */
export function enrichEventStream(stream$: any): any {
  // .value(fn?) — extract e.target.value
  stream$.value = function value(fn?: (val: any) => any): any {
    const mapped = stream$.map((e: any) => {
      const val = e?.target?.value
      return fn ? fn(val) : val
    });
    return enrichEventStream(mapped);
  }

  // .checked(fn?) — extract e.target.checked
  stream$.checked = function checked(fn?: (val: any) => any): any {
    const mapped = stream$.map((e: any) => {
      const val = !!e?.target?.checked
      return fn ? fn(val) : val
    });
    return enrichEventStream(mapped);
  }

  // .data(name, fn?) — extract e.target.dataset[name]
  stream$.data = function data(name: string, fn?: (val: any) => any): any {
    const mapped = stream$.map((e: any) => {
      const el = e?.target instanceof Element ? e.target.closest(`[data-${name}]`) || e.target : e?.target
      const val = el?.dataset?.[name]
      return fn ? fn(val) : val
    });
    return enrichEventStream(mapped);
  }

  // .target(fn?) — extract e.target
  stream$.target = function target(fn?: (el: any) => any): any {
    const mapped = stream$.map((e: any) => {
      const el = e?.target
      return fn ? fn(el) : el
    });
    return enrichEventStream(mapped);
  }

  // .key(fn?) — extract e.key (keyboard events)
  stream$.key = function key(fn?: (val: any) => any): any {
    const mapped = stream$.map((e: any) => {
      const val = e?.key
      return fn ? fn(val) : val
    });
    return enrichEventStream(mapped);
  }

  return stream$
}
