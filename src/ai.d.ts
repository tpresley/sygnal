// Types for 'sygnal/ai' (PLAN-6). The implementation lives in src/extra/ai/ (D253).

/** A part of a chat message (AI SDK UIMessage-shaped, D252) */
export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: `tool-${string}`; toolCallId: string; state: string; input?: unknown; output?: unknown; errorText?: string }
  | { type: 'file'; mediaType: string; url: string; filename?: string }
  | { type: `source-${string}`; [key: string]: unknown }
  | { type: `data-${string}`; id?: string; data: unknown }

/** A chat message: parts, or a plain `content` string for messages written by hand */
export type Message =
  | { id?: string; role: 'system' | 'user' | 'assistant'; parts: MessagePart[] }
  | { id?: string; role: 'system' | 'user' | 'assistant'; content: string }

/** The text of a message: its text parts joined (or its `content`) */
export function messageText(message: Message | null | undefined): string
