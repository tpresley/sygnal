/**
 * sygnal/vite's `api` option (sygnal/api, dev preview; research: dev-plans/research/fullstack-contracts/):
 *
 * - `handler`: in dev, requests under `prefix` go to that module's default export, a Fetch handler
 *   (Request → Response): the same module a production server mounts. The plugin only bridges
 *   Node's request to it; the server is the app's own (oRPC), never one of Sygnal's.
 * - `contracts`: in client code (dev and build, never Vitest) each listed contract module is
 *   replaced by what orpcClient needs of it (routes, kinds, error codes and statuses) with its
 *   contractHash computed at build time, so the bundle has no schema library. The module is
 *   evaluated on the server side (the dev server's SSR loader; for `vite build` a temporary one).
 *   An export that is no contract is left out, so a client import of a schema from it fails
 *   loudly (keep the module out of `contracts` to validate on the client).
 * - `functions`: `*.server.ts` files under `dir` (function-first). In client code a file becomes
 *   stubs: `export const list = __serverFunction('quotes.list', { kind, errors }, client)`, plus
 *   the file's contract hash in the stub header. Nothing else of the file (its imports, secrets,
 *   handler bodies) is in the client graph. In server code and under Vitest the file keeps its
 *   code and each export gets its id appended, so tests can call it as an endpoint.
 */
// @ts-ignore
import path from 'node:path'
// @ts-ignore
import fs from 'node:fs'
// @ts-ignore
import { createRequire } from 'node:module'
// @ts-ignore
import { pathToFileURL } from 'node:url'
// @ts-ignore
import { Readable } from 'node:stream'
import { contractManifest, fnFiles, fnNamespace } from '../extra/api/contract'

export interface ApiPluginOptions {
  handler?: string
  prefix?: string
  contracts?: string[]
  functions?: boolean | { dir?: string; header?: string }
}

const SERVER_FILE = /\.server\.[cm]?[jt]sx?$/
// set while the temporary build-time server loads the config: its own sygnal() then adds no api plugin
const NESTED = '__SYGNAL_API_EVAL__'
const g: any = globalThis
const nodeProcess: any = g.process

export function apiPlugin(o: ApiPluginOptions) {
  if (g[NESTED]) return null
  const prefix = (o.prefix ?? '/api').replace(/\/+$/, '')
  const fo = o.functions === true ? {} : o.functions || null
  const dir = (fo && fo.dir) || 'src'
  const header = (fo && fo.header) || 'x-api-functions'
  let root: string = nodeProcess.cwd()
  let isVitest = false
  let config: any
  let dev: any
  let temp: Promise<any> | undefined

  const rel = (file: string) => path.relative(root, file).split(path.sep).join('/')
  const contractFiles = () => new Set((o.contracts || []).map((f) => path.resolve(root, f)))
  const isFnFile = (file: string) => {
    if (!fo || !SERVER_FILE.test(file) || file.includes('/node_modules/')) return false
    const r = rel(file)
    return !r.startsWith('..') && (r + '/').startsWith(dir.replace(/^\.?\/+|\/+$/g, '') + '/')
  }

  // evaluates a module on the server side: the dev server's SSR loader, or (vite build) a temporary one
  async function load(file: string) {
    if (dev) return dev.ssrLoadModule(file)
    temp ??= (async () => {
      const vite = await import(/* @vite-ignore */ projectVite(root))
      g[NESTED] = true
      try {
        return await vite.createServer({
          root, mode: config?.mode, configFile: config?.configFile ?? false, logLevel: 'warn', appType: 'custom',
          server: { middlewareMode: true, hmr: false, ws: false, watch: null },
          optimizeDeps: { noDiscovery: true, include: [] },
        })
      } finally { delete g[NESTED] }
    })()
    return (await temp).ssrLoadModule(file)
  }

  const exportLine = (name: string, value: string) => (name === 'default' ? `export default ${value};` : `export const ${name} = ${value};`)

  return {
    name: 'vite-plugin-sygnal:api',

    config() {
      isVitest = !!nodeProcess?.env?.VITEST
    },
    configResolved(c: any) {
      config = c
      root = c.root
    },
    configureServer(server: any) {
      dev = server
      if (!o.handler || isVitest) return
      const handlerFile = path.resolve(root, o.handler)
      server.middlewares.use(async (req: any, res: any, next: any) => {
        const url: string = req.url || ''
        if (!(url === prefix || url.startsWith(prefix + '/') || url.startsWith(prefix + '?'))) return next()
        try {
          const mod = await server.ssrLoadModule(handlerFile)
          const handle = typeof mod.default === 'function' ? mod.default : mod.default?.fetch ?? mod.fetch
          if (typeof handle !== 'function') throw new Error(`[sygnal] api.handler (${o.handler}) must export default a Fetch handler: (request: Request) => Response`)
          const ctl = new AbortController()
          res.on('close', () => ctl.abort())
          const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : (Readable as any).toWeb(req)
          const request = new Request(new URL(url, 'http://' + (req.headers.host || 'localhost')), {
            method: req.method, headers: req.headers, body, signal: ctl.signal, ...(body && { duplex: 'half' }),
          } as RequestInit)
          const response: Response = await handle(request)
          res.writeHead(response.status, Object.fromEntries(response.headers as any))
          if (!response.body) return void res.end()
          ;(Readable as any).fromWeb(response.body).pipe(res)
        } catch (e) { next(e) }
      })
    },

    async transform(this: any, code: string, id: string, opts?: { ssr?: boolean }) {
      const file = id.split('?')[0]
      if (id.startsWith('\0')) return null
      const client = !opts?.ssr && !isVitest
      if (client && o.contracts && contractFiles().has(file)) {
        const mod = await load(file)
        const out: string[] = []
        Object.keys(mod).forEach((name) => {
          const { manifest, hash, count } = contractManifest(mod[name])
          if (!count) return
          out.push(exportLine(name, `Object.defineProperty(${JSON.stringify(manifest)}, '~hash', { value: ${JSON.stringify(hash)} })`))
        })
        return { code: `// ${rel(file)}: routes and hash only (sygnal/vite api.contracts)\n${out.join('\n')}\n`, map: { mappings: '' } }
      }
      if (!isFnFile(file)) return null
      if (client) {
        const [f] = fnFiles({ [rel(file)]: await load(file) }, dir)
        const opts = JSON.stringify({ prefix, headers: { [header]: `${f.ns}:${f.hash}` } })
        const lines = f.fns.map(([name, meta]: [string, any]) => {
          const errors: any = {}
          Object.keys(meta.errors || {}).forEach((c) => { errors[c] = { status: meta.errors[c]?.status } })
          return exportLine(name, `__serverFunction(${JSON.stringify(f.keys.concat(name).join('.'))}, ${JSON.stringify({ kind: meta.kind, errors })}, __o)`)
        })
        return {
          code: `// ${rel(file)}: client stubs (sygnal/vite api.functions)\nimport { __serverFunction } from 'sygnal/api';\nconst __o = ${opts};\n${lines.join('\n')}\n`,
          map: { mappings: '' },
        }
      }
      // server code and tests: the module as written, each export given its id
      const ns = fnNamespace(rel(file), dir)
      const named = exportedLocals(this.parse(code))
      if (!named.length) return null
      const keys = ns.split('/')
      const tail = named.map(([exp, local]) => `__sygnalFn(${JSON.stringify(keys.concat(exp).join('.'))}, ${local}, ${JSON.stringify({ prefix })});`)
      return { code: `${code}\nimport { __serverFunction as __sygnalFn } from 'sygnal/api';\n${tail.join('\n')}\n`, map: null }
    },

    async closeBundle() {
      if (temp) { const s = await temp; temp = undefined; await s.close() }
    },
  }
}

/** [exported name, local binding] of a module's own named exports (declarations and `export { a as b }`) */
function exportedLocals(ast: any): [string, string][] {
  const out: [string, string][] = []
  for (const node of ast.body || []) {
    if (node.type !== 'ExportNamedDeclaration' || node.source) continue
    const d = node.declaration
    if (d?.type === 'VariableDeclaration') d.declarations.forEach((x: any) => x.id?.type === 'Identifier' && out.push([x.id.name, x.id.name]))
    else if (d?.id?.name) out.push([d.id.name, d.id.name])
    for (const s of node.specifiers || []) {
      const exp = s.exported?.name ?? s.exported?.value
      if (s.local?.name && exp) out.push([exp, s.local.name])
    }
  }
  return out
}

/** the project's own Vite (not one next to sygnal), as an ESM URL */
function projectVite(root: string): string {
  const req = createRequire(path.join(root, 'package.json'))
  const pj = req.resolve('vite/package.json')
  const pkg = JSON.parse(fs.readFileSync(pj, 'utf8'))
  const dot = typeof pkg.exports === 'string' ? pkg.exports : pkg.exports?.['.']
  let entry = typeof dot === 'string' ? dot : dot?.import ?? pkg.module ?? pkg.main
  if (entry && typeof entry === 'object') entry = entry.default
  return pathToFileURL(path.join(path.dirname(pj), entry)).href
}
