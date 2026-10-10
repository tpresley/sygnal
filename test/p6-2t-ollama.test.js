// PLAN-6 2-T (G-619): the real L-2 transports against local Ollama (http://localhost:11434):
// openResponses on /v1/responses and chatCompletions on /v1/chat/completions, with llama3.2 and
// qwen3:8b: a reply, a tool round trip and structured output (plain and strict).
// Opt-in, never in npm test: TEST_OLLAMA=1 npm run test:ai-local
// (OLLAMA_MODELS=llama3.2,qwen3:8b; OLLAMA_URL=http://localhost:11434/v1)
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { strictSchemas } from '../src/extra/ai/schema/strict.ts'
import { openResponses } from '../src/extra/ai/transports/openResponses.ts'
import { chatCompletions } from '../src/extra/ai/transports/chatCompletions.ts'
import { readOutput } from '../src/extra/ai/chat/output.ts'
import { toJsonSchema } from '../src/extra/ai/schema/index.ts'
import { collect } from './helpers/p6-sse-fixture.js'

const baseURL = process.env.OLLAMA_URL || 'http://localhost:11434/v1'
const models = (process.env.OLLAMA_MODELS || 'llama3.2,qwen3:8b').split(',')
const T = 600_000
// qwen3 thinks for a long time unless told not to
const say = (model, text) => ({ role: 'user', parts: [{ type: 'text', text: model.startsWith('qwen3') ? `${text} /no_think` : text }] })
const textOf = ev => ev.filter(e => e.type == 'text').map(e => e.delta).join('')
const weatherInput = z.object({ city: z.string().describe('The city name') })
const tools = { get_weather: { description: 'Get the current weather for a city', inputSchema: toJsonSchema(weatherInput).schema } }
const report = []

describe.skipIf(!process.env.TEST_OLLAMA)('L-2 transports against local Ollama (opt-in)', () => {
  for (const [name, make] of [['openResponses', openResponses], ['chatCompletions', chatCompletions]]) {
    for (const model of models) {
      describe(`${name} × ${model}`, () => {
        const t = make({ baseURL, model })

        it('streams a reply', async () => {
          const ev = await collect(t, { instructions: 'Answer in one short sentence.', messages: [say(model, 'What colour is the sky on a clear day?')] })
          const text = textOf(ev)
          report.push([name, model, 'reply', text.slice(0, 60)])
          expect(text.trim().length).toBeGreaterThan(0)
          expect(ev.at(-1)).toMatchObject({ type: 'finish', reason: 'stop' })
        }, T)

        it('a tool round trip', async () => {
          const ask = say(model, 'What is the weather in Hilo right now? Use the tool.')
          const first = await collect(t, { instructions: 'You have a weather tool. Use it to answer weather questions.', tools, messages: [ask] })
          const call = first.find(e => e.type == 'tool-call')
          report.push([name, model, 'tool call', JSON.stringify(call?.input)])
          expect(call).toMatchObject({ name: 'get_weather', input: { city: expect.stringMatching(/hilo/i) } })
          expect(first.at(-1)).toMatchObject({ type: 'finish', reason: 'tool-calls' })
          const assistant = { role: 'assistant', parts: [{ type: 'tool-get_weather', toolCallId: call.id, state: 'output-available', input: call.input, output: { city: 'Hilo', temperatureC: 24, sky: 'sunny' } }] }
          const second = await collect(t, { instructions: 'You have a weather tool. Use it to answer weather questions.', tools, messages: [ask, assistant] })
          const text = textOf(second)
          report.push([name, model, 'after the result', text.slice(0, 60)])
          expect(text).toMatch(/24/)
        }, T)

        for (const strict of [false, true]) {
          it(`structured output${strict ? ' (strict)' : ''}`, async () => {
            const output = z.object({ city: z.string(), country: z.string(), population: z.number().optional() })
            const ts = make({ baseURL, model, ...(strict && { strict: strictSchemas }) })
            const ev = await collect(ts, { instructions: 'Answer with JSON only.', output, messages: [say(model, 'Name the capital of France and its country.')] })
            const value = await readOutput(output, textOf(ev))
            report.push([name, model, `output${strict ? ' strict' : ''}`, JSON.stringify(value)])
            expect(value.city).toMatch(/paris/i)
          }, T)
        }
      })
    }
  }

  it('report', () => { for (const r of report) process.stderr.write('[2-T ollama] ' + r.join(' | ') + '\n') })
})
