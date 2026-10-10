/*
 * PLAN-6 L-1 (D252): chat messages are AI SDK UIMessage-shaped: `{ id?, role, parts }`, where a
 * part is `{ type: 'text', text }`, `{ type: 'reasoning', text }`, `{ type: 'tool-<name>', toolCallId,
 * state, input?, output? }`, `{ type: 'file', … }`, `{ type: 'source-…', … }` or `{ type: 'data-…', … }`.
 * A message written by hand may carry `content: string` instead of parts.
 */

/** the text of a message: its text parts joined (or its `content` string) */
export function messageText(message: any): string {
  if (!message) return ''
  if (typeof message.content == 'string' && !message.parts) return message.content
  return (message.parts || []).filter((p: any) => p && p.type === 'text').map((p: any) => p.text).join('')
}

/**
 * G-640: a new message id, 16 random [0-9a-z] characters (the AI SDK's generateId is 16
 * alphanumerics too). Ids name messages, they are no secret: Math.random is enough
 */
export const messageId = (): string => {
  let s = ''
  while (s.length < 16) s += Math.random().toString(36).slice(2)
  return s.slice(0, 16)
}

const own = (o: any, k: any) => Object.prototype.hasOwnProperty.call(o, k)

/**
 * PLAN-6 4-F: the message with its open tool calls answered, for apps that run the raw chat
 * driver's tool loop themselves: each `tool-<name>` part in `input-available` gets the result for
 * its call. `results`: a function `(call: { id, name, input }) => output` (a throw is that call's
 * error), or an object keyed by the call's id, else by the tool's name. An `Error` value (returned
 * or thrown) gives `state: 'output-error'` with its `errorText`; any other value
 * `state: 'output-available'` with it as `output`; `undefined` (no result) leaves the part open.
 * Returns a new message (the same one when nothing changed).
 */
export function withToolResults(message: any, results: any): any {
  if (!message || !Array.isArray(message.parts) || results == null) return message
  let changed = false
  const parts = message.parts.map((p: any) => {
    if (!p || typeof p.type != 'string' || !p.type.startsWith('tool-') || p.state != 'input-available') return p
    const call = {id: p.toolCallId, name: p.type.slice(5), input: p.input}
    let r: any
    try {
      r = typeof results == 'function' ? results(call) : own(results, call.id) ? results[call.id] : own(results, call.name) ? results[call.name] : undefined
    } catch (e: any) { r = e instanceof Error ? e : new Error(String(e)) }
    if (r === undefined) return p
    changed = true
    return r instanceof Error ? {...p, state: 'output-error', errorText: r.message} : {...p, state: 'output-available', output: r}
  })
  return changed ? {...message, parts} : message
}
