// Types for 'sygnal/ai' (PLAN-6). The implementation lives in src/extra/ai/ (D253).
import type { Stream } from 'xstream'

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

// ---- L-1: the chat driver (1-L) -------------------------------------------------------------

/** A Standard Schema (https://standardschema.dev), as `output` takes it; Standard JSON Schema lets transports send it */
export type ChatOutputSchema<OUT = unknown> = {
  readonly '~standard': {
    validate: (value: unknown) => unknown;
    readonly types?: { readonly input: unknown; readonly output: OUT };
    [key: string]: any;
  };
}

/** The validated type of an `output` schema */
export type ChatOutputOf<S> = S extends { readonly '~standard': { readonly types?: infer T } }
  ? NonNullable<T> extends { readonly output: infer O } ? O : unknown
  : unknown

/** A tool offered to the model (the chat behavior builds these from `agent` declarations) */
export type ChatTool = {
  description?: string;
  /** The input-side JSON Schema of the tool's arguments (an object schema) */
  inputSchema?: Record<string, unknown>;
}

/**
 * A request to a makeChatDriver() sink. The driver passes it to the transport as is, so a
 * transport's own options go here too. The reply keys name the sender's actions:
 *
 *   SEND:   { LLM: (state) => ({ messages: state.messages, key: 'reply', delta: 'DELTA', ok: 'DONE', error: 'FAILED' }) },
 *   DELTA:  (state, { text }) => ({ ...state, draft: text }),                // ChatDelta
 *   DONE:   (state, { message }) => ({ ...state, messages: [...state.messages, message], draft: '' }),  // ChatOk
 *   FAILED: (state, { error }) => ({ ...state, error: error.message }),      // ChatError
 *   STOP:   { LLM: () => ({ abort: 'reply' }) },
 */
export type ChatRequest<OUT = unknown> = {
  /** The conversation so far */
  messages: Message[];
  /** System instructions */
  instructions?: string;
  /** Tools the model may call, by name */
  tools?: Record<string, ChatTool>;
  /** A model id, overriding the transport's */
  model?: string;
  /**
   * Structured output: a Standard Schema with Standard JSON Schema (Zod 4.2+, ArkType, Valibot via
   * toStandardJsonSchema()). The transport sends its input-side JSON Schema (`outputJsonSchema`);
   * `ok` gets the validated `value`, a failure is the `error` reply with `issues`
   */
  output?: ChatOutputSchema<OUT>;
  /** The request's key for `latest` and `abort` (default: `ok`, else `error`) */
  key?: string;
  /** A new request aborts the sender's request under the same key (default true) */
  latest?: boolean;
  /** Action for streamed text and reasoning (ChatDelta), coalesced per `coalesce` */
  delta?: string;
  /** Action for the finished reply (ChatOk) */
  ok?: string;
  /** Action for a failure (ChatError). Without one a failure is logged (SYG678) */
  error?: string;
  /** Action for each completed tool call (ChatToolCall) */
  tool?: string;
  /**
   * How often `delta` fires: 'frame' (default: at most once per animation frame and per 15 ms,
   * about once a second in a hidden tab), 'none' (once per streamed event) or a number of ms
   */
  coalesce?: 'frame' | 'none' | number;
  /** Not allowed: a `then` key makes the request a thenable (SYG610, not sent). Use `ok` */
  then?: never;
  /** Not allowed (SYG610, not sent). Use `error` */
  catch?: never;
  /** Transport options */
  [option: string]: unknown;
}

/** Stops the sender's requests under a key (`{ abort: 'reply' }`, `{ abort: true, key: 'reply' }`), or all of them (`{ abort: true }`) */
export type ChatAbort = { abort: string | true; key?: string }

/** `delta` action data: the reply so far */
export type ChatDelta = {
  key: string;
  /** All the text so far */
  text: string;
  /** All the reasoning so far */
  reasoning: string;
  /** The text that is new since the previous delta ('' when only reasoning grew) */
  delta: string;
  /** The assistant message so far */
  message: Message;
}

/** A completed tool call */
export type ChatCall = { id: string; name: string; input: any }

/** `tool` action data */
export type ChatToolCall = { key: string; call: ChatCall }

/** `ok` action data: the finished reply */
export type ChatOk<VALUE = unknown> = {
  key: string;
  /** The assistant message (append it to the conversation) */
  message: Message;
  /** Its text */
  text: string;
  /** The validated structured output (requests with `output`) */
  value?: VALUE;
  toolCalls: ChatCall[];
  /** The transport's finish reason ('stop', 'length', 'tool-calls', 'content-filter', …); default 'stop', or 'tool-calls' after tool calls */
  finishReason: string;
  usage?: unknown;
}

/** `error` action data */
export type ChatError = {
  key: string;
  error: Error & { status?: number };
  request: ChatRequest;
  /** Structured output that failed validation (or wasn't JSON) */
  issues?: ReadonlyArray<{ message: string; path?: ReadonlyArray<any> }>;
}

/**
 * What a transport yields, in order. Unknown types are ignored; a known type with the wrong shape
 * is skipped (SYG673 in dev). Text and reasoning grow the message's trailing part of that type; a
 * tool call adds a `tool-<name>` part (`state: 'input-available'`), which a later tool-result /
 * tool-error with its id completes; `start` sets the message id.
 */
export type ChatEvent =
  | { type: 'start'; id?: string }
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool-call'; id?: string; name: string; input?: unknown }
  | { type: 'tool-result'; id: string; output: unknown }
  | { type: 'tool-error'; id: string; error: string }
  | { type: 'data'; name: string; data: unknown; id?: string }
  | { type: `data-${string}`; data: unknown; id?: string }
  | { type: 'file'; mediaType: string; url: string; filename?: string }
  | { type: `source-${string}`; [key: string]: unknown }
  | { type: 'finish'; reason?: string; usage?: unknown }

/**
 * Speaks one wire protocol to the chat driver. `stream` is called once per request, synchronously
 * when the request is sent; stop reading (and abort the fetch) when `signal` aborts. A throw, or a
 * rejected iteration, is the request's failure.
 */
export interface ChatTransport {
  stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>;
}

export type ChatDriverOptions = {
  transport: ChatTransport;
  /** The default `coalesce` of requests (default 'frame') */
  coalesce?: 'frame' | 'none' | number;
}

/** The chat source: reply actions only (no select()) */
export type ChatSource = { readonly __sygnalReplies: true; dispose(): void; [key: string]: any }

/**
 * makeChatDriver({ transport }): an LLM chat driver with reply actions, like makeFetchDriver.
 * Requests are ChatRequest / ChatAbort sink values; replies reach the sending component only.
 * `latest` per (sender, key); a removed component's and the app's streams are aborted, and an
 * aborted stream delivers nothing.
 */
export function makeChatDriver(options: ChatDriverOptions): (sink$: Stream<ChatRequest | ChatAbort>) => ChatSource

/**
 * The JSON Schema a transport sends for a request's `output`: the input side of its Standard
 * JSON Schema, a non-object root wrapped as `{ value }` (`wrapped: true`; the driver unwraps the
 * reply). Undefined when the schema has no JSON Schema form.
 */
export function outputJsonSchema(output: ChatOutputSchema | undefined): { schema: Record<string, unknown>; wrapped: boolean } | undefined
