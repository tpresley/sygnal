// PLAN-6 L-2 (2-T): the transports' option and result types, from 'sygnal/ai' and 'sygnal'
import { makeChatDriver, openResponses, chatCompletions, uiMessageStream, chromePrompt, encodeOpenResponses, strictSchemas } from 'sygnal/ai'
import type { ChatTransport, ChatEvent, OpenResponsesEvent, ChromePromptStatus, OpenResponsesOptions, HttpTransportOptions } from 'sygnal/ai'
import { openResponses as fromCore } from 'sygnal'
import type { ChatUsage } from 'sygnal'

const a: ChatTransport = openResponses({ baseURL: 'http://localhost:11434/v1', model: 'llama3.2', strict: strictSchemas })
const b: ChatTransport = chatCompletions({ model: 'm', headers: (req) => ({ 'x-n': String(req.messages.length) }), fetch: (url, init) => fetch(url, init) })
const c: ChatTransport = uiMessageStream('/api/chat', { body: { tenant: 't' }, headers: async () => ({ authorization: 'session' }) })
const d = chromePrompt({ temperature: 0.5 })
const status: Promise<ChromePromptStatus> = d.status()
makeChatDriver({ transport: d })
const e: ChatTransport = fromCore()
const opts: HttpTransportOptions = { dangerouslyAllowBrowser: true }
const o: OpenResponsesOptions = { ...opts, model: 'm' }

const events: OpenResponsesEvent[] = encodeOpenResponses(['Hi', { reasoning: 'hm' }, { toolCall: { name: 'add', input: { text: 'x' } } }, { finish: 'stop' }, { type: 'text', delta: 'x' }])
const t: string = events[0].type

// the events uiMessageStream yields
const ev: ChatEvent[] = [
  { type: 'tool-call', id: 'c', name: 'del', input: {}, executed: true },
  { type: 'tool-approval', id: 'c', approval: { id: 'ap1' } },
  { type: 'tool-denied', id: 'c' },
]
const u: ChatUsage = { inputTokens: 1, outputTokens: 2 }

// @ts-expect-error a URL is required
uiMessageStream()
// @ts-expect-error strict takes strictSchemas (D285), not a boolean
openResponses({ strict: true })
// @ts-expect-error chromePrompt has no baseURL
chromePrompt({ baseURL: 'x' })

export { a, b, c, e, o, status, t, ev, u }
