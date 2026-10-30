// Import first in a worker entry. src/cycle/run/adapt.ts finds its global through `window`, then
// `global`, then `this`, and a module worker has none of them (`this` is undefined in a module):
// run() throws "Cannot read properties of undefined (reading 'Cyclejs')". The core fix is
// globalThis there (README §6); until then, `global` points at the worker's global.
;(globalThis as any).global ??= globalThis
export {}
