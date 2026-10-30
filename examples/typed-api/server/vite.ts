// Dev only: serve the API from the Vite dev server at /api/* (a production server mounts
// makeHandler() the same way: it is a Fetch handler).
import type { Plugin } from 'vite'
import { Readable } from 'node:stream'

export function apiDevServer(): Plugin {
  return {
    name: 'typed-api-dev-server',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()
        try {
          const { makeHandler } = await server.ssrLoadModule('/server/handler.ts')
          const handle = (globalThis as any).__typedApi ??= makeHandler()
          const ctl = new AbortController()
          res.on('close', () => ctl.abort())
          const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : (Readable.toWeb(req) as any)
          const request = new Request(new URL(req.url, 'http://localhost'), {
            method: req.method, headers: req.headers as any, body, signal: ctl.signal, ...(body && { duplex: 'half' }),
          } as RequestInit)
          const response: Response = await handle(request)
          res.writeHead(response.status, Object.fromEntries(response.headers))
          if (!response.body) return void res.end()
          Readable.fromWeb(response.body as any).pipe(res)
        } catch (e) { next(e) }
      })
    },
  }
}
