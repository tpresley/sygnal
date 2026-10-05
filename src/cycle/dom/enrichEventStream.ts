import {Stream} from 'xstream';

export interface EnrichedEventStream<T = Event> extends Stream<T> {
  value(): EnrichedEventStream<string>;
  value<R>(fn: (val: string) => R): EnrichedEventStream<R>;

  checked(): EnrichedEventStream<boolean>;
  checked<R>(fn: (val: boolean) => R): EnrichedEventStream<R>;

  data(name: string): EnrichedEventStream<string | undefined>;
  data<R>(name: string, fn: (val: string | undefined) => R): EnrichedEventStream<R>;

  target(): EnrichedEventStream<EventTarget | null>;
  target<R>(fn: (el: EventTarget | null) => R): EnrichedEventStream<R>;

  key(): EnrichedEventStream<string>;
  key<R>(fn: (key: string) => R): EnrichedEventStream<R>;

  /** e.detail: a CustomEvent's payload (a widget's emit(name, detail), a web component's event) */
  detail<D = any>(): EnrichedEventStream<D>;
  detail<R, D = any>(fn: (detail: D) => R): EnrichedEventStream<R>;
}

// one enricher: a method that maps each event through `get`, then `fn` when given
const pick = (s$: any, get: (e: any) => any) => (fn?: (v: any) => any): any =>
  enrichEventStream(s$.map((e: any) => (e = get(e), fn ? fn(e) : e)))

/**
 * Adds chainable convenience methods to a DOM event stream.
 *
 *   DOM.select('.input').events('input').value()
 *   DOM.input('.input').value()
 *   DOM.select('.item').events('click').data('id')
 *   DOM.click('.item').data('id', Number)
 *   DOM.change('.checkbox').checked()
 *   DOM.keydown('.field').key()
 *   DOM.select('.due').events('change').detail()
 */
export function enrichEventStream(stream$: any): any {
  // .value(fn?) — e.target.value; .checked(fn?) — e.target.checked as a boolean
  stream$.value = pick(stream$, (e: any) => e?.target?.value)
  stream$.checked = pick(stream$, (e: any) => !!e?.target?.checked)
  // .data(name, fn?) — dataset[name] from e.target or its nearest ancestor that has it.
  // dataset keys are camelCase but attributes are kebab-case (`taskId` is `data-task-id`), so the
  // closest() selector converts (B-028). The name may be given either way: `.data('taskId')` and
  // `.data('task-id')` read the same attribute (3E/R3).
  stream$.data = (name: string, fn?: (v: any) => any): any => {
    const key = String(name).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    const attr = `[data-${key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}]`
    return pick(stream$, (e: any) => {
      const t = e?.target
      const el = typeof t?.closest == 'function' ? t.closest(attr) || t : t
      return el?.dataset?.[key]
    })(fn)
  }
  // .target(fn?) — e.target; .key(fn?) — e.key (keyboard events)
  stream$.target = pick(stream$, (e: any) => e?.target)
  stream$.key = pick(stream$, (e: any) => e?.key)
  // .detail(fn?) — e.detail (CustomEvents: widgets' emit(), web components) (PLAN-5 W-3)
  stream$.detail = pick(stream$, (e: any) => e?.detail)
  return stream$
}
