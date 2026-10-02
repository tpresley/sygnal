import xs, {Stream} from './extra/xstreamCompat';
import {dropRepeats} from './extra/xstreamExtras';
import {h} from './cycle/dom/index';
import {fail} from './extra/diagnostics/legacy';


interface SwitchableOptions {
  switched?: string | string[];
  stateSourceName?: string;
}

const NAME_FIX = 'Pass a stream, a state key string, or a state => name function';

export default function switchable(
  factories: Record<string, (sources: any) => any>,
  name$: any,
  initial: string,
  opts: SwitchableOptions = {}
): (sources: any) => any {
  const {switched = ['DOM'], stateSourceName = 'STATE'} = opts;
  const nameType = typeof name$;

  if (!name$) fail('SYG419', 'switchable', "Missing 'name$' parameter", NAME_FIX);
  if (
    !(
      nameType === 'string' ||
      nameType === 'function' ||
      name$ instanceof Stream
    )
  ) {
    fail('SYG419', 'switchable', `Invalid 'name$' parameter: got ${nameType}`, NAME_FIX);
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
        fail('SYG607', 'switchable', `State source '${stateSourceName}' not found`, 'Pass the state source in sources, or set stateSourceName');
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
      // G-121: a hidden component gets no state updates (it stays subscribed, so it would
      // otherwise re-render on every change); it gets the current state when shown again.
      // `state` stays as the marker inspect() uses for a Switchable's components.
      return [name, factory({...sources, state, [stateSourceName]: state})] as [string, any];
    }
    return [name, factory(sources)] as [string, any];
  });

  // G-120: forward every sink a component produces, not just the ones that are also sources
  // (PARENT). READY stays out: the parent treats the switchable as ready, as before.
  const names = new Set(Object.keys(sources));
  sinks.forEach(([, sink]) => Object.keys(sink).forEach((n) => names.add(n)));
  // G-121: keep each component's switched sinks (DOM) subscribed for the switchable's
  // lifetime. Unsubscribed, a hidden page's stream chain is torn down one setTimeout per
  // operator; switching back mid-teardown restarts it half-way, it never re-emits, and the
  // switchable stays on the previous page. Kept alive, switching emits the page's last value.
  const keepAlive: Array<[any, any]> = [];
  const switchedSinks = [...names].reduce<Record<string, any>>(
    (obj, sinkName) => {
      if (sinkName.startsWith('__') || sinkName === 'READY') return obj;
      if ((switched as string[]).includes(sinkName)) {
        const live: Record<string, any> = {};
        sinks.forEach(([componentName, sink]) => {
          if (!sink[sinkName]) return;
          const listener = {next() {}, error() {}, complete() {}};
          live[componentName] = sink[sinkName].remember();
          live[componentName].addListener(listener);
          keepAlive.push([live[componentName], listener]);
        });
        obj[sinkName] = name$
          .map((newComponentName: string) => live[newComponentName] || xs.never())
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
  // B-024: every factory was instantiated above; dispose them all with the switchable
  switchedSinks.__dispose = () => {
    keepAlive.forEach(([stream, listener]) => stream.removeListener(listener));
    sinks.forEach(([, s]) => s.__dispose?.());
  };

  return switchedSinks;
}

const Switchable = (props: any) => {
  const {children, ...sanitizedProps} = props;
  return h('switchable', {props: sanitizedProps}, children);
};
(Switchable as any).label = 'switchable';
(Switchable as any).preventInstantiation = true;

export {Switchable};
