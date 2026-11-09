import xs, {Stream, MemoryStream} from 'xstream';
import {dropRepeats} from '../../extra/xstreamExtras';
import {DevToolEnabledSource} from '../run/types';
import {adapt} from '../run/adapt';
import {Getter, Setter, Scope, Reducer} from './types';
import {objIsEqual} from './objIsEqual';

function updateArrayEntry<T>(
  array: Array<T>,
  scope: number | string,
  newVal: any
): Array<T> {
  if (newVal === (array as any)[scope]) {
    return array;
  }
  const index = parseInt(scope as string);
  if (typeof newVal === 'undefined') {
    return array.filter((_val, i) => i !== index);
  }
  return array.map((val, i) => (i === index ? newVal : val));
}

function makeGetter<T, R>(scope: Scope<T, R>): Getter<T, R> {
  if (typeof scope === 'string' || typeof scope === 'number') {
    return (state: T | undefined) => (state as any)?.[scope];
  }
  return scope.get;
}

function makeSetter<T, R>(scope: Scope<T, R>): Setter<T, R> {
  if (typeof scope === 'string' || typeof scope === 'number') {
    return (state: T | undefined, childState: R | undefined): T =>
      Array.isArray(state)
        ? updateArrayEntry(state, scope, childState) as any
        : {...(state as any), [scope]: childState};
  }
  return scope.set;
}

/**
 * Represents a piece of application state dynamically changing over time.
 */
export class StateSource<S> {
  public stream: MemoryStream<S>;
  private _stream: MemoryStream<S>;
  private _name: string;
  private _end?: Stream<any>;

  // raw (P45-D): `stream` is another StateSource's stream mapped, already without undefined and
  // repeats (a component's own source), so one stream instead of four
  constructor(stream: Stream<S>, name: string, end?: Stream<any>, raw?: any) {
    this._end = end;
    this._stream = raw ? stream.remember() : stream
      .filter(s => typeof s !== 'undefined')
      .compose(dropRepeats())
      .remember();
    this._name = name;
    this.stream = adapt(this._stream);
    (this._stream as MemoryStream<S> &
      DevToolEnabledSource)._isCycleSource = name;
  }

  /**
   * Selects a part (or scope) of the state object and returns a new StateSource
   * dynamically representing that selected part of the state.
   */
  public select<R>(scope: Scope<S, R>): StateSource<R> {
    const get = makeGetter(scope);
    // G-214: keeps the end stream, so a selected source's watch() also ends on dispose
    return new StateSource<R>(this._stream.map(get) as Stream<R>, this._name, this._end);
  }

  /**
   * PLAN-4 GS-6: selector(state) whenever it changes structurally (objIsEqual). The current
   * value is the baseline, not a change, unless { immediate: true }. Ends with the state stream
   * or, for a component's own STATE source, when the component is disposed
   */
  public watch<R>(selector: (state: S) => R, {immediate}: {immediate?: boolean} = {}): Stream<R> {
    const s$ = this._stream.map(selector).compose(dropRepeats(objIsEqual)).endWhen(this._end || xs.never());
    return immediate ? s$ : s$.drop(1);
  }

  public isolateSource<R>(source: StateSource<S>, scope: Scope<S, R>): StateSource<R> {
    return source.select(scope);
  }

  public isolateSink<R>(innerReducer$: Stream<Reducer<R>>, scope: Scope<S, R>): Stream<Reducer<S>> {
    const get = makeGetter(scope);
    const set = makeSetter(scope);

    return innerReducer$.map(
      innerReducer =>
        function outerReducer(outer: S | undefined) {
          const prevInner = get(outer);
          const nextInner = innerReducer(prevInner);
          return prevInner === nextInner ? outer : set(outer, nextInner);
        }
    );
  }
}
