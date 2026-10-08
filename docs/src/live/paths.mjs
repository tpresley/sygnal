// Live-file paths, shared by the build (remark-live), the compiler and the browser runtime
// (without Babel: the runtime imports this, not compile.mjs, for unedited code).

export const isRelative = (spec) => /^\.{0,2}\//.test(spec)

const BASE = 'http://live/'

/** a live-file path as a key: './SalesChart.js' -> '/SalesChart.js' */
export const fileKey = (path, from = '/') => new URL(path, BASE + String(from).replace(/^\//, '')).pathname

/**
 * The live-file a relative specifier names, or undefined: exact, with an extension added, or a
 * `.js` specifier for a .ts / .tsx / .jsx file (TypeScript's convention)
 * @param {string} spec  @param {string} from the importing module's key  @param {(key: string) => boolean} has
 */
export function resolveLiveFile(spec, from, has) {
  const path = fileKey(spec, from)
  const tries = [...['', '.js', '.jsx', '.ts', '.tsx'].map((e) => path + e), ...(/\.js$/.test(path) ? ['.ts', '.tsx', '.jsx'].map((e) => path.replace(/\.js$/, e)) : [])]
  return tries.find(has)
}
