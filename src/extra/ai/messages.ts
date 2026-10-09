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
