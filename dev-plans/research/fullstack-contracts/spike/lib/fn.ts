// Spike, function-first: a `*.server.ts` module exports server functions; the function's own
// signature is the contract. On the server (SSR / Node) an export is the procedure with its
// implementation; in the client build the Vite plugin (./vite-server-functions.ts) replaces the
// whole module with stubs, so the implementation and its imports never reach the browser.
// TypeScript checks the client against the real module, so input and output types need no copy.
import type { Args, ApiRequest, ApiStream, CallOptions, InputOf, Kind, OutputOf, Schema, StreamActions } from './contract.ts'
import { callable } from './contract.ts'

type Ctx = { signal: AbortSignal; [key: string]: any }
type AnyContract = Record<string, any>

export type ServerFn<K extends Kind, IN extends Schema, OUT> = (K extends 'stream'
  ? (...args: Args<InputOf<IN>, StreamActions>) => ApiStream<OUT>
  : (...args: Args<InputOf<IN>, CallOptions<AnyContract>>) => ApiRequest<OUT>) & {
  kind: K
  /** the procedure name (`<module path>/<export>`), set on the client stub */
  procedure: string
  input: IN
  /** the implementation (server only: the client stub has none) */
  run: (input: OutputOf<IN>, ctx: Ctx) => any
}

const define = (kind: Kind): any => (input: Schema, run: any) =>
  // the server-side value is also callable as the client builder would be (handy in SSR), named
  // later by collect()
  Object.assign((..._: any[]) => { throw new Error('call a server function through its client stub') }, { kind, input, run })

export const query = define('query') as <IN extends Schema, R>(input: IN, run: (input: OutputOf<IN>, ctx: Ctx) => R) => ServerFn<'query', IN, Awaited<R>>
export const mutation = define('mutation') as <IN extends Schema, R>(input: IN, run: (input: OutputOf<IN>, ctx: Ctx) => R) => ServerFn<'mutation', IN, Awaited<R>>
export const stream = define('stream') as <IN extends Schema, T>(input: IN, run: (input: OutputOf<IN>, ctx: Ctx) => AsyncIterable<T>) => ServerFn<'stream', IN, T>

/** `/src/quotes.server.ts` → `src/quotes`: the procedure prefix, the same in the stubs and the handler */
export const moduleName = (rootRelative: string) => rootRelative.replace(/^\/+/, '').replace(/\.server\.[cm]?[jt]s$/, '')

/** the client stub the plugin emits for one export */
export const rpcStub = (name: string, kind: Kind) => callable(name, kind)

/**
 * modules (`import.meta.glob('/**\/*.server.ts', { eager: true })`) → a contract and an
 * implementation for createHandler, named `<module path>/<export>` as the stubs are
 */
export function collect(modules: Record<string, Record<string, any>>, moduleName: (file: string) => string) {
  const contract: Record<string, any> = {}
  const impl: Record<string, any> = {}
  for (const [file, mod] of Object.entries(modules)) {
    for (const [exp, fn] of Object.entries(mod)) {
      if (!fn || typeof fn.run !== 'function') continue
      const name = `${moduleName(file)}/${exp}`
      // output schema: none in function-first form (the server's return type is the contract)
      contract[name] = { kind: fn.kind, input: fn.input, output: { '~standard': { version: 1, vendor: 'none', validate: (value: unknown) => ({ value }) } } }
      impl[name] = fn.run
    }
  }
  return { contract, impl }
}
