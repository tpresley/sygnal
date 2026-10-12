// The dev server's /api/decide route: the browser's decide() requests for Jev go here, and this
// forwards them to TypeSafe with the API key, which never reaches the browser.
//
// - The key is read once, when the dev server starts, from the file the env var TYPESAFE_ENV_FILE
//   names (default ~/.config/typesafe/env, a line `TYPESAFE_API_KEY=...`), outside the repo. Never
//   from a VITE_* variable (Vite would put those in the client bundle), never logged, never sent
//   back.
// - POST /api/decide only, JSON only, a body of at most MAX_BODY bytes, a model in MODELS only, and
//   only from this page (a cross-site request is refused: another site can't spend the key).
// - GET /api/decide/available → { available }: whether a key was found (the app offers Jev only then).
// - Dev only: vite.config.js adds it with `apply: 'serve'`; `vite build` output has no such route.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const UPSTREAM = 'https://api.typesafe.ai/v1/systemone'
export const MODELS = ['jev-latest']
export const MAX_BODY = 512 * 1024

/** the key in an env file (`TYPESAFE_API_KEY=...`, optionally quoted or exported), or null */
export function readKey(file = process.env.TYPESAFE_ENV_FILE || join(homedir(), '.config', 'typesafe', 'env')) {
  let text
  try { text = readFileSync(file, 'utf8') } catch { return null }
  const m = text.match(/^\s*(?:export\s+)?TYPESAFE_API_KEY\s*=\s*["']?([^"'\s#]+)/m)
  return m ? m[1] : null
}

function send(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

/** the request body, or null when it is larger than `max` */
async function readBody(req, max) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > max) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** a request another site sent (a form or fetch from a page that isn't this dev server's) */
function crossSite(req) {
  if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return true
  const origin = req.headers.origin
  if (!origin) return false
  try { return new URL(origin).host !== req.headers.host } catch { return true }
}

/**
 * The middleware (connect style: `(req, res, next)`). `key` defaults to readKey() at creation;
 * `fetch` and `upstream` are for tests.
 */
export function decideProxy({ key = readKey(), upstream = UPSTREAM, fetch = globalThis.fetch, max = MAX_BODY } = {}) {
  return async function decide(req, res, next) {
    const path = (req.url || '').split('?')[0]
    if (path === '/api/decide/available') {
      if (req.method !== 'GET') return send(res, 405, { error: 'GET only' })
      return send(res, 200, { available: !!key })
    }
    if (path !== '/api/decide') return next()
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
    if (crossSite(req)) return send(res, 403, { error: 'cross-site requests are refused' })
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'JSON only' })
    if (!key) return send(res, 503, { error: 'no TypeSafe key: put TYPESAFE_API_KEY=... in ~/.config/typesafe/env (or the file TYPESAFE_ENV_FILE names) and restart the dev server' })
    if (Number(req.headers['content-length']) > max) return send(res, 413, { error: `the body is over ${max} bytes` })
    const text = await readBody(req, max)
    if (text === null) return send(res, 413, { error: `the body is over ${max} bytes` })
    let body
    try { body = JSON.parse(text) } catch { return send(res, 400, { error: 'the body is not JSON' }) }
    if (!body || typeof body !== 'object' || !MODELS.includes(body.model)) {
      return send(res, 400, { error: `model must be one of ${MODELS.join(', ')}` })
    }
    let reply
    try {
      reply = await fetch(upstream, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      })
    } catch (e) {
      return send(res, 502, { error: `TypeSafe is unreachable (${e?.name || 'error'})` })
    }
    res.statusCode = reply.status
    res.setHeader('content-type', reply.headers.get('content-type') || 'application/json')
    res.setHeader('cache-control', 'no-store')
    res.end(await reply.text())
  }
}

/** the Vite plugin: the route on the dev server only; the key is read when the server starts */
export function decideProxyPlugin() {
  return {
    name: 'ai-compose:decide-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(decideProxy())
    },
  }
}
