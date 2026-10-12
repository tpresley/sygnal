// @vitest-environment node
// The dev proxy with a mocked fetch: no network, a key from a temp env file.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { decideProxy, readKey, UPSTREAM } from './decide-proxy.js'

const KEY = 'ts-test-0123456789abcdef'
let dir
let envFile

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ai-compose-proxy-'))
  envFile = join(dir, 'env')
  writeFileSync(envFile, `# TypeSafe\nOTHER=1\nTYPESAFE_API_KEY=${KEY}\n`)
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function request({ method = 'POST', url = '/api/decide', body, headers = {} } = {}) {
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
  const req = Readable.from(text ? [Buffer.from(text)] : [])
  req.method = method
  req.url = url
  req.headers = { host: 'localhost:5173', 'content-type': 'application/json', ...headers }
  return req
}

function response() {
  const res = { statusCode: 200, headers: {}, body: undefined }
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v }
  res.end = (b) => { res.body = b }
  return res
}

/** run the middleware once: { res, next, fetch } */
async function call(options, req) {
  const fetch = options.fetch ?? vi.fn(async () => new Response(JSON.stringify({ answers: { use_weather: { choice: 'use' } } }), { status: 200, headers: { 'content-type': 'application/json' } }))
  const res = response()
  const next = vi.fn()
  await decideProxy({ key: readKey(envFile), ...options, fetch })(req, res, next)
  return { res, next, fetch, json: res.body === undefined ? undefined : JSON.parse(res.body) }
}

const DECIDE = { model: 'jev-latest', state: { user_request: 'the weather' }, questions: { use_weather: { criteria: { omit: 'no', use: 'yes' } } } }

describe('the /api/decide dev proxy', () => {
  it('reads the key from the env file the env var names, and not from elsewhere', () => {
    expect(readKey(envFile)).toBe(KEY)
    expect(readKey(join(dir, 'missing'))).toBe(null)
    const before = process.env.TYPESAFE_ENV_FILE
    process.env.TYPESAFE_ENV_FILE = envFile
    try { expect(readKey()).toBe(KEY) } finally {
      if (before === undefined) delete process.env.TYPESAFE_ENV_FILE
      else process.env.TYPESAFE_ENV_FILE = before
    }
  })

  it('forwards the body to TypeSafe with the key in the Authorization header', async () => {
    const { res, fetch, json } = await call({}, request({ body: DECIDE }))
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(UPSTREAM)
    expect(init.method).toBe('POST')
    expect(init.headers.authorization).toBe(`Bearer ${KEY}`)
    expect(JSON.parse(init.body)).toEqual(DECIDE)
    expect(res.statusCode).toBe(200)
    expect(json).toEqual({ answers: { use_weather: { choice: 'use' } } })
    expect(res.body).not.toContain(KEY)
    expect(JSON.stringify(res.headers)).not.toContain(KEY)
  })

  it('passes the upstream status and body through, without the key', async () => {
    const fetch = vi.fn(async () => new Response('{"error":"rate limited"}', { status: 429 }))
    const { res } = await call({ fetch }, request({ body: DECIDE }))
    expect(res.statusCode).toBe(429)
    expect(res.body).toBe('{"error":"rate limited"}')
    const down = await call({ fetch: vi.fn(async () => { throw new TypeError(`fetch failed for ${KEY}`) }) }, request({ body: DECIDE }))
    expect(down.res.statusCode).toBe(502)
    expect(down.res.body).not.toContain(KEY)
  })

  it('refuses a model outside the allowlist, a GET, a cross-site request, non-JSON and a large body', async () => {
    const cases = [
      [request({ body: { ...DECIDE, model: 'gpt-5' } }), 400],
      [request({ body: { ...DECIDE, model: undefined } }), 400],
      [request({ body: 'not json' }), 400],
      [request({ method: 'GET' }), 405],
      [request({ body: DECIDE, headers: { origin: 'https://evil.example' } }), 403],
      [request({ body: DECIDE, headers: { 'sec-fetch-site': 'cross-site' } }), 403],
      [request({ body: DECIDE, headers: { 'content-type': 'text/plain' } }), 415],
      [request({ body: { ...DECIDE, pad: 'x'.repeat(2000) } }), 413],
    ]
    for (const [req, status] of cases) {
      const { res, fetch } = await call({ max: 1000 }, req)
      expect([req.method, req.headers, res.statusCode]).toEqual([req.method, req.headers, status])
      expect(fetch).not.toHaveBeenCalled()
      expect(res.body).not.toContain(KEY)
    }
  })

  it('says whether a key is there, and never sends it; other paths pass through', async () => {
    const yes = await call({}, request({ method: 'GET', url: '/api/decide/available' }))
    expect(yes.json).toEqual({ available: true })
    expect(yes.res.body).not.toContain(KEY)
    const no = await call({ key: readKey(join(dir, 'missing')) }, request({ method: 'GET', url: '/api/decide/available' }))
    expect(no.json).toEqual({ available: false })
    const missing = await call({ key: null }, request({ body: DECIDE }))
    expect(missing.res.statusCode).toBe(503)
    expect(missing.fetch).not.toHaveBeenCalled()
    const other = await call({}, request({ method: 'GET', url: '/src/main.js' }))
    expect(other.next).toHaveBeenCalled()
    expect(other.res.body).toBe(undefined)
  })
})
