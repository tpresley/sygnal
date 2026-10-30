// A static server for todomvc/dist on a free port (module workers need a real origin and MIME types)
import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {extname, join, normalize} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('./todomvc/dist/', import.meta.url))
const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json'}

export function serve() {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
    try {
      const body = await readFile(join(root, path === '/' ? 'main.html' : path))
      res.writeHead(200, {'content-type': types[extname(path)] || 'application/octet-stream'})
      res.end(body)
    } catch { res.writeHead(404); res.end() }
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({server, url: `http://127.0.0.1:${server.address().port}`})))
}
