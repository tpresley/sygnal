/** compose.generated (experimental): the runtime from sygnal/sandbox, the part, the events' data from the emits schemas, the repair slice */
import { compose, defineCatalog } from 'sygnal/ai'
import type { ComposeGenerated, GeneratedRepairState } from 'sygnal/ai'
import type { StandardSchemaLike } from 'sygnal'
import { generatedRuntime, sucraseCompiler, lintGenerated, GENERATED_LIMITS } from 'sygnal/sandbox'
import type { GeneratedRuntime, GeneratedFailure, SandboxReject } from 'sygnal/sandbox'
import type { Stream } from 'xstream'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
function expectType<T extends true>(): void {}

declare const kernel: string
declare const OpenCustomer: StandardSchemaLike<{ id: number }>
declare const Filter: StandardSchemaLike<{ status: 'paid' | 'pending' }>
declare const CHILD: any

type State = { orders: Array<{ id: number }>; fix?: GeneratedRepairState }

const runtime: GeneratedRuntime = generatedRuntime({
  kernel,
  compile: sucraseCompiler(() => import('sucrase' as string)),
  check: (code) => (code.includes('TODO') ? ['line 1: a TODO'] : []),
  limits: { bootMs: 800 },
})
void runtime.compile('x').then((r) => { if (r.ok) expectType<Equal<typeof r.source, string>>(); else expectType<Equal<typeof r.error, string>>() })
const issues: string[] = lintGenerated('<b onClick={f} />')
void issues
void GENERATED_LIMITS.bootMs
const why: GeneratedFailure = 'empty'
void why
const rj: SandboxReject['reason'] = 'undeclared'
void rj

const gen = compose.generated(runtime, {
  data: { orders: { description: 'the orders', shape: '[{ id: number }]', from: (s: State) => s.orders } },
  emits: {
    OPEN_CUSTOMER: { description: 'the user picked a customer', schema: OpenCustomer },
    FILTER_STATUS: { schema: Filter },
  },
  isolation: 'thread',
  maxUses: 2,
})
const g: ComposeGenerated<any, any> = gen
void g

const open$ = gen.events(CHILD, 'OPEN_CUSTOMER')
expectType<Equal<typeof open$, Stream<{ node: string } & { id: number }>>>()
const filter$ = gen.events(CHILD, 'FILTER_STATUS')
expectType<Equal<typeof filter$, Stream<{ node: string } & { status: 'paid' | 'pending' }>>>()
// @ts-expect-error not a declared emits type
gen.events(CHILD, 'DELETE_ALL')

const catalog = defineCatalog({ parts: { custom: gen.part } })
void catalog
const cards = defineCatalog({ parts: { card: gen.card('OPEN_CUSTOMER') }, rows: false })
void cards
// @ts-expect-error a card answers with a declared type
gen.card('NOPE')

const instructions: string = gen.instructions
void instructions
const fix = gen.repair({ maxAttempts: 2 })
expectType<Equal<typeof fix.initialState, GeneratedRepairState>>()

// @ts-expect-error a runtime from generatedRuntime()
compose.generated({}, {})
// @ts-expect-error emits take a Standard Schema
compose.generated(runtime, { emits: { X: { schema: { type: 'object' } } } })
// @ts-expect-error a code param is format 'code'
defineCatalog({ parts: { p: { description: 'p', params: { code: { type: 'text', format: 'js' } } } } })
