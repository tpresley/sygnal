// PLAN-6 G-621 / G-636: scripts/verify-live-providers.mjs, offline. The script is the maintainer's
// opt-in live check (their keys, their terminal); here it runs on its --dry fake fetch, or on an
// injected fetch, with sygnal/ai from src: no network, no keys.
import { describe, it, expect, vi } from 'vitest'
import * as ai from '../src/ai.ts'
import { main, maxAccepted, redactor, dryFetch, parseArgs } from '../scripts/verify-live-providers.mjs'

const run = async (opts = {}) => {
  const lines = []
  const r = await main({ ai, log: l => lines.push(l), confirm: async () => true, ...opts })
  return { ...r, out: lines.join('\n') }
}

describe('verify-live-providers (offline)', () => {
  it('--dry: every check runs against the fake providers and matches the mappings', async () => {
    const r = await run({ argv: ['--dry'], env: {} })
    expect(r.exitCode).toBe(0)
    expect(Object.keys(r.results)).toEqual(['openai-decisions', 'openai-responses', 'openai-chat', 'anthropic-compat', 'anthropic-limits'])
    expect(r.results['anthropic-limits'].limits).toEqual({ tools: 20, optional: 24, unions: 16 })
    expect(r.out).toMatch(/DRY RUN/)
    expect(r.out).toMatch(/estimated total: ≈ \$0\.19/)
  })

  it('a provider without a key is skipped; no key at all sends nothing', async () => {
    const fetch = vi.fn()
    const none = await run({ argv: [], env: {}, fetch })
    expect(none.out).toMatch(/skip openai-decisions: OPENAI_API_KEY is not set/)
    expect(none.out).toMatch(/nothing to run/)
    expect(fetch).not.toHaveBeenCalled()
    const { fetch: fake, calls } = dryFetch()
    const one = await run({ argv: ['--yes'], env: { ANTHROPIC_API_KEY: 'sk-ant-test-123456789' }, fetch: fake })
    expect(one.out).toMatch(/skip openai-chat/)
    expect(Object.keys(one.results)).toEqual(['anthropic-compat', 'anthropic-limits'])
    expect(calls.every(c => c.url.startsWith('https://api.anthropic.com/v1/messages'))).toBe(true)
  })

  it('asks before spending: a "no" sends nothing; --yes doesn’t ask', async () => {
    const fetch = vi.fn()
    const confirm = vi.fn(async () => false)
    const r = await run({ argv: [], env: { OPENAI_API_KEY: 'sk-test-abcdefghijkl' }, fetch, confirm })
    expect(confirm).toHaveBeenCalledOnce()
    expect(r.out).toMatch(/cancelled: nothing was sent/)
    expect(fetch).not.toHaveBeenCalled()
    const { fetch: fake } = dryFetch()
    const confirm2 = vi.fn(async () => false)
    await run({ argv: ['--yes', '--only=openai-chat'], env: { OPENAI_API_KEY: 'sk-test-abcdefghijkl' }, fetch: fake, confirm: confirm2 })
    expect(confirm2).not.toHaveBeenCalled()
  })

  it('never prints a key, even when the provider echoes it', async () => {
    const key = 'sk-proj-SECRETSECRET123'
    const fetch = async () => new Response(JSON.stringify({ error: { message: `Incorrect API key provided: ${key}` } }), { status: 401 })
    const r = await run({ argv: ['--yes'], env: { OPENAI_API_KEY: key }, fetch })
    expect(r.exitCode).toBe(1)
    expect(r.out).toMatch(/Incorrect API key provided: \[redacted\]/)
    expect(r.out).not.toContain('SECRETSECRET')
    expect(redactor(['k1'])('a k1 b sk-ant-abcdefgh')).toBe('a [redacted] b [redacted]')
  })

  it('reports a limit below the assumed one, and a decision reply the mapping doesn’t expect', async () => {
    const { fetch: base } = dryFetch()
    const fetch = async (url, init) => {
      const body = JSON.parse(init.body)
      if (/messages$/.test(url) && (body.tools || []).filter(t => t.strict).length > 12) return new Response('{"type":"error","error":{"message":"too many"}}', { status: 400 })
      if (/decisions$/.test(url)) return new Response(JSON.stringify({ answers: [{ type: 'predicate', name: 'spam', probability: 'high' }], usage: { prompt_tokens: 3 } }), { status: 200 })
      return base(url, init)
    }
    const r = await run({ argv: ['--yes', '--only=anthropic-limits,openai-decisions'], env: { OPENAI_API_KEY: 'sk-x-aaaaaaaa', ANTHROPIC_API_KEY: 'sk-ant-bbbbbbbb' }, fetch })
    expect(r.exitCode).toBe(1)
    expect(r.results['anthropic-limits'].limits.tools).toBe(12)
    expect(r.results['anthropic-limits'].findings[0]).toMatch(/tools: the API takes only 12, anthropicMessages assumes 20/)
    const d = r.results['openai-decisions'].findings.join('\n')
    expect(d).toMatch(/spam: probability is "high"/)
    expect(d).toMatch(/topic: no answer/)
    expect(d).toMatch(/usage has other keys/)
  })

  it('maxAccepted bisects; parseArgs', async () => {
    const seen = []
    expect(await maxAccepted(async n => (seen.push(n), n <= 37), 1, 64)).toBe(37)
    expect(seen.length).toBeLessThanOrEqual(9)
    expect(await maxAccepted(async () => true, 1, 64)).toBe(64)
    expect(await maxAccepted(async () => false, 1, 64)).toBe(0)
    expect(parseArgs(['--yes', '--only=a,b', '--anthropic-model=claude-haiku-5-5'])).toEqual({ yes: true, dry: false, only: ['a', 'b'], anthropicModel: 'claude-haiku-5-5' })
    expect(() => parseArgs(['--nope'])).toThrow(/unknown option/)
  })
})
