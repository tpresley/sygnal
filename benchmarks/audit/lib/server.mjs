// Minimal static server for the built benchmark apps
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' }

export function serve(dir) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
      try {
        const body = await readFile(join(dir, path))
        res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' })
        res.end(body)
      } catch {
        res.writeHead(404); res.end()
      }
    })
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }))
  })
}
