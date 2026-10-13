// The dev server's provider routes. The browser never holds a provider key: it talks to these
// routes on its own origin, and they add the key on the way out.
//
//   GET    /api/providers           what is available: Ollama's models, Kindo's models, whether a
//                                   Kindo / TypeSafe key is set (never the key itself)
//   POST   /api/keys                { provider, key }: keep a key in this process's memory
//   DELETE /api/keys/<provider>     forget the key typed in this session (a key file stays)
//   ANY    /api/kindo/v1/<path>     → https://api.kindo.ai/v1/<path> with Authorization: Bearer
//                                   (responses, chat/completions, messages, models only)
//   POST   /api/decide              → TypeSafe's /v1/systemone (Jev), model jev-latest only
//
// Keys come from a file outside the repository (read when the server starts) or from the page's
// Keys dialog (memory only: never written anywhere, gone when the dev server stops). They are
// never logged and never sent back. Cross-site requests are refused, so another site open in the
// browser can't spend a key through these routes. The plugin is `apply: 'serve'`: a `vite build`
// has none of this.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const PROVIDERS = {
  kindo: {
    label: 'Kindo',
    variable: 'KINDO_API_KEY',
    file: () => process.env.KINDO_ENV_FILE || join(homedir(), '.config', 'kindo', 'env'),
  },
  typesafe: {
    label: 'TypeSafe (Jev)',
    variable: 'TYPESAFE_API_KEY',
    file: () => process.env.TYPESAFE_ENV_FILE || join(homedir(), '.config', 'typesafe', 'env'),
  },
}

export const KINDO = 'https://api.kindo.ai'
export const TYPESAFE = 'https://api.typesafe.ai/v1/systemone'
export const OLLAMA = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '')
/** the Kindo paths the page may use: inference in three wire formats, and the model list */
export const KINDO_PATHS = /^\/v1\/(responses|chat\/completions|messages|models)$/
export const DECISION_MODELS = ['jev-latest']
export const MAX_BODY = 1024 * 1024

/** the key in an env file (`NAME=...`, optionally quoted or exported), or null */
export function readKeyFile(file, variable) {
  let text
  try { text = readFileSync(file, 'utf8') } catch { return null }
  const m = text.match(new RegExp(`^\\s*(?:export\\s+)?${variable}\\s*=\\s*["']?([^"'\\s#]+)`, 'm'))
  return m ? m[1] : null
}

/** the keys: one per provider, from its file (at start) or the Keys dialog (memory) */
export function keyStore({ readFile = readKeyFile } = {}) {
  const fromFile = {}
  const typed = {}
  for (const [id, p] of Object.entries(PROVIDERS)) fromFile[id] = readFile(p.file(), p.variable)
  return {
    get: (id) => typed[id] ?? fromFile[id] ?? null,
    set: (id, key) => { typed[id] = key },
    forget: (id) => { delete typed[id] },
    /** what the page may know: whether a key is set and where it came from, never the key */
    status: () => Object.fromEntries(Object.keys(PROVIDERS).map((id) => [id, {
      configured: !!(typed[id] ?? fromFile[id]),
      source: typed[id] ? 'session' : fromFile[id] ? 'file' : null,
    }])),
  }
}

function send(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

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

/** a request another site sent (a form or a fetch from a page that isn't this dev server's) */
export function crossSite(req) {
  const site = req.headers['sec-fetch-site']
  if (site && !['same-origin', 'none'].includes(site)) return true
  const origin = req.headers.origin
  if (!origin) return false
  try { return new URL(origin).host !== req.headers.host } catch { return true }
}

async function json(req, res, max = MAX_BODY) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'JSON only' }), undefined
  const text = await readBody(req, max)
  if (text === null) return send(res, 413, { error: `the body is over ${max} bytes` }), undefined
  try { return JSON.parse(text) } catch { return send(res, 400, { error: 'the body is not JSON' }), undefined }
}

/** pipe an upstream reply (SSE included) to the page, as it arrives */
async function pipe(reply, res) {
  res.statusCode = reply.status
  res.setHeader('content-type', reply.headers.get('content-type') || 'application/json')
  res.setHeader('cache-control', 'no-store')
  if (!reply.body) return res.end()
  const reader = reply.body.getReader()
  res.on('close', () => reader.cancel().catch(() => {}))
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    res.write(value)
  }
  res.end()
}

const noKey = (id) => `No ${PROVIDERS[id].label} key: add one with the Keys button, or put ${PROVIDERS[id].variable}=... in ${PROVIDERS[id].file()} and restart the dev server`

/** Ollama's installed models with their capabilities ('completion', 'tools', 'decision', 'vision', ...) */
async function ollamaModels(fetch) {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) })
    if (!r.ok) return { reachable: false, error: `HTTP ${r.status}`, models: [] }
    const tags = await r.json()
    return { reachable: true, url: OLLAMA, models: (tags.models ?? []).map((m) => ({ name: m.name, capabilities: m.capabilities ?? [] })) }
  } catch (e) {
    return { reachable: false, error: `not reachable at ${OLLAMA}`, models: [] }
  }
}

async function kindoModels(fetch, key) {
  if (!key) return { reachable: false, models: [] }
  try {
    const r = await fetch(`${KINDO}/v1/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) })
    if (!r.ok) return { reachable: false, error: r.status === 401 ? 'the key was refused (401)' : `HTTP ${r.status}`, models: [] }
    const list = await r.json()
    const items = Array.isArray(list?.data) ? list.data : Array.isArray(list) ? list : []
    return { reachable: true, models: items.map((m) => (typeof m === 'string' ? m : m.id)).filter(Boolean) }
  } catch (e) {
    return { reachable: false, error: 'not reachable', models: [] }
  }
}

/** The middleware (connect style). `keys`, `fetch` are for tests. */
export function providerRoutes({ keys = keyStore(), fetch = globalThis.fetch } = {}) {
  return async function providers(req, res, next) {
    const path = (req.url || '').split('?')[0]
    if (!path.startsWith('/api/')) return next()
    if (crossSite(req)) return send(res, 403, { error: 'cross-site requests are refused' })

    if (path === '/api/providers') {
      if (req.method !== 'GET') return send(res, 405, { error: 'GET only' })
      const status = keys.status()
      const [ollama, kindo] = await Promise.all([ollamaModels(fetch), kindoModels(fetch, keys.get('kindo'))])
      return send(res, 200, {
        ollama,
        kindo: { ...status.kindo, ...kindo },
        typesafe: { ...status.typesafe, models: status.typesafe.configured ? DECISION_MODELS : [] },
      })
    }

    if (path === '/api/keys' && req.method === 'POST') {
      const body = await json(req, res, 8 * 1024)
      if (body === undefined) return
      const { provider, key } = body ?? {}
      if (!Object.hasOwn(PROVIDERS, provider)) return send(res, 400, { error: `provider must be one of ${Object.keys(PROVIDERS).join(', ')}` })
      if (typeof key !== 'string' || !/^\S{8,512}$/.test(key.trim())) return send(res, 400, { error: 'that does not look like an API key' })
      keys.set(provider, key.trim())
      return send(res, 200, keys.status()[provider])
    }
    const forget = path.match(/^\/api\/keys\/(\w+)$/)
    if (forget) {
      if (req.method !== 'DELETE') return send(res, 405, { error: 'DELETE only' })
      if (!Object.hasOwn(PROVIDERS, forget[1])) return send(res, 404, { error: 'no such provider' })
      keys.forget(forget[1])
      return send(res, 200, keys.status()[forget[1]])
    }

    if (path.startsWith('/api/kindo/')) {
      const upstream = path.slice('/api/kindo'.length)
      if (!KINDO_PATHS.test(upstream)) return send(res, 404, { error: 'not a proxied Kindo path' })
      const key = keys.get('kindo')
      if (!key) return send(res, 503, { error: noKey('kindo') })
      const post = req.method === 'POST'
      if (!post && req.method !== 'GET') return send(res, 405, { error: 'GET or POST only' })
      const body = post ? await json(req, res) : null
      if (body === undefined) return
      let reply
      try {
        reply = await fetch(`${KINDO}${upstream}`, {
          method: req.method,
          headers: { authorization: `Bearer ${key}`, ...(post && { 'content-type': 'application/json' }), accept: req.headers.accept || '*/*' },
          ...(post && { body: JSON.stringify(body) }),
        })
      } catch (e) {
        return send(res, 502, { error: `Kindo is unreachable (${e?.name || 'error'})` })
      }
      return pipe(reply, res)
    }

    if (path === '/api/decide') {
      if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
      const key = keys.get('typesafe')
      if (!key) return send(res, 503, { error: noKey('typesafe') })
      const body = await json(req, res)
      if (body === undefined) return
      if (!body || !DECISION_MODELS.includes(body.model)) return send(res, 400, { error: `model must be one of ${DECISION_MODELS.join(', ')}` })
      let reply
      try {
        reply = await fetch(TYPESAFE, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body) })
      } catch (e) {
        return send(res, 502, { error: `TypeSafe is unreachable (${e?.name || 'error'})` })
      }
      return pipe(reply, res)
    }

    return next()
  }
}

/** the Vite plugin: the routes exist on the dev server only */
export function providersPlugin() {
  return {
    name: 'ai-showcase:providers',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(providerRoutes())
    },
  }
}
