import xs from 'xstream';
import {error as logError} from './diagnostics/legacy';

/*
 * PLAN-3 routed requests: the shared part of every routing-capable driver
 * (makeFetchDriver, driverFromAsync, the socket driver).
 *
 * - The core stamps each object a component sends to a source marked
 *   `__sygnalRoutes: true` with the sending instance (`__emitterId`, the same
 *   non-enumerable stamp EVENTS gets), and merges `source.routed(instance)` into
 *   that instance's actions.
 * - A request that names `ok` / `error` actions from a stamped sender is routed:
 *   the driver answers it with `reply(sender, type, data)`, which reaches exactly
 *   that instance (never select()/errors()).
 * - When the instance stops listening (disposed), `onStop(sender)` lets the
 *   driver abort what it still has in flight for it.
 */

const SENDER = '__emitterId';

/** the instance that sent a request (undefined when it wasn't sent by a component) */
export const senderOf = (req: any) => req[SENDER];

/** `to` (a copy of `from`) with `from`'s sender stamp (a spread drops non-enumerables) */
export const keepSender = (from: any, to: any) => {
  if (from[SENDER] !== undefined) Object.defineProperty(to, SENDER, {value: from[SENDER]});
  return to;
};

/**
 * D57: a request object with a `then` / `catch` key is a thenable (it breaks `await`), so
 * routing drivers refuse it (SYG610). True when the request may be sent.
 */
export const allowed = (req: any, driver: string) =>
  !('then' in req || 'catch' in req) ||
  logError('SYG610', req.__emitterName, `${driver}: request not sent: it has a 'then'/'catch' key`, "Use ok: 'ACTION' / error: 'ACTION'", req);

/** the routed-reply half of a driver's source */
export const makeRoutes = (onStop?: (sender: any) => void) => {
  const routes = new Map<any, any>();
  return {
    routes: {
      __sygnalRoutes: true,
      routed: (sender: any) => xs.create<any>({
        start: l => { routes.set(sender, l); },
        stop: () => { routes.delete(sender); onStop?.(sender); },
      }),
    },
    /** deliver `{ type, data }` to the sender's actions (dropped when it's gone) */
    reply: (sender: any, type: any, data: any) => { routes.get(sender)?.next({type, data}); },
  };
};
