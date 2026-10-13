import { it, expect } from 'vitest'
import { routed } from './providers.js'

// what each route's transport receives
function spy() {
  const seen = []
  const transport = { async *stream(request) { seen.push(request) } }
  return { seen, routes: { ollama: { transport }, kindo: { transport } } }
}
const run = async (t, request) => { for await (const _ of t.stream(request, new AbortController().signal)); }

it('hands the request to the route the model names, without the route prefix', async () => {
  const { seen, routes } = spy()
  await run(routed(routes), { model: 'kindo::moonshotai/Kimi-K3', messages: [] })
  expect(seen[0].model).toBe('moonshotai/Kimi-K3')
})

it('sends bodyFor fields to their route only', async () => {
  const { seen, routes } = spy()
  const t = routed(routes)
  const request = { messages: [], body: { top_p: 1 }, bodyFor: { ollama: { temperature: 0 } } }
  await run(t, { ...request, model: 'ollama::qwen3:8b' })
  await run(t, { ...request, model: 'kindo::gpt-5.6-sol' })
  expect(seen[0].body).toEqual({ top_p: 1, temperature: 0 })
  expect(seen[1].body).toEqual({ top_p: 1 })
  expect(seen.every((r) => !('bodyFor' in r))).toBe(true)
})

it('fails a model with no route', async () => {
  await expect(run(routed(spy().routes), { model: 'nowhere::x', messages: [] })).rejects.toThrow(/no route/)
})
