import xs, {Stream} from 'xstream';

interface DriverFromAsyncOptions {
  selector?: string;
  args?: string | string[] | ((val: any) => any);
  return?: string;
  pre?: (val: any) => any;
  post?: (val: any, incoming?: any) => any;
}

function driverFromAsync(
  promiseReturningFunction: (...args: any[]) => Promise<any>,
  opts: DriverFromAsyncOptions = {}
): (fromApp$: Stream<any>) => {select: (selector?: any) => Stream<any>} {
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
        promiseReturningFunction(...argArr)
          .then((innerVal: any) => {
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

            if (typeof innerVal.then === 'function') {
              innerVal
                .then((innerOutgoing: any) => {
                  const processedOutgoing = postFunction(innerOutgoing, incoming);
                  if (typeof processedOutgoing.then === 'function') {
                    processedOutgoing
                      .then((innerProcessedOutgoing: any) => {
                        sendFn!(constructReply(innerProcessedOutgoing));
                      })
                      .catch((err: any) => console.error(`${errMsg}: ${err}`));
                  } else {
                    sendFn!(constructReply(processedOutgoing));
                  }
                })
                .catch((err: any) => console.error(`${errMsg}: ${err}`));
            } else {
              const processedOutgoing = postFunction(innerVal, incoming);
              if (typeof processedOutgoing.then === 'function') {
                processedOutgoing
                  .then((innerProcessedOutgoing: any) => {
                    sendFn!(constructReply(innerProcessedOutgoing));
                  })
                  .catch((err: any) => console.error(`${errMsg}: ${err}`));
              } else {
                sendFn!(constructReply(processedOutgoing));
              }
            }
          })
          .catch((err: any) => console.error(`${errMsg}: ${err}`));
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
      select: (selector?: any) => {
        if (selector === undefined) return toApp$;
        if (typeof selector === 'function') return toApp$.filter(selector);
        return toApp$.filter((val: any) => val?.[selectorProperty] === selector);
      },
    };
  };
}

export {driverFromAsync};
