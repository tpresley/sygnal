import {Stream} from 'xstream';

declare var window: any;
declare var global: any;

function getGlobal(this: any): any {
  let globalObj: any;
  if (typeof window !== 'undefined') {
    globalObj = window;
  } else if (typeof global !== 'undefined') {
    globalObj = global;
  } else {
    globalObj = this;
  }
  globalObj.Cyclejs = globalObj.Cyclejs || {};
  globalObj = globalObj.Cyclejs;
  globalObj.adaptStream = globalObj.adaptStream || ((x: any) => x);
  return globalObj;
}

export interface AdaptStream {
  (s: Stream<any>): any;
}

export function setAdapt(f: AdaptStream): void {
  getGlobal().adaptStream = f;
}

export function adapt(stream: Stream<any>): any {
  return getGlobal().adaptStream(stream);
}
