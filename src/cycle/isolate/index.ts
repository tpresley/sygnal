import xs, {Stream} from 'xstream';
import {adapt} from '../run/adapt';
export type Component<So, Si> = (sources: So, ...rest: Array<any>) => Si;

export type FirstArg<
  T extends (r: any, ...args: Array<any>) => any
> = T extends (r: infer R, ...args: Array<any>) => any ? R : any;

export type IsolateableSource<A = any, B = any> = {
  isolateSource(
    source: IsolateableSource<A, B>,
    scope: any
  ): IsolateableSource<A, B>;
  isolateSink(sink: A, scope: any): B;
};

export type Sources = {
  [name: string]: IsolateableSource;
};

export type WildcardScope = {
  ['*']?: string;
};

export type ScopesPerChannel<So> = {[K in keyof So]: any};

export type Scopes<So> =
  | (Partial<ScopesPerChannel<So>> & WildcardScope)
  | string;

function checkIsolateArgs<So, Si>(
  dataflowComponent: Component<So, Si>,
  scope: any
) {
  if (typeof dataflowComponent !== `function`) {
    throw new Error(
      `First argument given to isolate() must be a ` +
        `'dataflowComponent' function`
    );
  }
  if (scope === null) {
    throw new Error(`Second argument given to isolate() must not be null`);
  }
}

function normalizeScopes<So>(
  sources: So,
  scopes: Scopes<So>,
  randomScope: string
): ScopesPerChannel<So> {
  const perChannel = {} as ScopesPerChannel<So>;
  Object.keys(sources).forEach(channel => {
    if (typeof scopes === 'string') {
      perChannel[channel] = scopes;
      return;
    }
    const candidate = (scopes as ScopesPerChannel<So>)[channel];
    if (typeof candidate !== 'undefined') {
      perChannel[channel] = candidate;
      return;
    }
    const wildcard = (scopes as WildcardScope)['*'];
    if (typeof wildcard !== 'undefined') {
      perChannel[channel] = wildcard;
      return;
    }
    perChannel[channel] = randomScope;
  });
  return perChannel;
}

function isolateAllSources<So extends Sources>(
  outerSources: So,
  scopes: ScopesPerChannel<So>
): So {
  const innerSources = {} as So;
  for (const channel in outerSources) {
    const outerSource = outerSources[channel] as IsolateableSource;
    if (
      outerSources.hasOwnProperty(channel) &&
      outerSource &&
      scopes[channel] !== null &&
      typeof outerSource.isolateSource === 'function'
    ) {
      innerSources[channel] = outerSource.isolateSource(
        outerSource,
        scopes[channel]
      ) as any;
    } else if (outerSources.hasOwnProperty(channel)) {
      innerSources[channel] = outerSources[channel];
    }
  }
  return innerSources;
}

function isolateAllSinks<So extends Sources, Si>(
  sources: So,
  innerSinks: Si,
  scopes: ScopesPerChannel<So>
): Si {
  const outerSinks = {} as Si;
  for (const channel in innerSinks) {
    const source = sources[channel] as IsolateableSource;
    const innerSink = innerSinks[channel];
    if (
      innerSinks.hasOwnProperty(channel) &&
      source &&
      scopes[channel] !== null &&
      typeof source.isolateSink === 'function'
    ) {
      outerSinks[channel] = adapt(
        source.isolateSink(xs.fromObservable(innerSink as any), scopes[channel])
      );
    } else if (innerSinks.hasOwnProperty(channel)) {
      outerSinks[channel] = innerSinks[channel];
    }
  }
  return outerSinks;
}

export type OuterSo<ISo> = {
  [K in keyof ISo]: ISo[K] extends IsolateableSource
    ? FirstArg<IsolateableSource['isolateSource']>
    : ISo[K]
};

export type OuterSi<ISo, ISi> = {
  [K in keyof ISo & keyof ISi]: ISo[K] extends IsolateableSource
    ? (ReturnType<ISo[K]['isolateSink']> extends Stream<infer T>
        ? Stream<T>
        : (ReturnType<ISo[K]['isolateSink']> extends Stream<any>
            ? Stream<unknown>
            : unknown))
    : ISi[K]
} &
  {[K in Exclude<keyof ISi, keyof ISo>]: ISi[K]};

let counter = 0;
function newScope(): string {
  return `cycle${++counter}`;
}

/**
 * Takes a `component` function and a `scope`, and returns an isolated version
 * of the `component` function.
 *
 * When the isolated component is invoked, each source provided to it is
 * isolated to the given `scope` using `source.isolateSource(source, scope)`,
 * if possible. Likewise, the sinks returned from the isolated component are
 * isolated to the given `scope` using `source.isolateSink(sink, scope)`.
 *
 * @param {Function} component a function that takes `sources` as input and outputs a collection of `sinks`.
 * @param {String} scope an optional string that is used to isolate each `sources` and `sinks`.
 * @return {Function} the scoped component function.
 * @function isolate
 */
function isolate<InnerSo, InnerSi>(
  component: Component<InnerSo, InnerSi>,
  scope: any = newScope()
): Component<OuterSo<InnerSo>, OuterSi<InnerSo, InnerSi>> {
  checkIsolateArgs(component, scope);
  const randomScope = typeof scope === 'object' ? newScope() : '';
  const scopes: any =
    typeof scope === 'string' || typeof scope === 'object'
      ? scope
      : scope.toString();
  return function wrappedComponent(
    outerSources: OuterSo<InnerSo>,
    ...rest: Array<any>
  ): OuterSi<InnerSo, InnerSi> {
    const scopesPerChannel = normalizeScopes(outerSources, scopes, randomScope);
    const innerSources = isolateAllSources(
      outerSources as any,
      scopesPerChannel
    );
    const innerSinks = component(innerSources, ...rest);
    const outerSinks = isolateAllSinks(
      outerSources as any,
      innerSinks,
      scopesPerChannel
    );
    return outerSinks as any;
  };
}

(isolate as any).reset = () => (counter = 0);

export default isolate;

export function toIsolated<InnerSo, InnerSi>(
  scope: any = newScope()
): (
  c: Component<InnerSo, InnerSi>
) => Component<OuterSo<InnerSo>, OuterSi<InnerSo, InnerSi>> {
  return component => isolate(component, scope);
}
