import xs, {Stream} from 'xstream';
import {adapt} from '../cycle/run/adapt';

export interface EventBusSource {
  select(type?: string | string[]): any;
}

export interface BusEvent {
  type: string;
  data?: any;
}

export default function eventBusDriver(out$: Stream<BusEvent>): EventBusSource {
  const events = new EventTarget();

  out$.subscribe({
    next: (event: BusEvent) =>
      events.dispatchEvent(new CustomEvent('data', {detail: event})),
    error: (err: any) =>
      console.error('[EVENTS driver] Error in sink stream:', err),
  });

  return {
    select: (type?: string | string[]) => {
      const all = !type;
      const _type = Array.isArray(type) ? type : [type];
      let cb: ((e: Event) => void) | undefined;
      const in$ = xs.create<any>({
        start: (listener) => {
          cb = ({detail: event}: any) => {
            const data = (event && event.data) || null;
            if (all || _type.includes(event.type)) listener.next(data);
          };
          events.addEventListener('data', cb);
        },
        stop: () => {
          if (cb) events.removeEventListener('data', cb);
        },
      });

      return adapt(in$);
    },
  };
}
