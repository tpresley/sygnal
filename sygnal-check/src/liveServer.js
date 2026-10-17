/**
 * The live page's server (PLAN-10 W-1, D524): `node:http`, no dependency.
 *
 *   createLiveServer({ page, port = 0, ping = 25000 }) → Promise<{
 *     url, token, port,
 *     publish({ json, version })   send a graph to every client (the caller sends only changes)
 *     clients                      the number of open event streams
 *     close() → Promise            end the streams, stop listening
 *   }>
 *     page(current) → string       the HTML for GET / (current: the last published { json, version })
 *
 * Security (PLAN-10 invariant: loopback only, a random token, read-only):
 * - It listens on 127.0.0.1 only; there is no option for another address.
 * - The token (18 random bytes, base64url) is in the URL's query (`?t=`), compared in constant
 *   time; without it every request is 403.
 * - A Host header other than `127.0.0.1:<port>` or `localhost:<port>` is 403 (DNS rebinding).
 * - It serves two things: `GET /` the page and `GET /events` the SSE stream; other paths are 404,
 *   other methods 405. No files, no writes.
 * - Every response: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`,
 *   `Referrer-Policy: no-referrer` (the token is in the URL and the page links out to the docs), a
 *   CSP (the page: inline style and script, `connect-src 'self'` for the stream, no framing).
 *
 * The stream starts with `retry: 1000` and the current graph (`event: graph`, `id: <version>`,
 * `data: <json>`), unless the client's `Last-Event-ID` says it has that version; then one event per
 * publish(), and a `: ping` comment every `ping` ms so idle streams stay open.
 */
import http from 'node:http'
import crypto from 'node:crypto'

export const PAGE_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data: blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
const SECURITY = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' }

const sameToken = (given, token) => {
  const a = Buffer.from(String(given ?? '')), b = Buffer.from(token)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export function createLiveServer({ page, port = 0, ping = 25000 } = {}) {
  const token = crypto.randomBytes(18).toString('base64url')
  const streams = new Set()
  let current = null // { json, version }
  const event = (c) => `event: graph\nid: ${c.version}\ndata: ${c.json}\n\n`

  const server = http.createServer((req, res) => {
    const deny = (code) => { res.writeHead(code, { ...SECURITY, 'Content-Type': 'text/plain; charset=utf-8' }); res.end(http.STATUS_CODES[code] + '\n') }
    const actual = server.address()?.port
    const host = req.headers.host
    if (host !== `127.0.0.1:${actual}` && host !== `localhost:${actual}`) return deny(403)
    let url
    try { url = new URL(req.url, `http://127.0.0.1:${actual}`) } catch { return deny(400) }
    if (!sameToken(url.searchParams.get('t'), token)) return deny(403)
    if (url.pathname !== '/' && url.pathname !== '/events') return deny(404)
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); return deny(405) }
    if (url.pathname === '/') {
      const body = page(current)
      res.writeHead(200, { ...SECURITY, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': PAGE_CSP, 'Content-Length': Buffer.byteLength(body) })
      res.end(req.method === 'HEAD' ? undefined : body)
      return
    }
    res.writeHead(200, { ...SECURITY, 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'Content-Security-Policy': "default-src 'none'" })
    if (req.method === 'HEAD') { res.end(); return }
    res.write('retry: 1000\n\n')
    if (current && req.headers['last-event-id'] !== String(current.version)) res.write(event(current))
    streams.add(res)
    req.on('close', () => streams.delete(res))
  })
  server.keepAliveTimeout = 5000

  const pinger = setInterval(() => { for (const res of streams) res.write(': ping\n\n') }, ping)
  pinger.unref?.()

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      const actual = server.address().port
      resolve({
        url: `http://127.0.0.1:${actual}/?t=${token}`,
        token,
        port: actual,
        address: server.address().address,
        get clients() { return streams.size },
        publish(c) {
          current = { json: c.json, version: c.version }
          for (const res of streams) res.write(event(current))
        },
        close() {
          clearInterval(pinger)
          for (const res of streams) res.end()
          streams.clear()
          return new Promise((done) => {
            server.close(() => done())
            server.closeAllConnections?.()
          })
        },
      })
    })
  })
}
