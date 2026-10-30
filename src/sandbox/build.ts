/*
 * The guest kernel, built from the app's installed packages (README §7 option (a), §9 Q1; D209:
 * Sygnal's npm package never ships xstream or snabbdom prebuilt into it). sygnal/vite resolves
 * `sygnal/sandbox/kernel?raw` to this function's output (the project's own Vite), and
 * `buildSandboxKernel()` (sygnal/sandbox/build) does it for other toolchains (Vite, esbuild or
 * Rollup, whichever the project has).
 *
 * The output is one script: the platform prelude (timers, console, microtasks on `__host`,
 * which the core's modules read when they load), then dist/sandbox-kernel.esm.js bundled as an
 * IIFE with the installed sygnal (dist/index.esm.js and dist/host.esm.js of the same package: one
 * core), xstream and snabbdom. `process.env.NODE_ENV` is 'production'; xstream's `globalthis`
 * dependency is Sygnal's shim (as sygnal/vite does, G-099).
 */
import {nodeImport} from './quickjs'

// The platform a bare QuickJS context lacks. A plain script, so it runs before the bundle's modules.
export const PLATFORM = `var global = globalThis;
(function () {
  var H = globalThis.__host, G = globalThis, timers = new Map(), intervals = new Map(), seq = 0;
  G.__sandboxTimers = timers;
  G.queueMicrotask = G.queueMicrotask || function (f) { Promise.resolve().then(f) };
  G.setTimeout = function (f, ms) { var id = ++seq; timers.set(id, f); H.timer(id, +ms || 0); return id };
  G.clearTimeout = function (id) { if (timers.delete(id)) H.clearTimer(id) };
  // the core's macrotask hop (runtime.ts macro()): its own channel, so a component's timers can't starve it
  G.setImmediate = function (f) { var id = ++seq; timers.set(id, f); H.timer(id, -1); return id };
  G.clearImmediate = G.clearTimeout;
  G.setInterval = function (f, ms) { var box = {}; var tick = function () { box.id = G.setTimeout(tick, ms); f() }; box.id = G.setTimeout(tick, ms); var id = ++seq; intervals.set(id, box); return id };
  G.clearInterval = function (id) { var b = intervals.get(id); if (b) { intervals.delete(id); G.clearTimeout(b.id) } };
  G.requestAnimationFrame = function (f) { return G.setTimeout(function () { f(Date.now()) }, 16) };
  G.cancelAnimationFrame = G.clearTimeout;
  var fmt = function (a) { return a.map(function (x) { if (typeof x == 'string') return x; if (x instanceof Error) return x.name + ': ' + x.message; try { return JSON.stringify(x) } catch (e) { return String(x) } }).join(' ') };
  G.console = {
    log: function () { H.log('log', fmt([].slice.call(arguments))) }, info: function () { H.log('log', fmt([].slice.call(arguments))) },
    warn: function () { H.log('warn', fmt([].slice.call(arguments))) }, error: function () { H.log('error', fmt([].slice.call(arguments))) },
    debug: function () {},
  };
})();
`

export interface BuildSandboxKernelOptions {
  /** where the app's packages are installed (default: process.cwd()) */
  root?: string
  /** 'auto' (default): the project's Vite, else esbuild, else Rollup */
  bundler?: 'auto' | 'vite' | 'esbuild' | 'rollup'
  /** default true */
  minify?: boolean
}

/** The guest kernel script for createSandbox / <Sandboxed> (`kernel`), built from the installed packages */
export async function buildSandboxKernel(opts: BuildSandboxKernelOptions = {}): Promise<string> {
  const [path, {createRequire}, {pathToFileURL}, fs] = await Promise.all([nodeImport('node:path'), nodeImport('node:module'), nodeImport('node:url'), nodeImport('node:fs')])
  const root: string = path.resolve(opts.root || (globalThis as any).process.cwd())
  const fromRoot = createRequire(path.join(root, 'package.json'))
  // the app's sygnal (else this one): its dist/ holds the kernel entry, the core and the kit
  let main: string
  try { main = fromRoot.resolve('sygnal') } catch { main = createRequire(import.meta.url).resolve('sygnal') }
  const dist = path.dirname(main)
  const entry = path.join(dist, 'sandbox-kernel.esm.js')
  const files = {
    sygnal: path.join(dist, 'index.esm.js'),
    'sygnal/host': path.join(dist, 'host.esm.js'),
    globalthis: path.join(dist, 'shims/globalthis.cjs'),
  }
  for (const f of [entry, ...Object.values(files)]) if (!fs.existsSync(f)) throw new Error(`buildSandboxKernel: ${f} is missing (an incomplete sygnal install?)`)
  const minify = opts.minify !== false
  const define = {'process.env.NODE_ENV': '"production"'}
  const has = (name: string) => { try { fromRoot.resolve(name); return true } catch { return false } }
  const want = opts.bundler || 'auto'
  const bundler = want !== 'auto' ? want : has('vite') ? 'vite' : has('esbuild') ? 'esbuild' : has('rollup') ? 'rollup' : null
  if (!bundler) throw new Error('buildSandboxKernel: needs vite, esbuild or rollup installed in ' + root)
  const load = (name: string) => import(/* @vite-ignore */ pathToFileURL(resolveEsm(fromRoot, fs, path, name)).href)
  let code: string

  if (bundler === 'esbuild') {
    const esbuild = await load('esbuild')
    const r = await (esbuild.build || esbuild.default.build)({
      entryPoints: [entry], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020',
      minify, define, alias: files, logLevel: 'silent', legalComments: 'none',
    })
    code = r.outputFiles[0].text
  } else if (bundler === 'rollup') {
    const {rollup} = await load('rollup')
    const plugins: any[] = [{
      name: 'sygnal-kernel', resolveId: (id: string) => (files as any)[id] || null,
      transform: (c: string) => (c.includes('process.env.NODE_ENV') ? c.split('process.env.NODE_ENV').join(define['process.env.NODE_ENV']) : null),
    }]
    const req = async (n: string) => { const m = await load(n); return m.default || m }
    if (has('@rollup/plugin-node-resolve')) plugins.push((await load('@rollup/plugin-node-resolve')).nodeResolve({browser: true}))
    if (has('@rollup/plugin-commonjs')) plugins.push((await req('@rollup/plugin-commonjs'))())
    if (minify && has('@rollup/plugin-terser')) plugins.push((await req('@rollup/plugin-terser'))({ecma: 2020}))
    const b = await rollup({input: entry, plugins, onwarn: () => {}})
    code = (await b.generate({format: 'iife', name: '__sygnalKernel'})).output[0].code
    await b.close()
  } else {
    const vite = await load('vite')
    const out: any = await vite.build({
      configFile: false, root, logLevel: 'silent', mode: 'production', define,
      resolve: {alias: Object.entries(files).map(([find, replacement]) => ({find: new RegExp(`^${find.replace('/', '\\/')}$`), replacement}))},
      build: {write: false, minify, target: 'es2020', lib: {entry, formats: ['iife'], name: '__sygnalKernel', fileName: () => 'kernel.js'}, rollupOptions: {output: {inlineDynamicImports: true}}},
    })
    const o = (Array.isArray(out) ? out[0] : out).output
    code = o.find((c: any) => c.type === 'chunk').code
  }
  return PLATFORM + code
}

// a package's ESM entry, as resolved from the app (import() needs a file URL, not a bare name, to resolve from there)
function resolveEsm(req: any, fs: any, path: any, name: string): string {
  try {
    const pj = req.resolve(`${name}/package.json`)
    const pkg = JSON.parse(fs.readFileSync(pj, 'utf8'))
    const dot = typeof pkg.exports == 'string' ? pkg.exports : pkg.exports?.['.']
    let e = typeof dot == 'string' ? dot : dot?.import ?? pkg.module ?? pkg.main ?? 'index.js'
    if (e && typeof e == 'object') e = e.default
    return path.join(path.dirname(pj), e)
  } catch {
    return req.resolve(name)
  }
}
