// Types for 'sygnal/ai' (PLAN-6). The implementation lives in src/extra/ai/ (D253).
import type { FetchRequest, Behavior, BehaviorTarget } from 'sygnal'
import type { Stream } from 'xstream'

/** A part of a chat message (AI SDK UIMessage-shaped, D252) */
export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string; /** provider data to send back with it (an Anthropic thinking signature) */ providerMetadata?: Record<string, Record<string, unknown>> }
  | { type: `tool-${string}`; toolCallId: string; state: string; input?: unknown; output?: unknown; errorText?: string; approval?: { id: string; approved?: boolean; reason?: string; [key: string]: unknown }; providerExecuted?: boolean }
  | { type: 'file'; mediaType: string; url: string; filename?: string }
  | { type: `source-${string}`; [key: string]: unknown }
  | { type: `data-${string}`; id?: string; data: unknown }

/** A chat message: parts, or a plain `content` string for messages written by hand */
export type Message =
  | { id?: string; role: 'system' | 'user' | 'assistant'; parts: MessagePart[] }
  | { id?: string; role: 'system' | 'user' | 'assistant'; content: string }

/** The text of a message: its text parts joined (or its `content`) */
export function messageText(message: Message | null | undefined): string

// ---- M-1: decisions -------------------------------------------------------------------------

/** A question's instructions: text, or an object / array holding the question and the data it names */
export type DecisionInstructions = string | Record<string, unknown> | readonly unknown[]

/** `choice(...)`: pick one option. `K`: the option names */
export interface ChoiceQuestion<K extends string = string> {
  type: 'choice'
  instructions: DecisionInstructions
  /** Option name → description (or null) */
  criteria: { [P in K]: string | null }
}

/** `noul(...)`: the probability (0 to 1) that the answer is yes */
export interface NoulQuestion {
  type: 'noul'
  instructions: DecisionInstructions
  /** What counts as true and as false (recommended: answers are better calibrated with them) */
  criteria?: { true: string; false: string }
}

/** `score(...)`: an ordered scale. `L`: the level descriptions, lowest first */
export interface ScoreQuestion<L extends string = string> {
  type: 'score'
  instructions: DecisionInstructions
  /** Level descriptions, lowest first (the answer's `score` is the probability-weighted index) */
  criteria: readonly L[]
}

export type Question = ChoiceQuestion<any> | NoulQuestion | ScoreQuestion<any>
/** Questions by name; the answers come back under the same names */
export type Questions = Record<string, Question>

/** The answer to a `choice` question */
export interface ChoiceAnswer<K extends string = string> {
  type: 'choice'
  /** The most likely option */
  choice: K
  /** Every option's probability (they sum to 1) */
  probabilities: Record<K, number>
  /** 0 to 1: how strongly the model favours one option (not a guarantee of correctness) */
  confidence: number
}

/** The answer to a `noul` question */
export interface NoulAnswer {
  type: 'noul'
  /** The probability of yes, 0 to 1 */
  noul: number
}

/** The answer to a `score` question */
export interface ScoreAnswer<L extends string = string> {
  type: 'score'
  /** The probability-weighted level index (0 = the first level); can fall between levels */
  score: number
  /** Level index ('0', '1', …) → its description */
  legend: Record<string, L>
  /** Level index ('0', '1', …) → its probability */
  probabilities: Record<string, number>
  confidence: number
}

/** `decide.openai()` only: OpenAI Decisions refused this question */
export interface RefusalAnswer {
  type: 'refusal'
  [key: string]: unknown
}

/** The answer type of a question */
export type Answer<Q> =
  Q extends ChoiceQuestion<infer K> ? ChoiceAnswer<K>
  : Q extends ScoreQuestion<infer L> ? ScoreAnswer<L>
  : Q extends NoulQuestion ? NoulAnswer
  : never

/** The answers to a set of questions, by name */
export type Answers<Q extends Questions> = { [N in keyof Q]: Answer<Q[N]> }

/**
 * A decision reply (the `ok` action's data, a resource's `data`): `Decision<typeof questions>`.
 * `decide.openai()` replies are `Decision<Q, RefusalAnswer>` (an answer can be a refusal)
 */
export interface Decision<Q extends Questions = Questions, R = never> {
  model?: string
  answers: { [N in keyof Q]: Answer<Q[N]> | R }
  usage?: { input_tokens: number; output_tokens: number }
  [key: string]: unknown
}

type FetchRequestObject = Extract<FetchRequest, { url: string }>

/** What `decide()` / `decide.openai()` take: the decision, plus any `makeFetchDriver` request keys */
export type DecideOptions<Q extends Questions> = Omit<FetchRequestObject, 'url' | 'json' | 'body'> & {
  /** Default '/api/decide' (the app's own route, which holds the API key) */
  url?: string
  /** The decision model, e.g. 'jev-latest' (TypeSafe), 'nimble' (Ollama), 'gpt-6-luna' (OpenAI) */
  model: string
  /** What the questions are about: text, or an object / array (JSON) */
  state: unknown
  questions: Q
  /** Base64 PNG / JPEG / WebP files shared by every question (models that read images only) */
  images?: readonly string[]
  /** As a resource: keep the previous `data` on a new request */
  keepPrevious?: boolean
  /** As a resource: refetch every this many ms */
  refetchEvery?: number
  /** As a resource: stay live in a hidden Switchable page */
  background?: boolean
}

/** A decision as a `makeFetchDriver` request (POST JSON); its reply is a `Decision<Q, R>` */
export type DecideRequest<Q extends Questions = Questions, R = never> = Omit<DecideOptions<Q>, 'model' | 'state' | 'questions' | 'images' | 'url'> & {
  url: string
  method: 'POST'
  json: Record<string, unknown>
  /** Type only: the reply's shape (`Decision<Q, R>`); never set */
  readonly __decision?: Decision<Q, R>
}

/**
 * PLAN-6 M-1: a decision request for `makeFetchDriver`, in the dictionary form TypeSafe
 * (`/v1/systemone`), Ollama ≥ 0.35 (`/v1/systemone`), OpenRouter and the AI Gateway take:
 * `{ url, method: 'POST', json: { model, state, questions, images? }, ...requestKeys }`. Use it
 * as a reply-action request (`{ HTTP: () => decide({ ..., ok: 'TRIAGED' }) }`) or as a
 * `resources` entry; the reply is `{ model, answers: { name: answer }, usage }` (`Decision<Q>`).
 * Any other key (`ok`, `error`, `key`, `latest`, `headers`, ...) passes through to the request.
 */
export const decide: {
  <Q extends Questions>(options: DecideOptions<Q>): DecideRequest<Q>
  /**
   * The same questions as an OpenAI Decisions request (`{ model, input, questions: [...] }`,
   * `predicate` / `choice` / `score`); its `parse` maps the reply's answer array back to the
   * dictionary form, so reply actions and resources get a `Decision<Q, RefusalAnswer>`. A
   * `noul` question's criteria are appended to the predicate's instructions. Point `url` at
   * your server route that adds the key (OpenAI: `POST /v1/decisions`)
   */
  openai<Q extends Questions>(options: DecideOptions<Q>): DecideRequest<Q, RefusalAnswer>
}

/** A `choice` question: the most likely of the options (`{ name: description | null }` or names) */
export function choice<K extends string>(instructions: DecisionInstructions, criteria: { [P in K]: string | null }): ChoiceQuestion<K>
export function choice<const K extends string>(instructions: DecisionInstructions, criteria: readonly K[]): ChoiceQuestion<K>

/** A `noul` question: the probability of yes; `criteria` describe what counts as true / false */
export function noul(instructions: DecisionInstructions, criteria?: { true: string; false: string }): NoulQuestion

/** A `score` question: an ordered scale of 2 or more level descriptions, lowest first */
export function score<const L extends string>(instructions: DecisionInstructions, levels: readonly [L, L, ...L[]]): ScoreQuestion<L>
// ---- M-2: decision reply fixtures (3-M) ----------------------------------------------------------

/**
 * What `answers()` takes for one question:
 * - choice: an option name, `{ choice?, confidence? }`, or `{ probabilities }` (the most likely wins);
 * - noul: `true` (0.95), `false` (0.05) or the probability of yes;
 * - score: a level index (fractional: between two levels), a level description, or `{ score, confidence? }`
 */
export type AnswerPick<Q> =
  Q extends ChoiceQuestion<infer K> ? K | { choice?: K; confidence?: number } | { probabilities: Partial<Record<K, number>>; choice?: K; confidence?: number }
  : Q extends ScoreQuestion<infer L> ? number | L | { score: number | L; confidence?: number }
  : Q extends NoulQuestion ? boolean | number | { noul: number }
  : never

/** The picks by question name (each optional) */
export type AnswerPicks<Q extends Questions> = { [N in keyof Q]?: AnswerPick<Q[N]> }

/**
 * PLAN-6 M-2: a decision reply for tests, typed from the questions: what a decision model would
 * send for `decide({ questions })`, with what the test doesn't pick filled in (a choice: the first
 * option at confidence 0.9, the rest sharing the remaining probability; a noul: false; a score: 0).
 * `confidence` is computed as TypeSafe / Ollama `nimble` report it (1 minus the normalized
 * entropy), unless given. Unknown question names, options or levels throw.
 *
 *   await t.respond('HTTP', answers(questions, { topic: { choice: 'billing', confidence: 0.35 } }), 'TRIAGED')
 */
export const answers: {
  <Q extends Questions>(questions: Q, picks?: AnswerPicks<Q>, options?: { model?: string; usage?: { input_tokens: number; output_tokens: number } }): Decision<Q> & { model: string }
  /** the same reply in OpenAI Decisions' array form, for a `decide.openai()` request (its `parse` maps it back) */
  openai<Q extends Questions>(questions: Q, picks?: AnswerPicks<Q>, options?: { model?: string }): { model: string; answers: Array<Record<string, unknown> & { type: 'predicate' | 'choice' | 'score'; name: string }> }
}
// ------------------------------------------------------------------------------------------------
// A-1: schemas (the input contract) and the agent layer

/** A plain JSON Schema object (for `jsonSchema()`) */
export type JsonSchemaObject = {
  readonly type?: string | readonly string[]
  readonly properties?: Record<string, unknown>
  readonly '~standard'?: never
  readonly [keyword: string]: unknown
}

/**
 * A schema for an agent action's `input` (or a chat request's `output`): a Standard Schema
 * whose validated output is assignable to D, that also implements Standard JSON Schema (Zod
 * 4.2+, ArkType 2.1.28+, Valibot through `toStandardJsonSchema()`), or `jsonSchema()`. Without a
 * JSON Schema form the tool isn't offered (SYG240). Structural: no dependency on
 * `@standard-schema/spec`.
 */
export type AgentSchema<D = unknown> = {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (value: unknown, options?: any) => unknown
    readonly types?: { readonly input: unknown; readonly output: D } | undefined
    readonly jsonSchema?: { readonly input: (options: { target: string; libraryOptions?: Record<string, unknown> }) => Record<string, unknown> }
  }
}

/**
 * Plain JSON Schema as an `input` / `output` (D262): the schema goes to the model as is
 * (normalized), and a subset validator checks the value (type, enum, const, required,
 * properties, additionalProperties, items, prefixItems, anyOf / oneOf, minimum / maximum,
 * minLength / maxLength, minItems / maxItems, pattern, local `$ref`s; format, allOf, not,
 * if / then / else, multipleOf and uniqueItems are not checked). `{ validate }` keeps a library's
 * own validation: `jsonSchema(z.toJSONSchema(s), { validate: s })` for Zod Mini. T is asserted,
 * not inferred.
 */
export function jsonSchema<T = unknown>(schema: JsonSchemaObject, options?: { validate?: { readonly '~standard': { readonly validate: (value: unknown) => unknown } } }): AgentSchema<T>

/** A schema converted for a model: the tool schema, or why there is none */
export interface ConvertedSchema {
  /** the normalized, input-side JSON Schema (draft 2020-12); always an object root */
  schema?: Record<string, any>
  /** a non-object root was wrapped as `{ value }` (the unwrap also takes bare arguments) */
  wrapped?: boolean
  /** a lossy conversion (SYG243): what the model doesn't see (it is still validated) */
  lossy?: string
  /** no JSON Schema form (SYG240) */
  error?: string
}

/**
 * The JSON Schema a model gets for a schema: the input side, normalized for every provider
 * (`$schema` dropped, `oneOf` -> `anyOf`, Zod's safe-integer bounds and a tuple's `items: false`
 * dropped, a root `"$ref": "#"` moved into `$defs`), a non-object root wrapped as `{ value }`.
 * Cached by schema object.
 */
export function toJsonSchema(schema: unknown): ConvertedSchema

/** The validated output type of a schema */
export type SchemaOutput<S> = S extends { readonly '~standard': { readonly types?: infer T } } ? NonNullable<T> extends { readonly output: infer O } ? O : unknown : unknown

/** One validation failure */
export interface AgentIssue { message: string; path?: PropertyKey[] }

/**
 * A model's arguments for a schema -> the validated value: the `{ value }` unwrap (bare
 * arguments accepted), `repair` (numeric and boolean strings where the schema says number /
 * integer / boolean; `repair: false` turns it off, D264), then the schema's validation.
 */
export function parseInput<S extends AgentSchema<any>>(schema: S, args: unknown, options?: { repair?: boolean }): Promise<
  | { value: SchemaOutput<S>; issues?: undefined; error?: undefined }
  | { value?: undefined; issues: AgentIssue[]; error?: undefined }
  | { value?: undefined; issues?: undefined; error: string }
>

type AgentNoData<D> = 0 extends 1 & D ? false : [D] extends [undefined | void | null] ? true : [D] extends [Event] ? true : false
type AgentIsAny<D> = 0 extends 1 & D ? true : false

/**
 * One entry of `agent.actions`, typed by the model's data type D for that action: no data
 * (undefined, void, null, or the DOM event a click delivers): no `input`; an untyped component:
 * `input` optional; otherwise `input` is required and its schema's output must be assignable to D.
 */
export type AgentAction<STATE, D> = {
  /** What the action does, for the model (WebMCP: at most 500 characters) */
  description: string
  /** Ask the user before running it (the chat behavior's `pending`, WebMCP's confirm) */
  consequential?: boolean
  /** Offered only while this is true (cached by state identity) */
  when?: (state: STATE) => boolean
  /** A call that changes nothing is a success (`{ ok: true, unchanged: true }`), not an error (D256) */
  idempotent?: boolean
} & (AgentNoData<D> extends true ? { input?: never } : AgentIsAny<D> extends true ? { input?: AgentSchema<any> } : { input: AgentSchema<D> })

/**
 * The `agent` static: what agents may do with a component and see of it. Only the listed actions
 * are exposed, as tools `<name>_<action>` (snake case) plus `<name>_read`; a Collection item
 * component's actions are one tool per action with an `id` parameter (`item` when the input has
 * its own `id`).
 */
export type AgentDeclaration<STATE = any, ACTIONS = any> = {
  /** Tool name prefix: `todos` -> todos_add, todos_read (letters, digits, _) */
  name: string
  description?: string
  /** What the model sees of this component: in its context after every flush, and in call results */
  read?: (state: STATE) => unknown
  /** A Collection item's label for the model (`1: water plants`, D258) */
  label?: (state: STATE) => string
  /**
   * `read` returns user-entered strings (WebMCP's untrustedContentHint; the chat behavior names
   * the declaration as untrusted in its app-state block); `false`: only the app's own text. Unset,
   * it is inferred (WebMCP: SYG244): any string is user text except values under keys named `id`,
   * `status`, `type` or `kind`, and values that are one of this declaration's input enum values (G-623)
   */
  untrusted?: boolean
  actions: keyof ACTIONS extends never
    ? { [action: string]: AgentAction<STATE, any> }
    : { [K in keyof ACTIONS]?: AgentAction<STATE, ACTIONS[K]> }
}

/** One tool, as an agent sees it */
export interface AgentTool {
  name: string
  description: string
  /** the input JSON Schema (an object root) */
  inputSchema: Record<string, any>
  annotations: { readOnlyHint?: true; consequentialHint?: true; untrustedContentHint?: true }
  /** a declared tool that isn't offered (SYG240); only in `list({ all: true })` and `t.tools()` */
  error?: string
}

/** What a consequential call asks the user about */
export interface AgentConfirmInfo {
  tool: string
  component: string
  action: string
  description: string
  /** the validated input */
  input: unknown
  /** a Collection item's key and label */
  key?: unknown
  label?: string
  /** The chat behavior's `pending` for a server tool's approval request (AI SDK `needsApproval`): its approval id (`component` is 'server') */
  approvalId?: string
}
export type AgentConfirm = boolean | ((info: AgentConfirmInfo) => boolean | Promise<boolean>)

/**
 * A tool call's result, for the model:
 * - `{ ok: true, state }`: done; `state` is the nearest `read` projection (the item's, or its
 *   list's); `removed: true` when an item removed itself; `unchanged: true` for an idempotent no-op
 * - `{ ok: false, error, state?, issues?, keys? }`: invalid input (`issues`), an unknown or hidden
 *   key (`keys`), not available (`when`), declined, refused (`abort(reason)`), threw, or changed
 *   nothing ("already so, or the input matched nothing")
 */
export type AgentResult =
  | { ok: true; state?: unknown; removed?: true; unchanged?: true }
  | { ok: false; error: string; state?: unknown; issues?: AgentIssue[]; keys?: unknown[] }

export interface AgentToolsOptions {
  /** consequential calls: `true` runs them, a function asks (default: declined) */
  confirm?: AgentConfirm
  /** run calls one at a time, in call order (default true, D260) */
  serial?: boolean
  /** coerce numeric / boolean strings where the schema says so (default true, D264) */
  repair?: boolean
  /** only this instance (an InstanceView or its id) and its descendants */
  from?: unknown
  /** only these components' declarations */
  components?: Function[]
}

/** The live tool set `agentTools()` returns */
export interface AgentToolSet {
  /** the tools offered now; `{ all: true }` adds declared tools that can't be offered, with `error` */
  list(options?: { all?: boolean }): AgentTool[]
  /** run a tool as an agent (cause 'agent'); resolves after the action's flush */
  call(name: string, args?: unknown, options?: { confirm?: AgentConfirm }): Promise<AgentResult>
  /** the `read` projections by declaration name (item declarations: arrays with `id`) */
  context(): Record<string, unknown>
  /** called with the tools and the context after each flush that changed either; returns unsubscribe */
  subscribe(listener: (change: { tools: AgentTool[]; context: Record<string, unknown> }) => void): () => void
  /** detach from the app */
  stop(): void
}

/**
 * The agent tools of an app's shown components (their `agent` statics): the building block of
 * the chat behavior, WebMCP and `t.tools()`. Pass the `run()` result (followed through HMR) or a
 * runtime (`app.__runtime`). Every call runs as an action with cause 'agent', through the same
 * queue, reducers and flush as a click.
 */
export function agentTools(app: unknown, options?: AgentToolsOptions): AgentToolSet
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
   * The reply continues the last message, an assistant message (after tool results or an approval,
   * as the AI SDK does): `message` starts with its id and parts plus a `step-start` part; `text`,
   * `toolCalls` and `delta` are the new step's (G-628)
   */
  continue?: boolean;
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
  /** `providerMetadata` closes the reasoning part with it (L-2: an Anthropic thinking signature, to send back) */
  | { type: 'reasoning'; delta: string; providerMetadata?: Record<string, Record<string, unknown>> }
  | { type: 'tool-call'; id?: string; name: string; input?: unknown; /** the server runs it (L-2 uiMessageStream): a message part only, no `tool` reply */ executed?: boolean; providerExecuted?: boolean }
  | { type: 'tool-result'; id: string; output: unknown }
  | { type: 'tool-error'; id: string; error: string }
  /** the server asks the user to approve the call (AI SDK `needsApproval`): the part goes to `approval-requested` */
  | { type: 'tool-approval'; id: string; approval: { id: string; requestReason?: string; [key: string]: unknown } }
  /** the server reports the call denied: the part goes to `output-denied` */
  | { type: 'tool-denied'; id: string }
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

// ---- A-2: WebMCP (2-W; experimental, D241: tracks the draft, outside semver) --------------------

export interface ExposeWebMcpOptions {
  /** origins the tools are exposed to (passed to `registerTool` where the browser takes it) */
  exposedTo?: string[]
  /** consequential calls: `true` runs them, `false` declines, a function asks (default: a native modal `<dialog>`) */
  confirm?: AgentConfirm
  /** prepended to every tool name (`shop_` -> shop_todos_add) */
  prefix?: string
  /** the WebMCP context (default `document.modelContext ?? navigator.modelContext`) */
  modelContext?: unknown
}
/** Stops exposing the tools (unregisters them); `available` is false where there is no WebMCP */
export type WebMcpHandle = (() => void) & { readonly available: boolean }

/**
 * Experimental: offer an app's agent tools (its components' `agent` statics, as `agentTools()`
 * sees them) to the browser's agent through WebMCP (`document.modelContext`). Each tool is
 * registered with `registerTool` and re-registered when it changes (a `when`, the live Collection
 * keys, the state summary in its description); results are always objects within Chrome's
 * budgets. A no-op where WebMCP is missing.
 */
export function experimentalExposeWebMcp(app: unknown, options?: ExposeWebMcpOptions): WebMcpHandle
// ---- L-3: the chat behavior (2-C) -----------------------------------------------------------

/** 'ready' | 'submitted' (sent, nothing received yet) | 'streaming' (receiving, or running tools) | 'error' (the AI SDK's names) */
export type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error'

/** The chat behavior's slice: `state.assistant` for `uses = { assistant: chat(...) }` */
export interface ChatState {
  /** The conversation: the user's messages and the model's replies, with their `tool-<name>` parts */
  messages: Message[]
  /** The prompt field's value */
  prompt: string
  /** The text of the reply being streamed ('' otherwise) */
  draft: string
  /** The reasoning of the reply being streamed ('' otherwise; the finished reply keeps it as `reasoning` parts) */
  draftReasoning: string
  status: ChatStatus
  /** A consequential tool call waiting for APPROVE / DENY (or a server tool's approval request: `approvalId`), else null */
  pending: AgentConfirmInfo | null
  /** The last failure's message, else null */
  error: string | null
}

/** `DONE` action data: the turn is over */
export interface ChatDone {
  /** The last reply */
  message: Message
  text: string
  finishReason: string
  usage?: unknown
  /** Requests sent in the turn (at most `maxSteps`) */
  steps: number
}

/** The chat behavior's actions, as `'<key>.<ACTION>'` on the host */
export interface ChatActions {
  /** Send the prompt (the form's submit), or the text given as data */
  SEND: string | { text: string } | Event | undefined
  /** Abort the reply being streamed (its text and reasoning so far are kept) and decline a waiting call; calls that already ran keep their results */
  STOP: any
  /** Send the last user message again, dropping the replies after it */
  REGENERATE: any
  /** Run the pending consequential call (a server approval: answered approved, and the conversation sent again) */
  APPROVE: any
  /** Decline the pending consequential call (the model is told the user declined; a server approval: answered not approved) */
  DENY: any
  /** The turn is over (a host entry `'assistant.DONE'` runs after the behavior's) */
  DONE: ChatDone
  /** Internal: the prompt field's input */
  PROMPT: string
}

export interface ChatOptions {
  /** The chat driver's sink (default 'LLM') */
  sink?: string
  /** The form element whose submit sends the prompt */
  form?: BehaviorTarget
  /** The prompt field (its input events set `prompt`) */
  prompt?: BehaviorTarget
  /** Its clicks STOP */
  stop?: BehaviorTarget
  /** Its clicks APPROVE the pending call */
  approve?: BehaviorTarget
  /** Its clicks DENY the pending call */
  deny?: BehaviorTarget
  /** Its clicks REGENERATE */
  regenerate?: BehaviorTarget
  /**
   * System instructions. The tools' `read` projections are not appended: they go as app state, a
   * user-role message of their own right before the last user message on every request (id
   * 'sygnal-app-state', framed as data, not instructions, with the declarations holding
   * user-entered text named; G-631)
   */
  instructions?: string
  /** A model id for the requests (overrides the transport's) */
  model?: string
  /**
   * Whose `agent` declarations become tools: by default the host's and its shown descendants'
   * (D249); `false`: none; `[Comp, …]`: only these components' (in the host's subtree)
   */
  agent?: false | Function[]
  /** The most requests per turn (default 8): the tool calls of a reply past it are not run */
  maxSteps?: number
  /** Extra request keys for the transport */
  transportOptions?: Record<string, unknown>
}

/**
 * PLAN-6 L-3: an in-app assistant as a behavior. `uses = { assistant: chat({ form: '.ask',
 * prompt: '.prompt', stop: '.stop', approve: '.approve', deny: '.deny', instructions }) }` gives
 * `state.assistant` (ChatState) and the actions 'assistant.SEND', 'assistant.STOP',
 * 'assistant.REGENERATE', 'assistant.APPROVE', 'assistant.DENY' and 'assistant.DONE'. It sends
 * requests to the chat driver (`sink`), runs the model's tool calls on the host's `agent` tools
 * (and its descendants') through the agent layer (validation, no-op detection, cause 'agent'),
 * asks before consequential ones (`pending`), and loops until a reply without tool calls or
 * `maxSteps`. Its selectors are the host's own: render the markup in the host's view.
 */
export function chat(options?: ChatOptions): Behavior<ChatState, ChatActions, {}, ChatOptions>
// ---- L-2: transports, wave 1 (2-T) ---------------------------------------------------------------

/** `ok.usage` from the L-2 transports (AI SDK names) */
export type ChatUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number; reasoningTokens?: number }

/** Options every HTTP transport takes */
export interface HttpTransportOptions {
  /** Request headers, or a function of the request (e.g. a fresh session token) */
  headers?: Record<string, string> | ((request: ChatRequest) => Record<string, string> | Promise<Record<string, string>>);
  /** The fetch to use (default: globalThis.fetch): a proxy, a test or demo server, SSR */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  /** Extra JSON body fields (a request's own `body` is merged over them) */
  body?: Record<string, unknown>;
  /**
   * In a browser, a request with an auth header (Authorization, x-api-key, ...) to a host that is
   * neither local nor the page's origin is refused (SYG670): the key would ship to every visitor.
   * `true` allows it, for a key the user typed in themselves
   */
  dangerouslyAllowBrowser?: boolean;
}

export interface OpenResponsesOptions extends HttpTransportOptions {
  /** The API root (default '/v1'); POSTs to `${baseURL}/responses`. Ollama: 'http://localhost:11434/v1' */
  baseURL?: string;
  /** The model (a request's `model` overrides it) */
  model?: string;
  /**
   * OpenAI strict schemas for tools and `output` (default off, D266, D285): pass `strictSchemas`
   * (imported from sygnal/ai, so apps that don't use strict mode don't carry it). Each schema is
   * rewritten to the strict subset (all keys required, optional ones nullable, no extra keys), a
   * schema with no strict form is sent non-strict (SYG675), the nulls are dropped again before
   * validation. `true` is a dev error (SYG672): import strictSchemas
   */
  strict?: StrictSchemas | false;
}

export interface ChatCompletionsOptions extends HttpTransportOptions {
  /** The API root (default '/v1'); POSTs to `${baseURL}/chat/completions` */
  baseURL?: string;
  model?: string;
  /** As openResponses' `strict`: `strictSchemas` */
  strict?: StrictSchemas | false;
}

export interface UIMessageStreamOptions extends HttpTransportOptions {}

export type ChromePromptStatus = 'available' | 'downloadable' | 'downloading' | 'unavailable'

export interface ChromePromptOptions {
  temperature?: number;
  topK?: number;
  expectedInputs?: unknown[];
  expectedOutputs?: unknown[];
  /** Sees the model download's progress (`downloadprogress` events) */
  monitor?: (monitor: EventTarget) => void;
  /** The Prompt API object (default: globalThis.LanguageModel; tests pass a stub) */
  LanguageModel?: unknown;
}

export interface ChromePromptTransport extends ChatTransport {
  /** `LanguageModel.availability()`, or 'unavailable' without the API */
  status(): Promise<ChromePromptStatus>;
}

/**
 * openResponses({ baseURL, model }): a transport for Open Responses / OpenAI Responses SSE
 * (Ollama, vLLM, OpenRouter, OpenAI). Unknown events are ignored, as the spec requires.
 *
 *   run(App, { LLM: makeChatDriver({ transport: openResponses({ baseURL: 'http://localhost:11434/v1', model: 'llama3.2' }) }) })
 */
export function openResponses(options?: OpenResponsesOptions): ChatTransport

/** chatCompletions({ baseURL, model }): a transport for Chat Completions SSE (older local servers) */
export function chatCompletions(options?: ChatCompletionsOptions): ChatTransport

/**
 * uiMessageStream(url): a transport for an AI SDK 7 server route (`toUIMessageStreamResponse()`,
 * UI message stream v1). Messages go as UIMessages; server-run tools, approvals and `data-*`
 * parts come back as message parts. The production default: the provider key stays on the server.
 */
export function uiMessageStream(url: string, options?: UIMessageStreamOptions): ChatTransport

/** chromePrompt(): a transport for Chrome's on-device Prompt API (`LanguageModel`); `status()` says whether it can run */
export function chromePrompt(options?: ChromePromptOptions): ChromePromptTransport

/** One Open Responses SSE event (`event: type`, `data: JSON`) */
export interface OpenResponsesEvent { type: string; sequence_number: number; [key: string]: unknown }

/**
 * The Open Responses events of a scripted reply (D273), for demo and test servers:
 * chunks as `t.stream` takes them (strings, `{ reasoning }`, `{ toolCall }`, `{ finish }`) or ChatEvents.
 *
 *   'POST /v1/responses': () => ({ sse: encodeOpenResponses(['Hello ', 'there']) })
 */
export function encodeOpenResponses(
  chunks: ReadonlyArray<string | { reasoning: string } | { toolCall: { id?: string; name: string; input?: unknown } } | { finish: string | { reason?: string; usage?: unknown } } | ChatEvent>,
  options?: { id?: string; model?: string },
): OpenResponsesEvent[]
// ---- M-3: the command bar (3-M) -----------------------------------------------------------------

/** 'ready' | 'deciding' (the decision request is out) | 'running' (the action runs or waits for APPROVE / DENY) | 'error' */
export type CommandBarStatus = 'ready' | 'deciding' | 'running' | 'error'

/** Why a command wasn't run (`unsure`, or an escalated `result`) */
export interface CommandBarUnsure {
  command: string
  /**
   * 'confidence': the action's (or the target's) confidence is below `below`; 'no-action': the
   * model picked none of the actions; 'target': an item action with no clear item; 'input': the
   * action needs an argument the bar can't fill (a chat model can)
   */
  reason: 'confidence' | 'no-action' | 'target' | 'input'
  /** The tool the model leaned to, and its description */
  tool: string | null
  description: string | null
  /** The Collection item key it leaned to, and its `agent.label` */
  target: unknown
  label: string | null
  confidence: number
}

/** The last outcome: a call's result, or the hand-over to the chat behavior */
export type CommandBarResult =
  | ({ command: string; tool: string; input: unknown } & AgentResult)
  | (CommandBarUnsure & { escalated: string })

/** The command bar's slice: `state.cmd` for `uses = { cmd: commandBar(...) }` */
export interface CommandBarState {
  /** The input's value (cleared when a command ran) */
  text: string
  status: CommandBarStatus
  /** The command being handled, else null */
  command: string | null
  /** A consequential action waiting for APPROVE / DENY, else null */
  pending: AgentConfirmInfo | null
  /** Why the last command wasn't run (without `escalate`), else null */
  unsure: CommandBarUnsure | null
  result: CommandBarResult | null
  /** The decision request's failure, else null */
  error: string | null
}

/** The command bar's actions, as `'<key>.<ACTION>'` on the host */
export interface CommandBarActions {
  /** Run the input's command (Enter, or the form's submit, or a click of `run`), or the command given as data */
  RUN: string | Event | undefined
  /** Run the pending consequential action */
  APPROVE: any
  /** Decline it */
  DENY: any
  /** A command ran (a host entry `'cmd.DONE'` runs after the behavior's) */
  DONE: { command: string; tool: string; input: unknown } & AgentResult
  /** Internal: the input's value */
  INPUT: string
}

export interface CommandBarOptions {
  /** The command field: its input events set `text`; Enter runs it (unless `form` is given) */
  input: BehaviorTarget
  /** A form whose submit runs the command (instead of Enter in the field) */
  form?: BehaviorTarget
  /** Its clicks run the field's command too (a Go button, D288) */
  run?: BehaviorTarget
  /**
   * The decision request: `decide()` options without `state` / `questions` (`{ url, model }`), or
   * a function building the request (`(q) => decide.openai({ ...q, url, model })`)
   */
  decide: Omit<DecideOptions<Questions>, 'state' | 'questions'> | ((q: { state: unknown; questions: Questions }) => DecideRequest<any, any> | Record<string, unknown>)
  /** Below this confidence (the action's, and the target's for an item action) nothing runs (default 0.6) */
  below?: number
  /** The `uses` key of a `chat` behavior on the same host: an unsure command goes to its SEND */
  escalate?: string
  /** Whose `agent` actions are offered: by default the host's and its shown descendants' (D249); `[Comp, …]`: only these */
  agent?: Function[]
  /** The fetch driver's sink (default 'HTTP') */
  sink?: string
  /** Its clicks APPROVE the pending action */
  approve?: BehaviorTarget
  /** Its clicks DENY it */
  deny?: BehaviorTarget
  /**
   * The free text argument of a picked action whose input is one string (ADD's text). Default: a
   * heuristic, a quoted part of the command or else the command minus its first word ("add walk
   * the dog" → "walk the dog"); undefined escalates (or `unsure`, reason 'input')
   */
  freeText?: (command: string, tool: string) => string | undefined
}

/**
 * PLAN-6 M-3: a command bar on a decision model. `uses = { cmd: commandBar({ input: '.command',
 * decide: { url: '/api/decide', model: 'jev-latest' }, below: 0.6, escalate: 'assistant' }) }`:
 * one decision request per command picks the action (a `choice` over the `agent` actions'
 * descriptions; an enum input gives one option per value) and the target (a `choice` over the
 * live Collection item keys, labelled by `agent.label`), then runs it through the agent layer
 * (validation, no-op detection, cause 'agent', `pending` for a consequential action). Below
 * `below` confidence it hands the command to the chat behavior named by `escalate`, or sets
 * `unsure`. Its selectors are the host's own: render the field in the host's view.
 */
export function commandBar(options: CommandBarOptions): Behavior<CommandBarState, CommandBarActions, {}, CommandBarOptions>
// ---- L-2: transports, wave 2, and the strict layer (3-W2) ----------------------------------------

/** The provider dialect of a strict schema */
export type StrictDialect = 'openai' | 'anthropic'

/**
 * The strict schema layer (D285): pass it as a transport's `strict` option. Rewrites a portable
 * tool / output schema into the provider's strict subset; `errors` when it has none
 */
export type StrictSchemas = (schema: Record<string, unknown>, dialect?: StrictDialect) => { schema: Record<string, unknown>; errors: string[]; optional: number; unions: number }

/**
 * Strict mode for openResponses, chatCompletions and anthropicMessages, as an import so apps that
 * don't use it don't carry it:
 *
 *   openResponses({ baseURL, model, strict: strictSchemas })
 */
export const strictSchemas: StrictSchemas

export interface AnthropicMessagesOptions extends HttpTransportOptions {
  /** The API root (default '/v1'); POSTs to `${baseURL}/messages`. Ollama: 'http://localhost:11434/v1' */
  baseURL?: string;
  /** The model (a request's `model` overrides it) */
  model?: string;
  /** `max_tokens` (default 16000; a request's `maxTokens` overrides it) */
  maxTokens?: number;
  /**
   * Anthropic strict tool use and structured output (default off): `strictSchemas`. Schemas are
   * rewritten to Anthropic's subset; one without a strict form, or over Anthropic's per-request
   * limits (20 strict tools, 24 optional / 16 union-typed parameters), is sent non-strict (SYG675)
   */
  strict?: StrictSchemas | false;
  /** Anthropic server tools sent with the request's tools, e.g. `{ type: 'web_search_20260209', name: 'web_search' }`; their calls come back as executed tool parts */
  serverTools?: Array<Record<string, unknown>>;
}

/**
 * anthropicMessages({ baseURL, model }): a transport for Anthropic Messages SSE (Claude through
 * your server's proxy, or Ollama's /v1/messages). Thinking comes back as reasoning parts with
 * their signature (sent back on the next request), server tools as executed tool parts.
 * A hosted endpoint from the browser needs `dangerouslyAllowBrowser` (SYG670): proxy it instead.
 *
 *   anthropicMessages({ baseURL: '/api/anthropic/v1', model: 'claude-opus-5-5' })
 */
export function anthropicMessages(options?: AnthropicMessagesOptions): ChatTransport

export interface AguiOptions extends HttpTransportOptions {
  /** The AG-UI thread id (a request's `chatId` overrides it; default: one per transport) */
  threadId?: string;
  /** The initial agent state (a request's `state` overrides it; later runs send the latest state the agent sent) */
  state?: unknown;
  /** AG-UI context entries sent with every run */
  context?: Array<{ description: string; value: string }>;
}

/**
 * agui(url): a transport for an AG-UI agent endpoint (TanStack AI, CopilotKit, LangGraph,
 * Mastra servers). Tool calls the agent answers come back as executed tool parts; STATE_SNAPSHOT
 * / STATE_DELTA become a `data-agui-state` part (id 'state') holding the agent's current state,
 * MESSAGES_SNAPSHOT a `data-agui-messages` part, ACTIVITY_SNAPSHOT a `data-agui-activity` part.
 */
export function agui(url: string, options?: AguiOptions): ChatTransport

export interface FromAISDKOptions {
  /** The AI SDK's `streamText` (import { streamText } from 'ai'): sygnal never imports `ai` */
  streamText: (options: any) => any;
  /** An AI SDK LanguageModel (a request's `model` string is not used) */
  model: unknown;
  /** The AI SDK's `Output`, for requests with `output` */
  Output?: { object: (options: { schema: any }) => unknown };
  /** Other streamText settings (temperature, providerOptions, maxRetries, ...) */
  [setting: string]: unknown;
}

/**
 * fromAISDK({ streamText, model }): the AI SDK 7 in process as a transport, for SSR, servers
 * and tests. The provider key is wherever this runs: in a browser use uiMessageStream() instead.
 *
 *   import { streamText, Output } from 'ai'
 *   makeChatDriver({ transport: fromAISDK({ streamText, Output, model: anthropic('claude-opus-5-5') }) })
 */
export function fromAISDK(options: FromAISDKOptions): ChatTransport

// ---------------------------------------------------------------------------------------------
// PLAN-6 X-1 (3-X): MCP Apps, the view side (SEP-1865, protocol 2026-01-26)
// ---------------------------------------------------------------------------------------------

export type McpAppDisplayMode = 'inline' | 'fullscreen' | 'pip'
/** an MCP content block (text, image, audio, resource, resource_link) */
export type McpContentBlock = { type: string; [key: string]: any }
/** an MCP CallToolResult: what a server tool returned */
export interface McpToolResult {
  content: McpContentBlock[]
  structuredContent?: Record<string, any>
  isError?: boolean
  _meta?: Record<string, any>
  [key: string]: any
}
/** the host context: theme, display mode, container size, locale, ... (merged across changes) */
export interface McpHostContext {
  theme?: 'light' | 'dark'
  displayMode?: McpAppDisplayMode
  availableDisplayModes?: McpAppDisplayMode[]
  locale?: string
  timeZone?: string
  platform?: 'web' | 'desktop' | 'mobile'
  styles?: { variables?: Record<string, string | undefined>; css?: { fonts?: string } }
  containerDimensions?: Record<string, number | undefined>
  safeAreaInsets?: { top: number; right: number; bottom: number; left: number }
  toolInfo?: { id?: string | number; tool: { name: string; [key: string]: any } }
  [key: string]: any
}
/** what an `error` reply action of the MCP driver gets */
export interface McpAppError {
  error: string
  /** the JSON-RPC error code, when the host answered with an error */
  code?: number
  /** the result, when it came back with isError: true */
  result?: McpToolResult
  request: McpAppRequest
}
type McpReplies = { ok?: string; error?: string }
/** a value for an MCP driver sink (reply actions `ok` / `error` go to the sending component) */
export type McpAppRequest =
  | ({ callTool: string; args?: Record<string, unknown> } & McpReplies)
  | ({ updateModelContext: string | McpContentBlock[] | Record<string, unknown> } & McpReplies)
  | ({ message: string | McpContentBlock[] } & McpReplies)
  | ({ openLink: string } & McpReplies)
  | ({ displayMode: McpAppDisplayMode } & McpReplies)

export interface McpAppSource {
  readonly __sygnalReplies: true
  /** the arguments the model called the tool with (replayed to a stream that starts later) */
  select(type: 'tool-input' | 'tool-input-partial'): Stream<Record<string, any>>
  /** the server tool's result (replayed to a stream that starts later) */
  select(type: 'tool-result'): Stream<McpToolResult>
  select(type: 'tool-cancelled'): Stream<{ reason?: string }>
  /** the whole host context: first the handshake's, then after each change (replayed) */
  select(type: 'host-context-changed'): Stream<McpHostContext>
  /** the host is about to remove the view (answered after the actions it caused have run) */
  select(type: 'teardown'): Stream<{}>
  dispose(): void
}

export interface McpAppDriverOptions {
  /** the handshake's `appInfo` (default `{ name: document.title || 'sygnal-app', version: '0.0.0' }`) */
  appInfo?: { name: string; version: string; [key: string]: any }
  /** display modes the view supports */
  availableDisplayModes?: McpAppDisplayMode[]
  /** report the document's size to the host (`ui/notifications/size-changed`, default true) */
  autoResize?: boolean
  /**
   * `agentTools`: offer the app's `agent` tools (A-1) to the host as the view's own tools
   * (`appCapabilities.tools`, `tools/list`, `tools/call`, `notifications/tools/list_changed`).
   * Passed in so an app without it doesn't bundle the agent layer. Call makeMcpAppDriver()
   * before run(), as in `run(App, { MCP: makeMcpAppDriver({ tools: agentTools }) })`.
   */
  tools?: typeof agentTools
  /** with `tools`: consequential calls run when it resolves true (default: declined) */
  confirm?: AgentConfirm
  /** the host window (default `window.parent`) */
  host?: { postMessage(message: any, targetOrigin: string): void }
  /** the window to listen on (default `window`) */
  window?: any
  /** the protocol version offered (default '2026-01-26') */
  protocolVersion?: string
}

/**
 * makeMcpAppDriver(options?): the MCP Apps bridge as a driver, for a Sygnal app shown by an MCP
 * host (Claude, ChatGPT, VS Code, ...) in a sandboxed iframe. It does the `ui/initialize`
 * handshake on start. Source: `MCP.select('tool-input' | 'tool-input-partial' | 'tool-result' |
 * 'tool-cancelled' | 'host-context-changed' | 'teardown')`. Sinks: `{ callTool, args, ok, error }`,
 * `{ updateModelContext }`, `{ message }`, `{ openLink }`, `{ displayMode }`.
 *
 *   run(WeatherCard, { MCP: makeMcpAppDriver() })
 */
export function makeMcpAppDriver(options?: McpAppDriverOptions): (sink$: Stream<McpAppRequest>) => McpAppSource
