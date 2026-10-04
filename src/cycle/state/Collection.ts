import xs, {Stream} from 'xstream';
import {adapt} from '../run/adapt';
import isolate from '../isolate/index';
import {pickMerge} from './pickMerge';
import {pickCombine} from './pickCombine';
import {StateSource} from './StateSource';
import {uidPart} from '../../shared';
import {B, tearDown} from '../run/scheduler';
import {
  InternalInstances,
  Lens,
  ItemKeyFn,
  ItemScopeFn,
  ItemFactoryFn,
} from './types';

/**
 * An object representing all instances in a collection of components. Has the
 * methods pickCombine and pickMerge to get the combined sinks of all instances.
 */
export class Instances<Si> {
  private _instances$: Stream<InternalInstances<Si>>;
  private _s?: (f: () => void) => void;

  constructor(instances$: Stream<InternalInstances<Si>>, s?: (f: () => void) => void) {
    this._instances$ = instances$;
    this._s = s;
  }

  public pickMerge(selector: string): Stream<any> {
    return adapt(this._instances$.compose(pickMerge(selector)));
  }

  public pickCombine(selector: string): Stream<Array<any>> {
    return adapt(this._instances$.compose(pickCombine(selector, this._s)));
  }
}

interface BaseOptions<S, So, Si> {
  collectSinks(instances: Instances<Si>): any;
  itemKey?: ItemKeyFn<S>;
  itemScope?: ItemScopeFn;
  channel?: string;
}

interface HomogenousOptions<S, So, Si> extends BaseOptions<S, So, Si> {
  item(so: So): Si;
  itemFactory?: never;
}

interface HeterogenousOptions<S, So, Si> extends BaseOptions<S, So, Si> {
  item?: never;
  itemFactory: ItemFactoryFn<S, So, Si>;
}

export type CollectionOptions<S, So, Si> =
  | HomogenousOptions<S, So, Si>
  | HeterogenousOptions<S, So, Si>;

function defaultItemScope(key: string) {
  return {'*': null};
}

function instanceLens(
  itemKey: ItemKeyFn<any>,
  key: string
): Lens<Array<any>, any> {
  // PLAN-4 PF-1: the scan starts at the item's last index, so the lookup is O(1) while the
  // order doesn't change (a scan from 0 for each of n items made every state change O(n²))
  let last = 0;
  return {
    get(arr: Array<any> | undefined): any {
      if (typeof arr === 'undefined') {
        return void 0;
      } else {
        for (let j = 0, n = arr.length, i; j < n; ++j) {
          if (`${itemKey(arr[(i = (j + last) % n)], i)}` === key) {
            return arr[(last = i)];
          }
        }
        return void 0;
      }
    },

    set(arr: Array<any> | undefined, item: any): any {
      if (typeof arr === 'undefined') {
        return [item];
      } else if (typeof item === 'undefined') {
        return arr.filter((s, i) => `${itemKey(s, i)}` !== key);
      } else {
        return arr.map((s, i) => {
          if (`${itemKey(s, i)}` === key) {
            return item;
          } else {
            return s;
          }
        });
      }
    },
  };
}

const identityLens = {
  get: <T>(outer: T) => outer,
  set: <T>(outer: T, inner: T) => inner,
};

export function makeCollection<S, So = any, Si = any>(
  opts: CollectionOptions<S, So, Si>
) {
  return function collectionComponent(sources: any) {
    const name = opts.channel || 'state';
    const itemKey = opts.itemKey;
    const itemScope = opts.itemScope || defaultItemScope;
    const state$ = xs.fromObservable((sources[name] as StateSource<S>).stream);
    const dict = new Map();
    let disposed = false;
    const instances$ = state$.fold(
      (acc: InternalInstances<Si>, nextState: Array<any> | any) => {
        if (disposed) return acc;
        if (Array.isArray(nextState)) {
          const nextInstArray = Array(nextState.length) as Array<
            Si & {_key: string}
          >;
          const nextKeys = new Set<string>();
          // add
          for (let i = 0, n = nextState.length; i < n; ++i) {
            const key = `${itemKey ? itemKey(nextState[i], i) : i}`;
            nextKeys.add(key);
            if (!dict.has(key)) {
              const stateScope = itemKey ? instanceLens(itemKey, key) : `${i}`;
              const otherScopes = itemScope(key);
              const scopes =
                typeof otherScopes === 'string'
                  ? {'*': otherScopes, [name]: stateScope}
                  : {...otherScopes, [name]: stateScope};
              const itemComp = opts.itemFactory
                ? opts.itemFactory(nextState[i], i)
                : opts.item;
              // PLAN-4 GS-9: an item's uid is the Collection's + its key
              const sinks: any = isolate(itemComp, scopes)({...sources, __uid: (sources.__uid || 'u') + '-' + uidPart(key)});
              dict.set(key, sinks);
              nextInstArray[i] = sinks;
            } else {
              nextInstArray[i] = dict.get(key) as any;
            }
            nextInstArray[i]._key = key;
          }
          // remove (P45-D: the removed items' streams stop in one batch)
          tearDown(() => dict.forEach((sinks, key) => {
            if (!nextKeys.has(key)) {
              sinks?.__dispose?.();
              dict.delete(key);
            }
          }));
          nextKeys.clear();
          return {dict: dict, arr: nextInstArray};
        } else {
          tearDown(() => dict.forEach((sinks) => sinks?.__dispose?.()));
          dict.clear();
          const key = `${itemKey ? itemKey(nextState, 0) : 'this'}`;
          const stateScope = identityLens;
          const otherScopes = itemScope(key);
          const scopes =
            typeof otherScopes === 'string'
              ? {'*': otherScopes, [name]: stateScope}
              : {...otherScopes, [name]: stateScope};
          const itemComp = opts.itemFactory
            ? opts.itemFactory(nextState, 0)
            : opts.item;
          const sinks: any = isolate(itemComp, scopes)(sources);
          dict.set(key, sinks);
          return {dict: dict, arr: [sinks]};
        }
      },
      {dict, arr: []} as InternalInstances<Si>
    );
    // P45-C: the app's render scheduler; the items are at depth __d, the Collection one above
    // (G-262: __d is undefined in a root's own sources)
    const k = sources.__k, sinks = opts.collectSinks(new Instances<Si>(instances$, k && ((f: () => void) => k(B - (sources.__d | 0) + 1, f))));
    // B-024: disposing the collection (its owner was disposed or stopped rendering it)
    // disposes every live item, and so their subtrees
    sinks.__dispose = () => {
      disposed = true;
      tearDown(() => dict.forEach((s: any) => s.__dispose?.()));
      dict.clear();
    };
    return sinks;
  };
}
