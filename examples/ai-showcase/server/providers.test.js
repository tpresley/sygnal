import { describe, it, expect } from 'vitest'
import { providerRoutes, keyStore, readKeyFile } from './providers.js'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The routes as connect middleware, with a fake upstream: what reaches Kindo / TypeSafe, and
// what the page gets back. The key must never come back to the page.

function call(routes, { method = 'GET', url, body, headers = {} }) {
  return new Promise((resolve) => {
    const chunks = []
    const req = {
      method, url,
      headers: { host: 'localhost:6180', ...(body !== undefined && { 'content-type': 'application/json' }), ...headers },
      async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) },
    }
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v },
      write(c) { chunks.push(Buffer.from(c)) },
      end(c) { if (c) chunks.push(Buffer.from(c)); const text = Buffer.concat(chunks).toString(); resolve({ status: this.statusCode, headers: this.headers, text, json: (() => { try { return JSON.parse(text) } catch { return null } })() }) },
      on() {},
    }
    routes(req, res, () => resolve({ status: 'next' }))
  })
}

function upstream() {
  const seen = []
  const fetch = async (url, init = {}) => {
    seen.push({ url, method: init.method ?? 'GET', auth: init.headers?.authorization, body: init.body && JSON.parse(init.body) })
    if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: 'qwen3:8b', capabilities: ['completion', 'tools'] }] })
    if (url.endsWith('/v1/models')) return Response.json({ data: [{ id: 'moonshotai/Kimi-K3' }, { id: 'gpt-4o-2024-11-20' }] })
    return new Response('event: response.completed\ndata: {}\n\n', { headers: { 'content-type': 'text/event-stream' } })
  }
  return { seen, fetch }
}

const noFiles = () => keyStore({ readFile: () => null })

describe('the provider routes', () => {
  it('report what is available, never the key', async () => {
    const keys = noFiles()
    keys.set('kindo', 'sk-kindo-secret-123')
    const { fetch } = upstream()
    const r = await call(providerRoutes({ keys, fetch }), { url: '/api/providers?v=1' })
    expect(r.json.ollama.models[0].name).toBe('qwen3:8b')
    expect(r.json.kindo).toMatchObject({ configured: true, source: 'session', reachable: true, models: ['moonshotai/Kimi-K3', 'gpt-4o-2024-11-20'] })
    expect(r.json.typesafe).toMatchObject({ configured: false, models: [] })
    expect(r.text).not.toContain('sk-kindo-secret-123')
  })

  it('keep a typed key in memory, and forget it', async () => {
    const keys = noFiles()
    const routes = providerRoutes({ keys, fetch: upstream().fetch })
    const saved = await call(routes, { method: 'POST', url: '/api/keys', body: { provider: 'kindo', key: '  sk-typed-key-456 ' } })
    expect(saved.json).toEqual({ configured: true, source: 'session' })
    expect(saved.text).not.toContain('sk-typed')
    expect(keys.get('kindo')).toBe('sk-typed-key-456')
    expect((await call(routes, { method: 'DELETE', url: '/api/keys/kindo' })).json).toEqual({ configured: false, source: null })
    expect((await call(routes, { method: 'POST', url: '/api/keys', body: { provider: 'openai', key: 'sk-whatever-1' } })).status).toBe(400)
    expect((await call(routes, { method: 'POST', url: '/api/keys', body: { provider: 'kindo', key: 'x' } })).status).toBe(400)
  })

  it('forward inference to Kindo with the key, and only the allowed paths', async () => {
    const keys = noFiles()
    keys.set('kindo', 'sk-kindo-secret-123')
    const { seen, fetch } = upstream()
    const routes = providerRoutes({ keys, fetch })
    const r = await call(routes, { method: 'POST', url: '/api/kindo/v1/responses', body: { model: 'moonshotai/Kimi-K3', input: 'hi', stream: true } })
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toBe('text/event-stream')
    expect(seen.at(-1)).toMatchObject({ url: 'https://api.kindo.ai/v1/responses', method: 'POST', auth: 'Bearer sk-kindo-secret-123', body: { model: 'moonshotai/Kimi-K3' } })
    for (const path of ['chat/completions', 'messages']) {
      await call(routes, { method: 'POST', url: `/api/kindo/v1/${path}`, body: {} })
      expect(seen.at(-1).url).toBe(`https://api.kindo.ai/v1/${path}`)
    }
    // not an inference path: agents, integrations, MCP, ... are not reachable through the page
    for (const path of ['/api/kindo/v1/agents/list', '/api/kindo/v1/mcp', '/api/kindo/v1/../v1/agents/list']) {
      expect((await call(routes, { method: 'POST', url: path, body: {} })).status).toBe(404)
    }
  })

  it('refuse cross-site requests, so another site can\'t spend a key', async () => {
    const keys = noFiles()
    keys.set('kindo', 'sk-kindo-secret-123')
    const { seen, fetch } = upstream()
    const routes = providerRoutes({ keys, fetch })
    const evil = await call(routes, { method: 'POST', url: '/api/kindo/v1/responses', body: {}, headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } })
    expect(evil.status).toBe(403)
    const keySteal = await call(routes, { method: 'POST', url: '/api/keys', body: { provider: 'kindo', key: 'sk-attacker-000' }, headers: { origin: 'https://evil.example' } })
    expect(keySteal.status).toBe(403)
    expect(keys.get('kindo')).toBe('sk-kindo-secret-123')
    expect(seen).toHaveLength(0)
  })

  it('say how to add a missing key, and pass Jev decisions with the TypeSafe key', async () => {
    const keys = noFiles()
    const { seen, fetch } = upstream()
    const routes = providerRoutes({ keys, fetch })
    const missing = await call(routes, { method: 'POST', url: '/api/decide', body: { model: 'jev-latest' } })
    expect(missing.status).toBe(503)
    expect(missing.json.error).toMatch(/Keys button/)
    keys.set('typesafe', 'ts-secret-789')
    expect((await call(routes, { method: 'POST', url: '/api/decide', body: { model: 'gpt-anything' } })).status).toBe(400)
    await call(routes, { method: 'POST', url: '/api/decide', body: { model: 'jev-latest', state: 'x', questions: {} } })
    expect(seen.at(-1)).toMatchObject({ url: 'https://api.typesafe.ai/v1/systemone', auth: 'Bearer ts-secret-789' })
  })

  it('leave other paths to Vite', async () => {
    expect((await call(providerRoutes({ keys: noFiles() }), { url: '/src/main.js' })).status).toBe('next')
  })
})

describe('key files', () => {
  it('read NAME=value, quoted or exported, and ignore the rest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'keys-'))
    const file = join(dir, 'env')
    writeFileSync(file, '# my keys\nexport KINDO_API_KEY="kd-123456789"\nOTHER=1\n')
    expect(readKeyFile(file, 'KINDO_API_KEY')).toBe('kd-123456789')
    expect(readKeyFile(file, 'TYPESAFE_API_KEY')).toBe(null)
    expect(readKeyFile(join(dir, 'missing'), 'KINDO_API_KEY')).toBe(null)
  })
})
