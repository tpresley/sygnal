// Spike: a Vite plugin for function-first RPC (what `sygnal/vite` could grow).
// - Client transform: a `*.server.ts` module becomes stubs, one per `export const x = query|mutation|stream(...)`.
//   Any other export is a build error (fail closed: nothing of the module is guessed or kept).
// - `virtual:sygnal-rpc` (SSR only): every *.server.ts module collected into a Fetch handler.
// - Dev: the handler is served at /rpc/* from the Vite dev server (reloaded with the modules).
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getRequestListener } from '@hono/node-server'
import type { Plugin, ViteDevServer } from 'vite'
import { moduleName } from './fn.ts'

const SERVER_FILE = /\.server\.[cm]?[jt]s$/
const VIRTUAL = 'virtual:sygnal-rpc'
const RESOLVED = '\0' + VIRTUAL
const LIB = fileURLToPath(new URL('.', import.meta.url))

export function stubModule(code: string, name: string, file: string) {
  const fns: { exp: string; kind: string }[] = []
  for (const m of code.matchAll(/^export\s+const\s+(\w+)\s*=\s*(query|mutation|stream)\s*\(/gm)) fns.push({ exp: m[1], kind: m[2] })
  const exports = [...code.matchAll(/^export\b.*$/gm)].map((m) => m[0])
  const other = exports.filter((line) => !/^export\s+const\s+\w+\s*=\s*(query|mutation|stream)\s*\(/.test(line) && !/^export\s+(type|interface)\b/.test(line))
  if (other.length) throw new Error(`${file}: a .server module may only export query/mutation/stream functions and types; found: ${other.join(' | ')}`)
  return [
    `import { rpcStub } from ${JSON.stringify(LIB + 'fn.ts')}`,
    ...fns.map(({ exp, kind }) => `export const ${exp} = rpcStub(${JSON.stringify(`${name}/${exp}`)}, ${JSON.stringify(kind)})`),
  ].join('\n')
}

export function serverFunctions(options: { prefix?: string } = {}): Plugin {
  let root = ''
  let server: ViteDevServer | undefined
  return {
    name: 'sygnal-server-functions',
    enforce: 'pre',
    configResolved(c) { root = c.root },
    resolveId(id) { if (id === VIRTUAL) return RESOLVED },
    load(id, opts) {
      if (id !== RESOLVED) return
      if (!opts?.ssr) throw new Error(`${VIRTUAL} is server-only`)
      return [
        `import { collect, moduleName } from ${JSON.stringify(LIB + 'fn.ts')}`,
        `import { createHandler } from ${JSON.stringify(LIB + 'server.ts')}`,
        `const modules = import.meta.glob(['/**/*.server.{ts,js}', '!**/node_modules/**'], { eager: true })`,
        `const { contract, impl } = collect(modules, moduleName)`,
        `export const procedures = Object.keys(contract)`,
        `export const handler = createHandler(contract, impl, ${JSON.stringify({ prefix: options.prefix ?? '/rpc' })})`,
      ].join('\n')
    },
    transform(code, id, opts) {
      const file = id.split('?')[0]
      if (opts?.ssr || !SERVER_FILE.test(file)) return
      return { code: stubModule(code, moduleName('/' + relative(root, file)), file), map: null }
    },
    configureServer(s) {
      server = s
      const prefix = (options.prefix ?? '/rpc') + '/'
      s.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(prefix)) return next()
        try {
          const { handler } = await server!.ssrLoadModule(VIRTUAL)
          await getRequestListener(handler)(req, res)
        } catch (e) { next(e) }
      })
    },
  }
}
