// sygnal/replay: an inert driver for a source whose answers come from the recording. Its source
// accepts any call chain (DND.dragstart('task').data('taskId'), STORE.get('todos', []), ...)
// and every stream in it is xs.never(); its sink is drained and ignored.
import xs from '../xstreamCompat'

const NONE = /^(__|isolate|then$|toJSON$|constructor$|replies$)/

export function inertSource(): any {
  const s = xs.never()
  return new Proxy(s, {
    get(target: any, k) {
      if (typeof k == 'symbol' || k in target) return Reflect.get(target, k, target)
      if (NONE.test(k)) return undefined
      return () => inertSource()
    },
  })
}

export const inertDriver = () => (sink$: any) => {
  if (sink$ && typeof sink$.addListener == 'function') sink$.addListener({next() {}, error() {}, complete() {}})
  return inertSource()
}
