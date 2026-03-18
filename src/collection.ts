import isolate from './cycle/isolate/index';
import {makeCollection} from './cycle/state/index';
import {h} from './cycle/dom/index';
import type {Lens} from './cycle/state/types';

let COLLECTION_COUNT = 0;

interface CollectionOptions {
  combineList?: string[];
  globalList?: string[];
  stateSourceName?: string;
  domSourceName?: string;
  container?: string;
  containerClass?: string;
}

export default function collection(
  component: (...args: any[]) => any,
  stateLense: string | Lens<any, any>,
  opts: CollectionOptions = {}
): (sources: any) => any {
  if (typeof component !== 'function') {
    throw new Error('collection: first argument (component) must be a function');
  }
  const {
    combineList = ['DOM'],
    globalList = ['EVENTS'],
    stateSourceName = 'STATE',
    domSourceName = 'DOM',
    container = 'div',
    containerClass,
  } = opts;

  return (sources: any) => {
    const key = `sygnal-collection-${COLLECTION_COUNT++}`;
    const collectionOpts = {
      item: component,
      itemKey: (state: any, ind: number) =>
        typeof state.id !== 'undefined' ? state.id : ind,
      itemScope: (key: any) => key,
      channel: stateSourceName,
      collectSinks: (instances: any) => {
        return Object.entries(sources).reduce<Record<string, any>>(
          (acc, [name]) => {
            if (combineList.includes(name)) {
              const combined = instances.pickCombine(name);
              if (name === domSourceName && container) {
                acc[domSourceName] = combined.map((children: any) => {
                  const data = containerClass
                    ? {props: {className: containerClass}}
                    : {};
                  return {
                    sel: container,
                    data,
                    children,
                    key,
                    text: undefined,
                    elm: undefined,
                  };
                });
              } else {
                acc[name] = combined;
              }
            } else {
              acc[name] = instances.pickMerge(name);
            }
            return acc;
          },
          {}
        );
      },
    };

    const isolateOpts: Record<string, any> = {[stateSourceName]: stateLense};

    globalList.forEach((global) => (isolateOpts[global] = null));
    combineList.forEach((combine) => (isolateOpts[combine] = null));

    return makeIsolatedCollection(collectionOpts, isolateOpts, sources);
  };
}

function makeIsolatedCollection(
  collectionOpts: any,
  isolateOpts: any,
  sources: any
): any {
  return isolate(makeCollection(collectionOpts), isolateOpts)(sources);
}

const Collection = (props: any) => {
  const {children, ...sanitizedProps} = props;
  return h('collection', {props: sanitizedProps}, children);
};
(Collection as any).label = 'collection';
(Collection as any).preventInstantiation = true;

export {Collection};
