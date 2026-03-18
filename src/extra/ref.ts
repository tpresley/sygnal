import xs from './xstreamCompat';
import type {MemoryStream} from 'xstream';

export interface Ref<T = HTMLElement> {
  current: T | null;
}

export interface Ref$<T = HTMLElement> extends Ref<T> {
  stream: MemoryStream<T | null>;
}

export function createRef<T = HTMLElement>(): Ref<T> {
  return { current: null };
}

export function createRef$<T = HTMLElement>(): Ref$<T> {
  const listener: { next: (val: T | null) => void } = { next: () => {} };
  const stream: MemoryStream<T | null> = xs.createWithMemory({
    start(l: any) { listener.next = (val) => l.next(val); },
    stop() { listener.next = () => {}; },
  });

  const ref: Ref$<T> = {
    current: null,
    stream,
  };

  return new Proxy(ref, {
    set(target, prop, value) {
      if (prop === 'current') {
        (target as any).current = value;
        listener.next(value);
        return true;
      }
      (target as any)[prop] = value;
      return true;
    },
  });
}
