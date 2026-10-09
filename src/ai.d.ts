// Types for 'sygnal/ai' (PLAN-6). The implementation lives in src/extra/ai/ (D253).
import type { FetchRequest } from 'sygnal'

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
