// Spike: a contract shared by a Sygnal client and its server. Isomorphic: no server code here.
//
// The contract lists procedures with Standard Schemas. The client turns a procedure call into
// plain data that today's drivers already understand:
//   query    → a GET FetchRequest   (works as a `resources` entry, with queryCache, retry, latest)
//   mutation → a POST FetchRequest  (reply actions, `invalidates` by procedure name)
//   stream   → an SseConnection     (a `connections` entry; events arrive as the named action)
// so the effect stays data, the reply comes back as an action, and no new driver is needed.
import type { ResourceRequest, SseConnection, StandardSchemaLike } from 'sygnal'

type RequestObject = Exclude<ResourceRequest, string>

export type Schema<I = any, O = I> = StandardSchemaLike<I, O>
export type InputOf<S> = S extends StandardSchemaLike<infer I, any> ? I : never
export type OutputOf<S> = S extends StandardSchemaLike<any, infer O> ? O : never

export type Kind = 'query' | 'mutation' | 'stream'
export type Procedure<K extends Kind = Kind, IN extends Schema = Schema, OUT extends Schema = Schema> = {
  kind: K
  input: IN
  output: OUT
  /** mutations: the queries this one makes stale, by name (declared once: the client refetches its
   *  own after the reply, the server tells every other client over the sync stream) */
  invalidates?: string[]
}
export type Contract = Record<string, Procedure>

export const query = <IN extends Schema, OUT extends Schema>(p: { input: IN; output: OUT }): Procedure<'query', IN, OUT> => ({ kind: 'query', ...p })
export const mutation = <IN extends Schema, OUT extends Schema>(p: { input: IN; output: OUT; invalidates?: string[] }): Procedure<'mutation', IN, OUT> => ({ kind: 'mutation', ...p })
/** `output` is the schema of one event */
export const stream = <IN extends Schema, OUT extends Schema>(p: { input: IN; output: OUT }): Procedure<'stream', IN, OUT> => ({ kind: 'stream', ...p })

/** the contract, as written (a function so the names are checked and later tooling has a marker) */
export const defineApi = <C extends Contract>(c: C): C => {
  for (const [name, p] of Object.entries(c))
    for (const q of p.invalidates ?? [])
      if (c[q]?.kind !== 'query') throw new Error(`defineApi: ${name} invalidates ${q}, which is not a query of this contract`)
  return c
}

/** the sync stream's path (a name no procedure can take: names are identifiers) */
export const SYNC = '$sync'

/** the header every RPC request carries: a cross-origin page can't send it without a CORS preflight */
export const RPC_HEADER = 'x-sygnal-rpc'

// ── client ────────────────────────────────────────────────────────────

type QueryNames<C extends Contract> = { [K in keyof C]: C[K]['kind'] extends 'query' ? K : never }[keyof C] & string

/** the request fields a call site may add: reply actions, latest/key, cache, retry, ... */
export type CallOptions<C extends Contract> = Omit<RequestObject, 'url' | 'method' | 'json' | 'body' | 'query' | 'invalidates' | 'validate'> & {
  /** queries to refetch after a 2xx, by procedure name or by the query itself (they are tagged `rpc:<name>`) */
  invalidates?: (QueryNames<C> | { procedure: string; kind: 'query' })[]
  [key: string]: any
}

/** a FetchRequest that remembers its procedure's output type (phantom: never set at run time) */
export type ApiRequest<OUT> = RequestObject & { readonly __output?: OUT }
export type ApiStream<OUT> = SseConnection & { readonly __output?: OUT }

export type StreamActions = Pick<SseConnection, 'message' | 'open' | 'close' | 'error' | 'meta' | 'resume' | 'staleAfterMs' | 'background' | 'reconnect'>

// optional input: `undefined` allowed → the argument may be left out
export type Args<IN, REST> = undefined extends IN ? [input?: IN, options?: REST] : [input: IN, options?: REST]

export type ClientOf<C extends Contract> = {
  [K in keyof C]: C[K] extends Procedure<'stream', infer IN, infer OUT>
    ? (...args: Args<InputOf<IN>, StreamActions>) => ApiStream<OutputOf<OUT>>
    : C[K] extends Procedure<any, infer IN, infer OUT>
      ? ((...args: Args<InputOf<IN>, CallOptions<C>>) => ApiRequest<OutputOf<OUT>>) & { path: string; kind: C[K]['kind']; procedure: K }
      : never
}

export type ClientOptions = {
  /** URL prefix of the RPC endpoints (default '/rpc') */
  prefix?: string
  /** validate replies against the output schemas on the client too (default false: the server already did) */
  validateReplies?: boolean
}

/** the procedure's output type, for a reducer's data: `LOADED: Output<typeof api.getQuote>` */
export type Output<P> = P extends Procedure<any, any, infer O> ? OutputOf<O> : P extends (...a: any[]) => { readonly __output?: infer O } ? O : never
export type Input<P> = P extends Procedure<any, infer I, any> ? InputOf<I> : never

const encodeInput = (input: unknown) => (input === undefined ? undefined : { input: JSON.stringify(input) })

/** the request builder of one procedure (shared by createClient and the *.server.ts stubs) */
export function callable(name: string, kind: Kind, { prefix = '/rpc', output, invalidates: declared }: { prefix?: string; output?: Schema; invalidates?: string[] } = {}) {
  const path = `${prefix}/${name}`
  const validate = output ? { validate: output } : {}
  const tagged = (invalidates?: (string | { procedure: string })[]) => invalidates && { invalidates: invalidates.map((n) => `rpc:${typeof n == 'string' ? n : n.procedure}`) }
  const call =
    kind === 'stream'
      ? (input: unknown, actions: StreamActions = {}): SseConnection => {
          const q = encodeInput(input)
          return {
            sse: q ? `${path}?${new URLSearchParams(q)}` : path,
            // a header makes the socket driver read the stream with fetch (FetchEventSource):
            // CSRF-safe, and the same code path runs in Node and in tests
            headers: { [RPC_HEADER]: '1' },
            ...actions,
          }
        }
      : kind === 'query'
        ? (input: unknown, { invalidates, ...opts }: any = {}) => ({
            url: path,
            ...(input !== undefined && { query: encodeInput(input) }),
            headers: { [RPC_HEADER]: '1' },
            tags: [`rpc:${name}`],
            ...validate,
            ...tagged(invalidates),
            ...opts,
          })
        : (input: unknown, { invalidates = declared, ...opts }: any = {}) => ({
            url: path,
            method: 'POST',
            json: input === undefined ? null : input,
            headers: { [RPC_HEADER]: '1' },
            ...validate,
            ...tagged(invalidates),
            ...opts,
          })
  return Object.assign(call, { path, kind, procedure: name })
}

export function createClient<C extends Contract>(contract: C, options: ClientOptions = {}): ClientOf<C> & { $sync: (actions: StreamActions) => SseConnection } {
  const client: any = {}
  for (const name of Object.keys(contract)) {
    const p = contract[name]
    client[name] = callable(name, p.kind, { prefix: options.prefix, output: options.validateReplies ? p.output : undefined, invalidates: p.invalidates })
  }
  // the server's invalidation stream: each event is a list of tags for `{ invalidate: tags }`
  const sync = callable(SYNC, 'stream', { prefix: options.prefix })
  client.$sync = (actions: StreamActions) => sync(undefined, actions)
  return client
}

// ── typed reducers ────────────────────────────────────────────────────

/**
 * Identity helpers that type a reply reducer's data from the contract, so the reducer needs no
 * hand-written type: `LOADED: replies.getQuote((state, quote) => …)`.
 */
export type RepliesOf<C extends Contract> = {
  [K in keyof C]: <S>(reducer: (state: S, data: OutputOf<C[K]['output']>, ...rest: any[]) => any) => typeof reducer
} & {
  /** the `error` reply: `{ error, status?, body?, request }` */
  error: <S>(reducer: (state: S, failure: { error: Error & { status?: number; body?: any }; status?: number; body?: { message?: string; issues?: any[] }; request: any }, ...rest: any[]) => any) => typeof reducer
}
export const repliesOf = <C extends Contract>(_contract: C): RepliesOf<C> =>
  new Proxy({}, { get: () => (reducer: any) => reducer }) as any

/** the same for one procedure or server function: `ADDED: reply(addQuote, (state, quote) => …)` */
export const reply = <P, S>(_proc: P, reducer: (state: S, data: Output<P>, ...rest: any[]) => any) => reducer
export type Failure = Parameters<Parameters<RepliesOf<{}>['error']>[0]>[1]
export const failure = <S>(reducer: (state: S, failure: Failure, ...rest: any[]) => any) => reducer
