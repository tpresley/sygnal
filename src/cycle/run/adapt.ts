import {Stream} from 'xstream';

// globalThis: a module Web Worker has no `window` or `global`, and `this` is undefined in a
// module (research: dev-plans/research/web-worker)
function getGlobal(): any {
  let globalObj: any = globalThis;
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
