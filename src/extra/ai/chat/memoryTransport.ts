/*
 * PLAN-6 L-1 / L-4: an in-memory chat transport whose streams are driven by hand. renderComponent's
 * LLM fake runs the real chat driver over it (as the HTTP fake runs makeFetchDriver over an
 * in-memory fetch), and the driver's own tests use it. Internal: not exported from 'sygnal/ai'.
 *
 * memoryTransport({ onStream?, onIdle? }).stream(request, signal) returns an async iterable and
 * registers a handle synchronously (so a test sees it right after the sink emitted):
 *   handle.request, handle.signal, handle.live (not ended, failed or aborted), handle.aborted
 *   handle.push(...events)   ChatEvents, or strings (text deltas)
 *   handle.end(finish?)      a finish event ({ reason?, usage? }), then done
 *   handle.fail(error)       the iterator throws it
 * `onIdle(handle)` runs when the driver has consumed every queued event and waits for more (the
 * fake's "end of a frame").
 */

const toEvent = (c: any) => typeof c == 'string' ? {type: 'text', delta: c} : c;
const abortError = () => Object.assign(new Error('The operation was aborted.'), {name: 'AbortError'});

export function memoryTransport(opts: {onStream?: (h: any) => void; onIdle?: (h: any) => void} = {}) {
  const streams: any[] = [];
  const stream = (request: any, signal: AbortSignal) => {
    const queue: any[] = [];
    let ended = false, failed: any, waiting: any = null;
    const wake = () => {
      if (!waiting) return;
      const w = waiting;
      waiting = null;
      pull(w[0], w[1]);
    };
    const h: any = {
      request, signal, live: true, aborted: false,
      push: (...evs: any[]) => { if (h.live) { queue.push(...evs.map(toEvent)); wake(); } return h; },
      end: (finish?: any) => {
        if (h.live) { queue.push({type: 'finish', ...finish}); ended = true; h.live = false; wake(); }
        return h;
      },
      fail: (e: any) => {
        if (h.live) { failed = e ?? new Error('stream failed'); h.live = false; wake(); }
        return h;
      },
    };
    const pull = (resolve: any, reject: any) => {
      if (signal.aborted) return reject(abortError());
      if (queue.length) return resolve({value: queue.shift(), done: false});
      if (failed) return reject(failed);
      if (ended) return resolve({value: undefined, done: true});
      waiting = [resolve, reject];
      opts.onIdle?.(h);
    };
    signal.addEventListener('abort', () => { h.live = false; h.aborted = true; wake(); });
    streams.push(h);
    opts.onStream?.(h);
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise((resolve, reject) => pull(resolve, reject)),
        return: () => { h.live = false; return Promise.resolve({value: undefined, done: true}); },
      }),
    };
  };
  return {stream, streams};
}
