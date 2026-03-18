import {Stream} from 'xstream';

export default function logDriver(out$: Stream<any>): void {
  out$.addListener({
    next: (val: any) => {
      console.log(val);
    },
    error: (err: any) => {
      console.error('[LOG driver] Error in sink stream:', err);
    },
  });
}
