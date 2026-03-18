import xs, {Stream, resolveInteropDefault} from './extra/xstreamCompat';
import * as dropRepeatsModule from 'xstream/extra/dropRepeats';
import {h} from './cycle/dom/index';

const dropRepeats = resolveInteropDefault(dropRepeatsModule);

interface SwitchableOptions {
  switched?: string | string[];
  stateSourceName?: string;
}

export default function switchable(
  factories: Record<string, (sources: any) => any>,
  name$: any,
  initial: string,
  opts: SwitchableOptions = {}
): (sources: any) => any {
  const {switched = ['DOM'], stateSourceName = 'STATE'} = opts;
  const nameType = typeof name$;

  if (!name$) throw new Error(`Missing 'name$' parameter for switchable()`);
  if (
    !(
      nameType === 'string' ||
      nameType === 'function' ||
      name$ instanceof Stream
    )
  ) {
    throw new Error(
      `Invalid 'name$' parameter for switchable(): expects Stream, String, or Function`
    );
  }

  if (name$ instanceof Stream) {
    const withInitial$ = name$
      .compose(dropRepeats())
      .startWith(initial)
      .remember();
    return (sources: any) =>
      _switchable(factories, sources, withInitial$, switched);
  } else {
    const mapFunction =
      (nameType === 'function' && (name$ as (state: any) => string)) ||
      ((state: any) => state[name$ as string]);
    return (sources: any) => {
      const state$ =
        sources &&
        (
          (typeof stateSourceName === 'string' && sources[stateSourceName]) ||
          sources.STATE ||
          sources.state
        ).stream;
      if (!(state$ instanceof Stream))
        throw new Error(`Could not find the state source: ${stateSourceName}`);
      const _name$ = state$
        .map(mapFunction)
        .filter((name: any) => typeof name === 'string')
        .compose(dropRepeats())
        .startWith(initial)
        .remember();
      return _switchable(factories, sources, _name$, switched, stateSourceName);
    };
  }
}

function _switchable(
  factories: Record<string, (sources: any) => any>,
  sources: any,
  name$: any,
  switched: string | string[] = ['DOM'],
  stateSourceName: string = 'STATE'
): Record<string, any> {
  if (typeof switched === 'string') switched = [switched];

  const sinks = Object.entries(factories).map(([name, factory]) => {
    if (sources[stateSourceName]) {
      const state$ = sources[stateSourceName].stream;
      const switchedState = xs
        .combine(name$, state$)
        .filter(([newComponentName]: [string, any]) => newComponentName == name)
        .map(([, state]: [string, any]) => state)
        .remember();

      const state = new sources[stateSourceName].constructor(
        switchedState,
        sources[stateSourceName]._name
      );
      return [name, factory({...sources, state})] as [string, any];
    }
    return [name, factory(sources)] as [string, any];
  });

  const switchedSinks = Object.keys(sources).reduce<Record<string, any>>(
    (obj, sinkName) => {
      if ((switched as string[]).includes(sinkName)) {
        obj[sinkName] = name$
          .map((newComponentName: string) => {
            const sink = sinks.find(
              ([componentName]) => componentName === newComponentName
            );
            return (sink && sink[1][sinkName]) || xs.never();
          })
          .flatten()
          .remember()
          .startWith(undefined);
      } else {
        const definedSinks = sinks
          .filter(([, sink]) => sink[sinkName] !== undefined)
          .map(([, sink]) => sink[sinkName]);
        obj[sinkName] = xs.merge(...definedSinks);
      }
      return obj;
    },
    {}
  );

  return switchedSinks;
}

const Switchable = (props: any) => {
  const {children, ...sanitizedProps} = props;
  return h('switchable', {props: sanitizedProps}, children);
};
(Switchable as any).label = 'switchable';
(Switchable as any).preventInstantiation = true;

export {Switchable};
