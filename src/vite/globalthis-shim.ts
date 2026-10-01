/**
 * Stand-in for the `globalthis` npm package (built to dist/shims/globalthis.cjs).
 *
 * xstream does `require('globalthis').getPolyfill()`, which pulls a polyfill
 * chain (define-properties, get-intrinsic, object-keys, has-symbols, ...) into
 * every app bundle (~4 KB gzip). Every browser and Node version Sygnal supports
 * has a native `globalThis`, so `sygnal/vite` aliases `globalthis` to this
 * module (opt out with `sygnal({ nativeGlobalThis: false })`).
 *
 * Same shape as the package's main export (the es-shim API): a function that
 * returns the global object, with `getPolyfill`, `implementation` and `shim`.
 */
const getGlobal: any = () => globalThis
getGlobal.getPolyfill = getGlobal
getGlobal.implementation = globalThis
getGlobal.shim = getGlobal

export default getGlobal
