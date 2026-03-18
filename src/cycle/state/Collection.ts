import xs, {Stream} from 'xstream';
import {adapt} from '../run/adapt';
import isolate from '../isolate/index';
import {pickMerge} from './pickMerge';
import {pickCombine} from './pickCombine';
import {StateSource} from './StateSource';
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

  constructor(instances$: Stream<InternalInstances<Si>>) {
    this._instances$ = instances$;
  }

  public pickMerge(selector: string): Stream<any> {
    return adapt(this._instances$.compose(pickMerge(selector)));
  }

  public pickCombine(selector: string): Stream<Array<any>> {
    return adapt(this._instances$.compose(pickCombine(selector)));
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
  return {
    get(arr: Array<any> | undefined): any {
      if (typeof arr === 'undefined') {
        return void 0;
      } else {
        for (let i = 0, n = arr.length; i < n; ++i) {
          if (`${itemKey(arr[i], i)}` === key) {
            return arr[i];
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
    const instances$ = state$.fold(
      (acc: InternalInstances<Si>, nextState: Array<any> | any) => {
        const dict = acc.dict;
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
              const sinks: any = isolate(itemComp, scopes)(sources);
              dict.set(key, sinks);
              nextInstArray[i] = sinks;
            } else {
              nextInstArray[i] = dict.get(key) as any;
            }
            nextInstArray[i]._key = key;
          }
          // remove
          dict.forEach((_, key) => {
            if (!nextKeys.has(key)) {
              dict.delete(key);
            }
          });
          nextKeys.clear();
          return {dict: dict, arr: nextInstArray};
        } else {
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
      {dict: new Map(), arr: []} as InternalInstances<Si>
    );
    return opts.collectSinks(new Instances<Si>(instances$));
  };
}
