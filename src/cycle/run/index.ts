import {
  CycleProgram,
  DisposeFunction,
  Drivers,
  Sinks,
  MatchingDrivers,
  MatchingMain,
  Engine,
} from './types';
import {
  adaptSources,
  callDrivers,
  makeSinkProxies,
  disposeSources,
  disposeSinkProxies,
  isObjectEmpty,
  replicateMany,
} from './internals';

export {
  FantasyObserver,
  FantasySubscription,
  FantasyObservable,
  DevToolEnabledSource,
  Sources,
  Sinks,
  SinkProxies,
  Driver,
  Drivers,
  DisposeFunction,
  MatchingDrivers,
  MatchingMain,
  Main,
  CycleProgram,
  Engine,
  WidenStream,
  GetValidInputs,
} from './types';

/**
 * A function that prepares the Cycle application to be executed. Takes a `main`
 * function and prepares to circularly connects it to the given collection of
 * driver functions. As an output, `setup()` returns an object with three
 * properties: `sources`, `sinks` and `run`. Only when `run()` is called will
 * the application actually execute. Refer to the documentation of `run()` for
 * more details.
 *
 * @param {Function} main a function that takes `sources` as input and outputs `sinks`.
 * @param {Object} drivers an object where keys are driver names and values are driver functions.
 * @return {Object} an object with three properties: `sources`, `sinks` and `run`.
 * @function setup
 */
export function setup<
  D extends MatchingDrivers<D, M>,
  M extends MatchingMain<D, M>
>(main: M, drivers: D): CycleProgram<D, M> {
  if (typeof main !== `function`) {
    throw new Error(
      `First argument given to Cycle must be the 'main' ` + `function.`
    );
  }
  if (typeof drivers !== `object` || drivers === null) {
    throw new Error(
      `Second argument given to Cycle must be an object ` +
        `with driver functions as properties.`
    );
  }
  if (isObjectEmpty(drivers)) {
    throw new Error(
      `Second argument given to Cycle must be an object ` +
        `with at least one driver function declared as a property.`
    );
  }

  const engine = setupReusable(drivers);
  const sinks = main(engine.sources);
  if (typeof window !== 'undefined') {
    window.Cyclejs = window.Cyclejs || {};
    window.Cyclejs.sinks = sinks;
  }
  function _run(): DisposeFunction {
    const disposeRun = engine.run(sinks);
    return function dispose() {
      disposeRun();
      engine.dispose();
    };
  }
  return {sinks, sources: engine.sources, run: _run};
}

/**
 * A partially-applied variant of setup() which accepts only the drivers, and
 * allows many `main` functions to execute and reuse this same set of drivers.
 *
 * @param {Object} drivers an object where keys are driver names and values are driver functions.
 * @return {Object} an object with three properties: `sources`, `run` and `dispose`.
 * @function setupReusable
 */
export function setupReusable<D extends Drivers>(drivers: D): Engine<D> {
  if (typeof drivers !== `object` || drivers === null) {
    throw new Error(
      `Argument given to setupReusable must be an object ` +
        `with driver functions as properties.`
    );
  }
  if (isObjectEmpty(drivers)) {
    throw new Error(
      `Argument given to setupReusable must be an object ` +
        `with at least one driver function declared as a property.`
    );
  }

  const sinkProxies = makeSinkProxies(drivers);
  const rawSources = callDrivers(drivers, sinkProxies);
  const sources = adaptSources(rawSources);
  function _run<M extends MatchingMain<D, M>>(
    sinks: Sinks<M>
  ): DisposeFunction {
    return replicateMany(sinks, sinkProxies as any);
  }
  function disposeEngine() {
    disposeSources(sources);
    disposeSinkProxies(sinkProxies);
  }
  return {sources, run: _run, dispose: disposeEngine};
}

/**
 * Takes a `main` function and circularly connects it to the given collection
 * of driver functions.
 *
 * @param {Function} main a function that takes `sources` as input and outputs `sinks`.
 * @param {Object} drivers an object where keys are driver names and values are driver functions.
 * @return {Function} a dispose function, used to terminate the execution of the Cycle.js program.
 * @function run
 */
export function run<
  D extends MatchingDrivers<D, M>,
  M extends MatchingMain<D, M>
>(main: M, drivers: D): DisposeFunction {
  const program = setup(main, drivers);
  if (
    typeof window !== 'undefined' &&
    window.CyclejsDevTool_startGraphSerializer
  ) {
    window.CyclejsDevTool_startGraphSerializer(program.sinks);
  }
  return program.run();
}

export default run;
