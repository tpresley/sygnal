// PLAN-6 L-2 (3-W2): the wave-2 transports and the strict layer, from 'sygnal/ai' and 'sygnal'
import { makeChatDriver, anthropicMessages, agui, fromAISDK, strictSchemas } from 'sygnal/ai'
import type { ChatTransport, ChatEvent, MessagePart, AnthropicMessagesOptions, AguiOptions, FromAISDKOptions, StrictSchemas, StrictDialect } from 'sygnal/ai'
import { anthropicMessages as fromCore, strictSchemas as strictFromCore } from 'sygnal'

const a: ChatTransport = anthropicMessages({ baseURL: 'http://localhost:11434/v1', model: 'qwen3:8b', maxTokens: 1024, strict: strictSchemas, serverTools: [{ type: 'web_search_20260209', name: 'web_search' }] })
const b: ChatTransport = agui('/api/agent', { threadId: 't', state: { todos: [] }, context: [{ description: 'user', value: 'x' }], headers: { authorization: 'session' } })
const c: ChatTransport = fromAISDK({ streamText: (o: any) => o, model: {}, temperature: 0 })
makeChatDriver({ transport: a })
const d: ChatTransport = fromCore({ strict: strictFromCore })
const s: StrictSchemas = strictSchemas
const dialect: StrictDialect = 'anthropic'
const r = strictSchemas({ type: 'object' }, dialect)
const errors: string[] = r.errors
const o: AnthropicMessagesOptions = { dangerouslyAllowBrowser: true }
const g: AguiOptions = { fetch: (url, init) => fetch(url, init) }
const f: FromAISDKOptions = { streamText: () => ({}), model: {}, Output: { object: () => ({}) } }

// a signed reasoning part and the event that closes one
const part: MessagePart = { type: 'reasoning', text: 'hm', providerMetadata: { anthropic: { signature: 'S' } } }
const ev: ChatEvent = { type: 'reasoning', delta: '', providerMetadata: { anthropic: { redactedData: 'R' } } }

// @ts-expect-error strict takes strictSchemas (D285), not a boolean
anthropicMessages({ strict: true })
// @ts-expect-error agui needs the agent's URL
agui()
// @ts-expect-error fromAISDK needs streamText
fromAISDK({ model: {} })
// @ts-expect-error an unknown dialect
strictSchemas({}, 'gemini')

export { a, b, c, d, s, errors, o, g, f, part, ev }
