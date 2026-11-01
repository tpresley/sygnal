// Types for 'sygnal/api' (dev preview). The implementation lives in src/extra/api/.
// Structural only: no oRPC, openapi-typescript or Hono types are imported, so an app needs only
// the library it uses.
import type { ResourceRequest, SseConnection, FetchFailure, StandardSchemaLike } from 'sygnal'

// ── JSON on the wire ───────────────────────────────────────────────────

/**
 * What a value becomes after JSON: a `Date` is an ISO string, functions and symbols are gone,
 * `undefined` properties are optional. Replies are typed with it (the server's `Date` arrives as
 * a string).
 */
export type Jsonify<T> =
  T extends Date ? string :
  T extends string | number | boolean | null ? T :
  T extends bigint | symbol | ((...args: any[]) => any) ? never :
  T extends readonly (infer U)[] ? Jsonify<U>[] :
  T extends object ? { [K in keyof T as T[K] extends ((...args: any[]) => any) | symbol ? never : K]: Jsonify<T[K]> } :
  T

type SchemaIn<S> = S extends StandardSchemaLike<infer I, any> ? I : unknown
type SchemaOut<S> = S extends StandardSchemaLike<any, infer O> ? O : unknown
/** optional input (undefined allowed, or an object of optional fields): the argument may be left out */
type Args<IN, OPTS> = undefined extends IN ? [input?: IN, options?: OPTS] : {} extends IN ? [input?: IN, options?: OPTS] : [input: IN, options?: OPTS]

// ── endpoints and their requests ───────────────────────────────────────

/** A request built by an endpoint: a FetchRequest that remembers the reply and error types (phantom) */
export type ApiRequest<OUT = unknown, ERR = unknown> = Exclude<ResourceRequest, string> & {
  /** the endpoint id (an app key: not sent) */
  endpoint: string
  readonly '~output'?: OUT
  readonly '~error'?: ERR
}
/** A stream connection built by an endpoint, for the `connections` static */
export type ApiStream<OUT = unknown> = SseConnection & { endpoint: string; readonly '~output'?: OUT }

/** The fields a call may add to its request: reply actions, `latest`, `key`, cache and retry options, ... */
export type CallOptions = Omit<Exclude<ResourceRequest, string>, 'url' | 'method' | 'json' | 'body' | 'query' | 'multipart' | 'invalidates'> & {
  /** After a 2xx reply, refetch the resources of these GET endpoints (or tags) */
  invalidates?: ({ readonly id: string; readonly kind: 'query' | 'mutation' } | string)[]
  [key: string]: any
}
/** The actions and options of a stream connection (`message: 'ARRIVED'`, `open`, `close`, `resume`, ...) */
export type StreamOptions = Omit<SseConnection, 'sse'>

type EndpointInfo<K> = {
  /** `quotes.list` (oRPC: the router keys), `GET /quotes/{id}` (OpenAPI, Hono), `SSE /feed` */
  readonly id: string
  readonly kind: K
  readonly method: string
  /** The path as the contract declares it (`/quotes/{id}`, `/quotes/:id`) */
  readonly path: string
  /** Whether a request (in its `t.requests` form) was built by this endpoint */
  match(request: unknown): boolean
}

/**
 * One endpoint of a client: builds the request (or stream connection) for an input. `OUT` is the
 * reply as JSON delivers it; `RAW` the server's value before JSON (a `Date` where OUT has a string)
 */
export type Endpoint<IN, OUT, ERR = unknown, K extends 'query' | 'mutation' | 'stream' = 'query' | 'mutation' | 'stream', RAW = OUT> =
  (K extends 'stream'
    ? (...args: Args<IN, StreamOptions>) => ApiStream<OUT>
    : (...args: Args<IN, CallOptions>) => ApiRequest<OUT, ERR>) & EndpointInfo<K> & { readonly '~raw'?: RAW }
/** The server's value of an endpoint's reply, before JSON (what fixture() takes) */
export type RawOutput<E> = E extends { readonly '~raw'?: infer R } ? R : Output<E>

/**
 * The data of the endpoint's `ok` reply action (or of each stream event), as JSON delivers it:
 * `type Actions = { LOADED: Output<typeof api.quotes.get> }`
 */
export type Output<E> =
  E extends (...args: any[]) => { readonly '~output'?: infer O } ? O :
  E extends { readonly '~output'?: infer O } ? O : never
/** The input an endpoint takes */
export type Input<E> = E extends (...args: infer A) => any ? A[0] : never
/** The body of the endpoint's error replies (oRPC: its declared errors, by `code`) */
export type ErrorBody<E> =
  E extends (...args: any[]) => { readonly '~error'?: infer X } ? X :
  E extends { readonly '~error'?: infer X } ? X : unknown
/**
 * The data of the endpoint's `error` reply action: a FetchFailure whose `body` is typed:
 * `type Actions = { FAILED: ApiFailure<typeof api.quotes.add> }`
 */
export type ApiFailure<E> = Omit<FetchFailure, 'body'> & { body?: ErrorBody<E> }

/** Client options shared by every adapter */
export type ClientOptions = {
  /** Prefix of every path (oRPC: the handler's `prefix`, e.g. '/api') */
  prefix?: string
  /** Headers on every request and stream (e.g. `{ 'x-api-contract': contractHash(contract) }`) */
  headers?: Record<string, string>
  /** oRPC: validate replies against the output schemas on the client too (`validate` on each request; default false) */
  validate?: boolean
}

// ── oRPC ───────────────────────────────────────────────────────────────

/** oRPC's error body (OpenAPIHandler): a declared error, by code, or an undeclared one */
export type OrpcErrorBody<EM> =
  | { [C in keyof EM & string]: { defined: true; code: C; status: number; message: string; data: Jsonify<EM[C] extends { data?: infer D } ? SchemaOut<D> : undefined> } }[keyof EM & string]
  | { defined: false; code: string; status: number; message: string; data?: { issues?: { message: string; path?: (string | number)[] }[] } & Record<string, unknown> }

type OrpcProcedure = { '~orpc': { route: unknown; errorMap: unknown; inputSchema?: unknown; outputSchema?: unknown } }
type OrpcEndpoint<P> = P extends { '~orpc': { inputSchema?: infer I; outputSchema?: infer O; errorMap: infer EM } }
  ? SchemaOut<O> extends AsyncIterable<infer Y>
    ? Endpoint<unknown extends SchemaIn<I> ? undefined : SchemaIn<I>, Jsonify<Y>, OrpcErrorBody<EM>, 'stream', Y>
    : Endpoint<unknown extends SchemaIn<I> ? undefined : SchemaIn<I>, Jsonify<SchemaOut<O>>, OrpcErrorBody<EM>, 'query' | 'mutation', SchemaOut<O>>
  : never
/** The client of an oRPC contract router: the same tree, each procedure an Endpoint */
export type OrpcClient<R> = R extends OrpcProcedure ? OrpcEndpoint<R> : { [K in keyof R]: OrpcClient<R[K]> }

/**
 * A client for an oRPC contract router served by oRPC's **OpenAPIHandler** (plain JSON):
 * `const api = orpcClient(contract, { prefix: '/api' })`; `api.quotes.list({ tag })` is a GET
 * request (a resource), `api.quotes.add(input, { ok: 'ADDED', error: 'FAILED' })` a POST, and an
 * event iterator procedure (`.route({ method: 'GET' })`) an SSE connection. GET input goes in the
 * query string in bracket notation, so its non-string fields need coercing schemas (`z.coerce.number()`).
 */
export function orpcClient<R>(contract: R, options?: ClientOptions): OrpcClient<R>

// ── openapi-typescript ─────────────────────────────────────────────────

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete'
type Op<P, Path extends keyof P, M extends Method> = P[Path] extends { [K in M]: infer O } ? O : never
type PathsWith<P, M extends Method> = { [K in keyof P]: P[K] extends { [X in M]: infer O } ? ([O] extends [never | undefined] ? never : K) : never }[keyof P] & string
type JsonOf<C> = C extends { content: { 'application/json': infer J } } ? J : C extends { content: { [k: string]: infer J } } ? J : undefined
type Ok = 200 | 201 | 202 | 203 | 204 | 206 | '200' | '201' | '202' | '203' | '204' | '206' | '2XX'
type OpOutput<O> = O extends { responses: infer R } ? { [S in keyof R]: S extends Ok ? JsonOf<R[S]> : never }[keyof R] : unknown
type OpError<O> = O extends { responses: infer R } ? { [S in keyof R]: S extends Ok ? never : JsonOf<R[S]> }[keyof R] : unknown
type Defined<T> = [T] extends [never] ? false : [T] extends [undefined] ? false : true
type OpParams<O> = O extends { parameters: infer PS }
  ? { [K in keyof PS as K extends 'path' | 'query' | 'header' ? (Defined<PS[K]> extends true ? K : never) : never]: PS[K] }
  : {}
type OpInput<O> =
  (keyof OpParams<O> extends never ? {} : {} extends OpParams<O> ? { params?: OpParams<O> } : { params: OpParams<O> }) &
  (O extends { requestBody: infer B } ? { body: JsonOf<B> } : O extends { requestBody?: infer B } ? (Defined<B> extends true ? { body?: JsonOf<B> } : {}) : {})
type MaybeInput<I> = {} extends I ? I | undefined : I

/** A client for openapi-typescript's `paths` (types only): `openApiClient<paths>().get('/quotes/{id}')` is an endpoint */
export type OpenApiClient<P> = {
  [M in Method]: <Path extends PathsWith<P, M>>(path: Path) =>
    Endpoint<MaybeInput<OpInput<Op<P, Path, M>>>, Jsonify<OpOutput<Op<P, Path, M>>>, OpError<Op<P, Path, M>>, M extends 'get' ? 'query' : 'mutation'>
} & {
  /** A GET path that answers with server-sent events; `T` is the type of one event's data */
  sse<T = unknown, Path extends PathsWith<P, 'get'> = PathsWith<P, 'get'>>(path: Path): Endpoint<MaybeInput<OpInput<Op<P, Path, 'get'>>>, T, unknown, 'stream'>
}
/**
 * A client for an OpenAPI API through openapi-typescript's generated `paths` (any back end:
 * Go, Python, oRPC's OpenAPIGenerator, ...). Input is openapi-fetch's `{ params: { path, query },
 * body }`; query arrays repeat the key, objects use `key[field]`.
 */
export function openApiClient<P = Record<string, any>>(options?: ClientOptions): OpenApiClient<P>

// ── Hono ───────────────────────────────────────────────────────────────

type HonoOk = 200 | 201 | 202 | 203 | 204 | 206
type HonoEp<S, Path extends keyof S, M extends Method> = S[Path] extends { [K in `$${M}`]: infer E } ? E : never
type HonoPaths<S, M extends Method> = { [K in keyof S]: S[K] extends { [X in `$${M}`]: any } ? K : never }[keyof S] & string
type HonoOutput<E> = E extends { output: infer O; status: infer St } ? (St extends HonoOk ? O : never) : never
type HonoError<E> = E extends { output: infer O; status: infer St } ? (St extends HonoOk ? never : O) : never
type HonoInput<E> = E extends { input: infer I } ? I : {}

/** A client for a Hono app's routes (types only): `honoClient<ExtractSchema<typeof app>>().get('/quotes/:id')` */
export type HonoClient<S> = {
  [M in Method]: <Path extends HonoPaths<S, M>>(path: Path) =>
    Endpoint<MaybeInput<HonoInput<HonoEp<S, Path, M>>>, Jsonify<HonoOutput<HonoEp<S, Path, M>>>, HonoError<HonoEp<S, Path, M>>, M extends 'get' ? 'query' : 'mutation'>
} & {
  /** A GET route that streams server-sent events (`streamSSE`); `T` is the type of one event's data */
  sse<T = unknown, Path extends HonoPaths<S, 'get'> = HonoPaths<S, 'get'>>(path: Path): Endpoint<MaybeInput<HonoInput<HonoEp<S, Path, 'get'>>>, T, unknown, 'stream'>
}
/**
 * A client for Hono routes. Pass the app's schema with Hono's own `ExtractSchema<typeof app>`
 * (from 'hono/types'). Input is hc's `{ param, query, json }`.
 */
export function honoClient<S = Record<string, any>>(options?: ClientOptions): HonoClient<S>

// ── contract hash and version skew ─────────────────────────────────────

/**
 * A stable hash of a contract: for an oRPC router its ids, routes, input/output JSON Schemas
 * (Standard JSON Schema) and error codes; for anything else (an OpenAPI document) its stable
 * JSON. Send it as a header (`headers` option) and check it on the server with contractSkew.
 */
export function contractHash(contract: unknown): string
/**
 * On the server, before the API handler: a request whose `header` carries another hash is
 * answered 409 CONTRACT_SKEW (oRPC's error shape, `data: { client, server }`); otherwise
 * undefined. Requests without the header pass unless `require: true`.
 */
export function contractSkew(request: Request, options: { hash: string; header: string; require?: boolean }): Response | undefined
/** Whether an `error` reply is a CONTRACT_SKEW answer (the app is older than the server's API) */
export function isContractSkew(failure: unknown): boolean
/**
 * A `fetch` for makeFetchDriver / makeSocketDriver that notices CONTRACT_SKEW answers: reports
 * SYG690 once and calls `onSkew` for each (e.g. to offer a reload).
 */
export function contractFetch(options?: {
  fetch?: (input: any, init?: any) => Promise<Response>
  onSkew?: (info: { server: string | null; url: string }) => void
}): (input: any, init?: any) => Promise<Response>

// ── test fixtures ──────────────────────────────────────────────────────

/**
 * A reply body for `t.respond` (or one event for `t.push`): the server's value (a `Date` stays a
 * `Date`), typed by the endpoint and, for an oRPC contract, checked against its output schema (a
 * fixture that drifted from the contract throws). Returned as JSON delivers it.
 */
export function fixture<E extends Endpoint<any, any, any, any, any>>(endpoint: E, data: RawOutput<E>): Output<E>
/**
 * An error reply in oRPC's shape, its data checked against the declared error's schema:
 * `const e = errorFixture(api.quotes.add, 'DUPLICATE', { id: 1 }); await t.fail('HTTP', e.status, { body: e.body })`
 */
export function errorFixture<E extends Endpoint<any, any, any, any, any>, C extends DefinedCode<E>>(
  endpoint: E, code: C, data?: Extract<ErrorBody<E>, { code: C }> extends { data: infer D } ? D : unknown, message?: string,
): { status: number; body: [Extract<ErrorBody<E>, { code: C }>] extends [never] ? { defined: true; code: C; status: number; message: string; data: unknown } : Extract<ErrorBody<E>, { code: C }> }
/** The codes of an endpoint's declared errors (oRPC), else any string */
type DefinedCode<E> = [Extract<ErrorBody<E>, { defined: true }>] extends [never] ? string : Extract<ErrorBody<E>, { defined: true }>['code']

// ── function-first: *.server.ts modules ────────────────────────────────

/**
 * The `context` a server function gets: whatever the server passes to oRPC's
 * `handler.handle(request, { context })`. Augment it for your app:
 * `declare module 'sygnal/api' { interface ServerContext { user?: User } }`
 */
export interface ServerContext { [key: string]: unknown }

type ErrorMapOf = Record<string, { status?: number; message?: string; data?: StandardSchemaLike<any, any> }>
/** What a server function gets after its input: oRPC's handler options */
export type ServerFunctionOptions<EM = {}> = {
  context: ServerContext
  signal?: AbortSignal
  lastEventId?: string
  /** oRPC's declared-error constructors: `throw errors.DUPLICATE({ data: { id } })` */
  errors: { [C in keyof EM & string]: (options?: { message?: string; data?: EM[C] extends { data?: infer D } ? SchemaIn<D> : undefined; cause?: unknown }) => Error }
}
type FnOptions<EM> = {
  /** Validate the reply too (oRPC's `.output()`; each event of a stream) */
  output?: StandardSchemaLike<any, any>
  /** Declared errors, by code (oRPC's `.errors()`): typed on the client as `ErrorBody` */
  errors?: EM
}

/**
 * A query in a `*.server.ts` module: a POST that is a resource (tagged `api:<id>`, refetched by
 * `invalidates`). Its input is always validated: pass a Standard Schema, or leave it out to take
 * no input. `export const list = query(z.object({ tag: z.string() }), async ({ tag }) => db.list(tag))`
 * gives the client (through sygnal/vite's stub) `list({ tag }, { ok: 'LISTED' })`.
 */
export function query<S extends StandardSchemaLike<any, any>, R, EM extends ErrorMapOf = {}>(
  input: S, fn: (input: SchemaOut<S>, options: ServerFunctionOptions<EM>) => R, options?: FnOptions<EM>,
): Endpoint<SchemaIn<S>, Jsonify<Awaited<R>>, OrpcErrorBody<EM>, 'query', Awaited<R>>
export function query<R, EM extends ErrorMapOf = {}>(
  fn: (input: undefined, options: ServerFunctionOptions<EM>) => R, options?: FnOptions<EM>,
): Endpoint<undefined, Jsonify<Awaited<R>>, OrpcErrorBody<EM>, 'query', Awaited<R>>
/** A mutation in a `*.server.ts` module: a POST with reply actions (`ok`, `error`, `invalidates`) */
export function mutation<S extends StandardSchemaLike<any, any>, R, EM extends ErrorMapOf = {}>(
  input: S, fn: (input: SchemaOut<S>, options: ServerFunctionOptions<EM>) => R, options?: FnOptions<EM>,
): Endpoint<SchemaIn<S>, Jsonify<Awaited<R>>, OrpcErrorBody<EM>, 'mutation', Awaited<R>>
export function mutation<R, EM extends ErrorMapOf = {}>(
  fn: (input: undefined, options: ServerFunctionOptions<EM>) => R, options?: FnOptions<EM>,
): Endpoint<undefined, Jsonify<Awaited<R>>, OrpcErrorBody<EM>, 'mutation', Awaited<R>>
/**
 * A stream in a `*.server.ts` module: an async generator, one server-sent event per `yield`, for
 * `connections`. It is a GET, so its input comes from the query string (strings: coerce numbers).
 */
export function stream<S extends StandardSchemaLike<any, any>, Y, EM extends ErrorMapOf = {}>(
  input: S, fn: (input: SchemaOut<S>, options: ServerFunctionOptions<EM>) => AsyncIterable<Y>, options?: FnOptions<EM>,
): Endpoint<SchemaIn<S>, Jsonify<Y>, OrpcErrorBody<EM>, 'stream', Y>
export function stream<Y, EM extends ErrorMapOf = {}>(
  fn: (input: undefined, options: ServerFunctionOptions<EM>) => AsyncIterable<Y>, options?: FnOptions<EM>,
): Endpoint<undefined, Jsonify<Y>, OrpcErrorBody<EM>, 'stream', Y>

/**
 * On the server: the oRPC router of the app's `*.server.ts` modules (keys: their paths; the part
 * after `dir/` names them, so `/src/quotes.server.ts` is `quotes`). Mount `router` with oRPC's
 * OpenAPIHandler at the plugin's `api.prefix`, behind `skew(request)`:
 * ```ts
 * const fns = serverFunctions(import.meta.glob('/src/**\/*.server.ts', { eager: true }), { os })
 * ```
 */
export function serverFunctions(modules: Record<string, unknown>, options: {
  /** oRPC's `os` (from '@orpc/server'): Sygnal has no server of its own */
  os: unknown
  /** The folder the module paths are named from (default 'src', as the plugin's `api.dir`) */
  dir?: string
  /** The header the client stubs send `<file>:<hash>` in (default 'x-api-functions') */
  header?: string
}): {
  /** oRPC's router: `new OpenAPIHandler(router)` */
  router: any
  /** The contract the stubs are built from (plain data and the schemas) */
  contract: unknown
  /** Each file's contract hash */
  hashes: Record<string, string>
  /** 409 CONTRACT_SKEW for a request from a client built against another version of its file */
  skew(request: Request): Response | undefined
}
/** Generated code only (sygnal/vite): a client stub, or a server function given its id */
export function __serverFunction(id: string, value: unknown, client?: ClientOptions): any
