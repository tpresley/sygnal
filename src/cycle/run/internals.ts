import xs, {Stream} from 'xstream';
import {adapt} from './adapt';
import {
  DevToolEnabledSource,
  DisposeFunction,
  Drivers,
  SinkProxies,
  Sources,
} from './types';

export function makeSinkProxies<D extends Drivers>(drivers: D): SinkProxies<D> {
  const sinkProxies: SinkProxies<D> = {} as SinkProxies<D>;
  for (const name in drivers) {
    if (Object.prototype.hasOwnProperty.call(drivers, name)) {
      (sinkProxies as any)[name] = xs.create<any>();
    }
  }
  return sinkProxies;
}

export function callDrivers<D extends Drivers>(
  drivers: D,
  sinkProxies: SinkProxies<D>
): Sources<D> {
  const sources: Sources<D> = {} as Sources<D>;
  for (const name in drivers) {
    if (Object.prototype.hasOwnProperty.call(drivers, name)) {
      (sources as any)[name] = (drivers[name] as any)((sinkProxies as any)[name], name);
      if ((sources as any)[name] && typeof (sources as any)[name] === 'object') {
        ((sources as any)[name] as DevToolEnabledSource)._isCycleSource = name;
      }
    }
  }
  return sources;
}

// NOTE: this will mutate `sources`.
export function adaptSources<So>(sources: So): So {
  for (const name in sources) {
    if (
      Object.prototype.hasOwnProperty.call(sources, name) &&
      (sources as any)[name] &&
      typeof ((sources as any)[name] as Stream<any>).shamefullySendNext ===
        'function'
    ) {
      (sources as any)[name] = adapt((sources as any)[name] as Stream<any>);
    }
  }
  return sources;
}

/**
 * Notice that we do not replicate 'complete' from real sinks, in
 * SinksReplicators and ReplicationBuffers.
 * Complete is triggered only on disposeReplication. See discussion in #425
 * for details.
 */
type SinkReplicators<Si> = {
  [P in keyof Si]: {
    next(x: any): void;
    _n?(x: any): void;
    error(err: any): void;
    _e?(err: any): void;
    complete(): void;
  };
};

type ReplicationBuffers<Si> = {
  [P in keyof Si]: {
    _n: Array<any>;
    _e: Array<any>;
  };
};

export function replicateMany<Si extends any>(
  sinks: Si,
  sinkProxies: SinkProxies<Si>
): DisposeFunction {
  const sinkNames: Array<keyof Si> = Object.keys(sinks as any).filter(
    name => !!(sinkProxies as any)[name]
  ) as Array<keyof Si>;

  let buffers: ReplicationBuffers<Si> = {} as ReplicationBuffers<Si>;
  const replicators: SinkReplicators<Si> = {} as SinkReplicators<Si>;
  sinkNames.forEach(name => {
    buffers[name] = {_n: [], _e: []};
    replicators[name] = {
      next: (x: any) => buffers[name]._n.push(x),
      error: (err: any) => buffers[name]._e.push(err),
      complete: () => {},
    };
  });

  const subscriptions = sinkNames.map(name =>
    xs.fromObservable(sinks[name] as any).subscribe(replicators[name])
  );

  sinkNames.forEach(name => {
    const listener = (sinkProxies as any)[name];
    const next = (x: any) => {
      queueMicrotask(() => listener._n(x));
    };
    const error = (err: any) => {
      queueMicrotask(() => {
        (console.error || console.log)(err);
        listener._e(err);
      });
    };
    buffers[name]._n.forEach(next);
    buffers[name]._e.forEach(error);
    replicators[name].next = next;
    replicators[name].error = error;
    // because sink.subscribe(replicator) had mutated replicator to add
    // _n, _e, _c, we must also update these:
    replicators[name]._n = next;
    replicators[name]._e = error;
  });
  buffers = null as any; // free up for GC

  return function disposeReplication() {
    subscriptions.forEach(s => s.unsubscribe());
  };
}

export function disposeSinkProxies<Si>(sinkProxies: SinkProxies<Si>) {
  Object.keys(sinkProxies as any).forEach(name => (sinkProxies as any)[name]._c());
}

export function disposeSources<So>(sources: So) {
  for (const k in sources) {
    if (
      Object.prototype.hasOwnProperty.call(sources, k) &&
      (sources as any)[k] &&
      (sources as any)[k].dispose
    ) {
      (sources as any)[k].dispose();
    }
  }
}

export function isObjectEmpty(obj: any): boolean {
  return Object.keys(obj).length === 0;
}
