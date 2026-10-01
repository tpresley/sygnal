import xs, {Stream} from 'xstream';

interface DriverFromAsyncOptions {
  selector?: string;
  args?: string | string[] | ((val: any) => any);
  return?: string;
  pre?: (val: any) => any;
  post?: (val: any, incoming?: any) => any;
}

/**
 * Create a driver from a promise-returning function.
 *
 * Each value the app sends to the driver calls the function (arguments picked
 * by `args`, after `pre`). The resolved value, after `post`, is delivered as
 * `{ [return]: value, [selector]: request[selector] }` (defaults:
 * `{ value, category }`) and read with `source.select(category)`. A promise
 * that resolves to `null`/`undefined` is delivered the same way.
 *
 * Errors: if the function's promise (or a promise returned by `post`)
 * rejects, or `post` throws, the error is delivered on `source.errors()`,
 * never on `select()`:
 *
 * ```js
 * // payload: { error, category: request.category, request }
 * intent: ({ QUOTE }) => ({
 *   GOT_QUOTE:   QUOTE.select('quote'),
 *   QUOTE_ERROR: QUOTE.errors('quote'),   // or .errors() / .errors(e => ...)
 * })
 * ```
 *
 * `errors(selector?)` filters like `select()`: no argument = all errors, a
 * string matches the request's selector property, a function is a predicate on
 * the error payload. While nothing listens to `errors()`, failures are only
 * logged with console.error (the pre-existing behavior).
 */
function driverFromAsync(
  promiseReturningFunction: (...args: any[]) => Promise<any>,
  opts: DriverFromAsyncOptions = {}
): (fromApp$: Stream<any>) => {select: (selector?: any) => Stream<any>; errors: (selector?: any) => Stream<any>} {
  const {
    selector: selectorProperty = 'category',
    args: functionArgs = 'value',
    return: returnProperty = 'value',
    pre: preFunction = (val: any) => val,
    post: postFunction = (val: any) => val,
  } = opts;

  const functionName = promiseReturningFunction.name || '[anonymous function]';
  const functionArgsType = typeof functionArgs;
  if (
    functionArgsType !== 'string' &&
    functionArgsType !== 'function' &&
    !(Array.isArray(functionArgs) && functionArgs.every((arg: any) => typeof arg === 'string'))
  ) {
    throw new Error(
      `The 'args' option for driverFromAsync(${functionName}) must be a string, array of strings, or a function.  Received ${functionArgsType}`
    );
  }

  if (typeof selectorProperty !== 'string') {
    throw new Error(
      `The 'selector' option for driverFromAsync(${functionName}) must be a string.  Received ${typeof selectorProperty}`
    );
  }

  return (fromApp$: Stream<any>) => {
    let sendFn: ((val: any) => void) | null = null;

    const toApp$ = xs.create<any>({
      start: (listener) => {
        sendFn = listener.next.bind(listener);
      },
      stop: () => {},
    });

    // Active errors(selector) streams (1H-6): an error goes to the ones it matches, and is
    // logged when none matches.
    const errorSubs = new Set<{listener: any; selector: any}>();
    const matches = (selector: any, val: any) =>
      selector === undefined ||
      (typeof selector === 'function' ? selector(val) : val?.[selectorProperty] === selector);
    const filterBy = (stream: Stream<any>, selector?: any) =>
      selector === undefined ? stream : stream.filter((val: any) => matches(selector, val));

    fromApp$.addListener({
      next: (incoming: any) => {
        const preProcessed = preFunction(incoming);
        let argArr: any[] = [];
        if (typeof preProcessed === 'object' && preProcessed !== null) {
          if (typeof functionArgs === 'function') {
            const extractedArgs = functionArgs(preProcessed);
            argArr = Array.isArray(extractedArgs) ? extractedArgs : [extractedArgs];
          }
          if (typeof functionArgs === 'string') {
            argArr = [preProcessed[functionArgs]];
          }
          if (Array.isArray(functionArgs)) {
            argArr = functionArgs.map((arg: string) => preProcessed[arg]);
          }
        }
        const errMsg = `Error in driver created using driverFromAsync(${functionName})`;
        const constructReply = (rawVal: any) => {
          let outgoing: any;
          if (returnProperty === undefined) {
            outgoing = rawVal;
            if (typeof outgoing === 'object' && outgoing !== null) {
              outgoing[selectorProperty] = incoming[selectorProperty];
            } else {
              console.warn(
                `The 'return' option for driverFromAsync(${functionName}) was not set, but the promise returned an non-object.  The result will be returned as-is, but the '${selectorProperty}' property will not be set, so will not be filtered by the 'select' method of the driver.`
              );
            }
          } else if (typeof returnProperty === 'string') {
            outgoing = {
              [returnProperty]: rawVal,
              [selectorProperty]: incoming[selectorProperty],
            };
          } else {
            throw new Error(
              `The 'return' option for driverFromAsync(${functionName}) must be a string.  Received ${typeof returnProperty}`
            );
          }
          return outgoing;
        };
        // Rejections (of the function, a thenable it resolves to, or post()) go to errors();
        // an error no active errors() selector matches is logged, as before.
        const reportError = (err: any) => {
          const val = {error: err, [selectorProperty]: incoming?.[selectorProperty], request: incoming};
          let handled = false;
          errorSubs.forEach(sub => {
            let hit = false;
            try { hit = matches(sub.selector, val); } catch (_) {}
            if (hit) {
              handled = true;
              sub.listener.next(val);
            }
          });
          if (!handled) console.error(`${errMsg}: ${err}`);
        };
        const isThenable = (val: any) => val != null && typeof val.then === 'function';
        promiseReturningFunction(...argArr)
          .then((innerVal: any) =>
            isThenable(innerVal)
              ? innerVal.then((innerOutgoing: any) => postFunction(innerOutgoing, incoming))
              : postFunction(innerVal, incoming)
          )
          .then(constructReply)
          .then((reply: any) => {
            try {
              sendFn!(reply);
            } catch (err) {
              console.error(`${errMsg}: ${err}`);
            }
          }, reportError);
      },
      error: (err: any) => {
        console.error(
          `Error received from sink stream in driver created using driverFromAsync(${functionName}):`,
          err
        );
      },
      complete: () => {
        console.warn(
          `Unexpected completion of sink stream to driver created using driverFromAsync(${functionName})`
        );
      },
    });

    return {
      select: (selector?: any) => filterBy(toApp$, selector),
      errors: (selector?: any) => {
        let sub: any;
        return xs.create<any>({
          start: (listener) => {
            errorSubs.add((sub = {listener, selector}));
          },
          stop: () => {
            errorSubs.delete(sub);
          },
        });
      },
    };
  };
}

export {driverFromAsync};
