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
  /** `read` returns user-entered strings (WebMCP's untrustedContentHint) */
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
