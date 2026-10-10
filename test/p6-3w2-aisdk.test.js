// PLAN-6 L-2 (3-W2): fromAISDK() over the real AI SDK 7 (`ai` is an exact-pinned devDependency;
// sygnal never imports it) and MockLanguageModelV4 (no network): the stream mapping, the
// ModelMessages it builds (streamText validates them, so an invalid one would throw), tools
// without execute, structured output through Output, errors and abort.
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { streamText, Output, customProvider } from 'ai'
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test'
import { fromAISDK, toModelMessages } from '../src/extra/ai/transports/fromAISDK.ts'
import { toJsonSchema } from '../src/extra/ai/schema/index.ts'
import { collect } from './helpers/p6-sse-fixture.js'

const usage = { inputTokens: { total: 7, noCache: 7, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 9, text: 6, reasoning: 3 } }
const finish = unified => ({ type: 'finish', usage, finishReason: { unified, raw: unified } })
const model = (...streams) => {
  let i = 0
  // supportedUrls: the AI SDK passes URLs through instead of downloading them (no network)
  return new MockLanguageModelV4({ supportedUrls: { '*/*': [/^https:/] }, doStream: async () => ({ stream: convertArrayToReadableStream([{ type: 'stream-start', warnings: [] }, ...streams[Math.min(i++, streams.length - 1)]]) }) })
}
const user = text => ({ role: 'user', parts: [{ type: 'text', text }] })
const weather = { description: 'Weather', inputSchema: toJsonSchema(z.object({ city: z.string() })).schema }

describe('fromAISDK: the stream', () => {
  it('reasoning (closed with its providerMetadata), text, a client tool call, finish with usage', async () => {
    const sig = { anthropic: { signature: 'SIG' } }
    const m = model([
      { type: 'reasoning-start', id: 'r' }, { type: 'reasoning-delta', id: 'r', delta: 'hmm' }, { type: 'reasoning-end', id: 'r', providerMetadata: sig },
      { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'Check' }, { type: 'text-delta', id: 't', delta: 'ing.' }, { type: 'text-end', id: 't' },
      { type: 'tool-call', toolCallId: 'c1', toolName: 'weather', input: '{"city":"Hilo"}' },
      finish('tool-calls'),
    ])
    const ev = await collect(fromAISDK({ streamText, model: m }), { messages: [user('weather?')], tools: { weather } })
    expect(ev).toEqual([
      { type: 'reasoning', delta: 'hmm' },
      { type: 'reasoning', delta: '', providerMetadata: sig },
      { type: 'text', delta: 'Check' },
      { type: 'text', delta: 'ing.' },
      { type: 'tool-call', id: 'c1', name: 'weather', input: { city: 'Hilo' } },
      { type: 'finish', reason: 'tool-calls', usage: { inputTokens: 7, outputTokens: 9, totalTokens: 16, reasoningTokens: 3 } },
    ])
    // the tool went to the model as a function tool with its JSON Schema, no execute
    const call = m.doStreamCalls[0]
    expect(call.tools).toEqual([expect.objectContaining({ type: 'function', name: 'weather', description: 'Weather', inputSchema: expect.objectContaining({ properties: { city: { type: 'string' } } }) })])
  })

  it('a provider-executed tool, its result, sources and a generated file', async () => {
    const m = model([
      { type: 'tool-call', toolCallId: 's1', toolName: 'web_search', input: '{"q":"x"}', providerExecuted: true },
      { type: 'tool-result', toolCallId: 's1', toolName: 'web_search', result: [{ url: 'https://x' }] },
      { type: 'source', sourceType: 'url', id: 'src1', url: 'https://x', title: 'X' },
      { type: 'file', mediaType: 'image/png', data: { type: 'data', data: 'iVBOR' } },
      finish('stop'),
    ])
    const ev = await collect(fromAISDK({ streamText, model: m }), { messages: [user('x')] })
    expect(ev.slice(0, -1)).toEqual([
      { type: 'tool-call', id: 's1', name: 'web_search', input: { q: 'x' }, executed: true, providerExecuted: true },
      { type: 'tool-result', id: 's1', output: [{ url: 'https://x' }] },
      { type: 'source-url', sourceId: 'src1', url: 'https://x', title: 'X' },
      { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,iVBOR' },
    ])
  })

  it('a model error throws; abort stops the stream', async () => {
    const bad = model([{ type: 'text-start', id: 't' }, { type: 'error', error: new Error('rate limited') }])
    await expect(collect(fromAISDK({ streamText, model: bad, maxRetries: 0 }), { messages: [user('x')] })).rejects.toThrow('rate limited')
    const slow = new MockLanguageModelV4({
      doStream: async ({ abortSignal }) => ({ stream: new ReadableStream({
        start(c) { c.enqueue({ type: 'stream-start', warnings: [] }); c.enqueue({ type: 'text-start', id: 't' }); abortSignal?.addEventListener('abort', () => c.error(Object.assign(new Error('aborted'), { name: 'AbortError' }))) },
        async pull(c) { await new Promise(r => setTimeout(r, 2)); c.enqueue({ type: 'text-delta', id: 't', delta: 'w ' }) },
      }) }),
    })
    const ac = new AbortController()
    let n = 0
    await (async () => { try { for await (const e of fromAISDK({ streamText, model: slow }).stream({ messages: [user('x')] }, ac.signal)) { if (e.type == 'text' && ++n == 3) ac.abort() } } catch (_) {} })()
    expect(n).toBeLessThan(6)
  })

  it('needs streamText; a request with output needs Output', async () => {
    expect(() => fromAISDK({ model: {} })).toThrow(/streamText/)
    await expect(collect(fromAISDK({ streamText, model: model([finish('stop')]) }), { messages: [user('x')], output: z.object({ a: z.string() }) })).rejects.toThrow(/Output/)
  })
})

describe('fromAISDK: the request', () => {
  it('instructions, settings, structured output through Output.object', async () => {
    const m = model([{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: '{"a":"x"}' }, { type: 'text-end', id: 't' }, finish('stop')])
    const ev = await collect(fromAISDK({ streamText, Output, model: m, temperature: 0.2 }), { instructions: 'Be brief', messages: [user('x')], output: z.object({ a: z.string() }) })
    expect(ev.filter(e => e.type == 'text').map(e => e.delta).join('')).toBe('{"a":"x"}')
    const call = m.doStreamCalls[0]
    expect(call.temperature).toBe(0.2)
    expect(call.prompt[0]).toEqual({ role: 'system', content: 'Be brief' })
    expect(call.responseFormat).toMatchObject({ type: 'json', schema: expect.objectContaining({ properties: { a: { type: 'string' } } }) })
  })

  it('the conversation as ModelMessages streamText accepts: steps, tool results (json, text, error, denied), reasoning with providerOptions, files', async () => {
    const m = model([finish('stop')])
    const messages = [
      { role: 'system', content: 'House rules.' },
      { role: 'user', parts: [{ type: 'file', mediaType: 'image/png', url: 'https://x/a.png' }, { type: 'text', text: 'add milk, eggs, tea' }] },
      { role: 'assistant', parts: [
        { type: 'step-start' },
        { type: 'reasoning', text: 'three', providerMetadata: { anthropic: { signature: 'S' } } },
        { type: 'tool-add', toolCallId: 'c1', state: 'output-available', input: { text: 'milk' }, output: { ok: true } },
        { type: 'tool-add', toolCallId: 'c2', state: 'output-error', input: { text: 'eggs' }, errorText: 'none left' },
        { type: 'step-start' },
        { type: 'text', text: 'And tea?' },
        { type: 'tool-add', toolCallId: 'c3', state: 'output-denied', input: { text: 'tea' } },
        { type: 'tool-web_search', toolCallId: 's1', state: 'output-available', input: { q: 'x' }, output: 'found', providerExecuted: true },
        { type: 'text', text: 'Done.' },
      ] },
      user('thanks'),
    ]
    const tools = { add: { inputSchema: toJsonSchema(z.object({ text: z.string() })).schema } }
    await collect(fromAISDK({ streamText, model: m }), { messages, tools })
    const prompt = m.doStreamCalls[0].prompt
    expect(prompt.map(p => p.role)).toEqual(['system', 'user', 'assistant', 'tool', 'assistant', 'tool', 'assistant', 'user'])
    expect(prompt[2].content).toEqual([
      expect.objectContaining({ type: 'reasoning', text: 'three', providerOptions: { anthropic: { signature: 'S' } } }),
      expect.objectContaining({ type: 'tool-call', toolCallId: 'c1', toolName: 'add', input: { text: 'milk' } }),
      expect.objectContaining({ type: 'tool-call', toolCallId: 'c2' }),
    ])
    expect(prompt[3].content.map(r => r.output)).toEqual([{ type: 'json', value: { ok: true } }, { type: 'error-text', value: 'none left' }])
    expect(prompt[5].content[0].output).toMatchObject({ type: 'execution-denied' })
    // a provider-executed result stays in the assistant message
    expect(toModelMessages(messages[2]).slice(2)).toEqual([
      { role: 'assistant', content: [
        { type: 'text', text: 'And tea?' },
        { type: 'tool-call', toolCallId: 'c3', toolName: 'add', input: { text: 'tea' } },
        { type: 'tool-call', toolCallId: 's1', toolName: 'web_search', input: { q: 'x' }, providerExecuted: true },
        { type: 'tool-result', toolCallId: 's1', toolName: 'web_search', output: { type: 'text', value: 'found' } },
      ] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c3', toolName: 'add', output: { type: 'execution-denied' } }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
    ])
  })
})

describe('fromAISDK: the request’s model (G-637)', () => {
  const textModel = (text, id) => {
    const m = model([{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: text }, { type: 'text-end', id: 't' }, finish('stop')])
    Object.defineProperty(m, 'modelId', { value: id })
    return m
  }
  const text = ev => ev.filter(e => e.type == 'text').map(e => e.delta).join('')
  const fast = textModel('fast', 'fast'), smart = textModel('smart', 'smart'), base = textModel('base', 'base')

  it('without a request model: the model option', async () => {
    expect(text(await collect(fromAISDK({ streamText, model: base }), { messages: [user('x')] }))).toBe('base')
  })

  it('a LanguageModel object on the request is used as is', async () => {
    expect(text(await collect(fromAISDK({ streamText, model: base }), { messages: [user('x')], model: smart }))).toBe('smart')
  })

  it('a string through `models`: a map, a provider function (customProvider), an unknown id is an Error', async () => {
    expect(text(await collect(fromAISDK({ streamText, model: base, models: { fast, smart } }), { messages: [user('x')], model: 'fast' }))).toBe('fast')
    const provider = customProvider({ languageModels: { fast, smart } })
    expect(text(await collect(fromAISDK({ streamText, model: base, models: id => provider.languageModel(id) }), { messages: [user('x')], model: 'smart' }))).toBe('smart')
    await expect(collect(fromAISDK({ streamText, model: base, models: { fast, smart } }), { messages: [user('x')], model: 'slow' }))
      .rejects.toThrow("fromAISDK: no model 'slow': the models option doesn't resolve it (it has fast, smart)")
  })

  it('a string without `models` is an Error (never the AI SDK’s global provider, never silently the option’s model)', async () => {
    const seen = []
    const spy = o => { seen.push(o); return streamText(o) }
    await expect(collect(fromAISDK({ streamText: spy, model: base }), { messages: [user('x')], model: 'acme/fast' }))
      .rejects.toThrow("fromAISDK: no model 'acme/fast': pass models")
    expect(seen).toEqual([])
  })

})
