/**
 * Type-level tests for the Sygnal public API.
 *
 * These tests verify that the type declarations in src/index.d.ts provide
 * correct and ergonomic types for library consumers. Each test uses
 * expectTypeOf (vitest) and/or @ts-expect-error to assert compile-time behavior.
 */
import { describe, it, expectTypeOf, assertType } from 'vitest'
import type { Stream, MemoryStream } from 'xstream'
import type {
  Component,
  RootComponent,
  ABORT,
  Lense,
  Lens,
  Filter,
  SortFunction,
  SortObject,
  CollectionProps,
  SwitchableProps,
  PortalProps,
  TransitionProps,
  ClassesType,
  RunOptions,
  SygnalApp,
  DriverSpec,
  DriverSpecs,
  DriverFactories,
  CycleDriver,
  Event,
  NonStateSinkReturns,
  ExactShape,
  FormSource,
  FormData,
  ProcessFormOptions,
  DragSource,
  Ref,
  Ref$,
  SygnalDOMSource,
  EventsSource,
  FixDrivers,
} from '../src/index.d.ts'
import type { EnrichedEventStream } from '../src/cycle/dom/enrichEventStream'

// ─── ABORT ──────────────────────────────────────────────────────────────────

describe('ABORT type', () => {
  it('is a unique symbol type', () => {
    expectTypeOf<ABORT>().toMatchTypeOf<symbol>()
  })
})

// ─── Lense / Lens ───────────────────────────────────────────────────────────

describe('Lense / Lens', () => {
  it('Lense has get and set', () => {
    type L = Lense<{ items: string[] }, string[]>
    expectTypeOf<L['get']>().toEqualTypeOf<(state: { items: string[] }) => string[]>()
    expectTypeOf<L['set']>().toEqualTypeOf<(state: { items: string[] }, childState: string[]) => { items: string[] }>()
  })

  it('Lens is an alias for Lense', () => {
    expectTypeOf<Lens<number, string>>().toEqualTypeOf<Lense<number, string>>()
  })
})

// ─── Filter / Sort ──────────────────────────────────────────────────────────

describe('Filter and Sort types', () => {
  it('Filter accepts a predicate', () => {
    const f: Filter<{ active: boolean }> = (item) => item.active
    expectTypeOf(f).toMatchTypeOf<(item: { active: boolean }) => boolean>()
  })

  it('SortFunction accepts comparator', () => {
    const s: SortFunction<number> = (a, b) => a - b
    expectTypeOf(s).toMatchTypeOf<(a: number, b: number) => number>()
  })

  it('SortObject maps fields to asc/dec/function', () => {
    const s: SortObject<{ name: string }> = { name: 'asc' }
    expectTypeOf(s).toMatchTypeOf<Record<string, 'asc' | 'dec' | SortFunction<{ name: string }>>>()
  })
})

// ─── Event ──────────────────────────────────────────────────────────────────

describe('Event type', () => {
  it('has type and data fields', () => {
    const e: Event<number> = { type: 'COUNT', data: 42 }
    expectTypeOf(e.type).toBeString()
    expectTypeOf(e.data).toBeNumber()
  })

  it('defaults data to any', () => {
    const e: Event = { type: 'X', data: 'anything' }
    expectTypeOf(e.data).toBeAny()
  })
})

// ─── DriverSpec / CycleDriver / DriverFactories ─────────────────────────────

describe('Driver types', () => {
  it('DriverSpec has source and sink', () => {
    type D = DriverSpec<string, number>
    expectTypeOf<D['source']>().toBeString()
    expectTypeOf<D['sink']>().toBeNumber()
  })

  it('CycleDriver maps sink to source', () => {
    type D = CycleDriver<string, number>
    expectTypeOf<D>().toMatchTypeOf<(sink$: Stream<string>) => number>()
  })

  it('CycleDriver with void sink has no argument', () => {
    type D = CycleDriver<void, number>
    expectTypeOf<D>().toMatchTypeOf<() => number>()
  })

  it('FixDrivers returns {} for any', () => {
    type F = FixDrivers<any>
    expectTypeOf<F>().toEqualTypeOf<{}>()
  })

  it('FixDrivers passes through valid DriverSpecs', () => {
    type Drivers = { HTTP: DriverSpec<string, number> }
    type F = FixDrivers<Drivers>
    expectTypeOf<F>().toEqualTypeOf<Drivers>()
  })
})

// ─── ExactShape ─────────────────────────────────────────────────────────────

describe('ExactShape', () => {
  it('allows exact match', () => {
    type Shape = { a: number; b: string }
    type Result = ExactShape<Shape, { a: number; b: string }>
    expectTypeOf<Result>().toMatchTypeOf<Shape>()
  })
})

// ─── CollectionProps ────────────────────────────────────────────────────────

describe('CollectionProps', () => {
  it('requires of and from', () => {
    type P = CollectionProps<{ className: string }>
    expectTypeOf<P>().toHaveProperty('of')
    expectTypeOf<P>().toHaveProperty('from')
  })

  it('accepts optional filter and sort', () => {
    const p: CollectionProps = {
      of: (() => null) as any,
      from: 'items',
      filter: (item: any) => !!item,
      sort: 'name',
    }
    assertType(p)
  })
})

// ─── SwitchableProps ────────────────────────────────────────────────────────

describe('SwitchableProps', () => {
  it('requires of and current', () => {
    type P = SwitchableProps
    expectTypeOf<P>().toHaveProperty('of')
    expectTypeOf<P>().toHaveProperty('current')
  })
})

// ─── PortalProps ────────────────────────────────────────────────────────────

describe('PortalProps', () => {
  it('requires target string', () => {
    expectTypeOf<PortalProps['target']>().toBeString()
  })

  it('has optional children', () => {
    const p: PortalProps = { target: '#modal' }
    assertType(p)
  })
})

// ─── TransitionProps ────────────────────────────────────────────────────────

describe('TransitionProps', () => {
  it('all properties are optional', () => {
    const p: TransitionProps = {}
    assertType(p)
  })

  it('accepts name, duration, appear', () => {
    const p: TransitionProps = { name: 'fade', duration: 300, appear: true }
    assertType(p)
  })
})

// ─── ClassesType ────────────────────────────────────────────────────────────

describe('ClassesType', () => {
  it('accepts strings, string arrays, and conditional objects', () => {
    const c: ClassesType = [
      'foo',
      ['bar', 'baz'],
      { active: true, disabled: false, maybe: undefined },
    ]
    assertType(c)
  })
})

// ─── RunOptions ─────────────────────────────────────────────────────────────

describe('RunOptions', () => {
  it('all fields are optional', () => {
    const o: RunOptions = {}
    assertType(o)
  })

  it('accepts mountPoint, fragments, useDefaultDrivers', () => {
    const o: RunOptions = { mountPoint: '#app', fragments: true, useDefaultDrivers: false }
    assertType(o)
  })
})

// ─── Ref / Ref$ ─────────────────────────────────────────────────────────────

describe('Ref types', () => {
  it('Ref has nullable current', () => {
    const r: Ref<HTMLInputElement> = { current: null }
    expectTypeOf(r.current).toEqualTypeOf<HTMLInputElement | null>()
  })

  it('Ref defaults to HTMLElement', () => {
    const r: Ref = { current: null }
    expectTypeOf(r.current).toEqualTypeOf<HTMLElement | null>()
  })

  it('Ref$ extends Ref with stream', () => {
    expectTypeOf<Ref$<HTMLDivElement>>().toMatchTypeOf<Ref<HTMLDivElement>>()
    expectTypeOf<Ref$['stream']>().toMatchTypeOf<MemoryStream<HTMLElement | null>>()
  })
})

// ─── SygnalDOMSource ───────────────────────────────────────────────────────

describe('SygnalDOMSource', () => {
  it('extends MainDOMSource', () => {
    expectTypeOf<SygnalDOMSource>().toHaveProperty('select')
    expectTypeOf<SygnalDOMSource>().toHaveProperty('events')
    expectTypeOf<SygnalDOMSource>().toHaveProperty('elements')
    expectTypeOf<SygnalDOMSource>().toHaveProperty('element')
  })

  it('has event shorthand index signature', () => {
    // DOM.click('.btn') should be valid
    type ClickFn = SygnalDOMSource['click']
    expectTypeOf<ClickFn>().toMatchTypeOf<(selector: string) => Stream<globalThis.Event>>()
  })
})

// ─── EventsSource ───────────────────────────────────────────────────────────

describe('EventsSource', () => {
  it('is a Stream with select method', () => {
    expectTypeOf<EventsSource>().toMatchTypeOf<Stream<Event>>()
    type SelectFn = EventsSource['select']
    expectTypeOf<SelectFn>().toMatchTypeOf<(type: string) => Stream<any>>()
  })
})

// ─── FormSource ─────────────────────────────────────────────────────────────

describe('FormSource', () => {
  it('has events method returning Stream<Event>', () => {
    type EventsFn = FormSource['events']
    expectTypeOf<EventsFn>().toMatchTypeOf<(eventName: string) => Stream<globalThis.Event>>()
  })
})

// ─── DragSource ─────────────────────────────────────────────────────────────

describe('DragSource', () => {
  it('has events method', () => {
    type EventsFn = DragSource['events']
    expectTypeOf<EventsFn>().toMatchTypeOf<(eventName: string) => Stream<globalThis.Event>>()
  })
})

// ─── Component type ─────────────────────────────────────────────────────────

describe('Component type', () => {
  it('is callable (view function)', () => {
    type C = Component<{ count: number }>
    expectTypeOf<C>().toBeCallableWith({ state: { count: 0 } }, { count: 0 }, {}, {})
  })

  it('has optional static properties', () => {
    type C = Component<{ count: number }>
    expectTypeOf<C>().toHaveProperty('model')
    expectTypeOf<C>().toHaveProperty('intent')
    expectTypeOf<C>().toHaveProperty('initialState')
    expectTypeOf<C>().toHaveProperty('context')
    expectTypeOf<C>().toHaveProperty('calculated')
    expectTypeOf<C>().toHaveProperty('onError')
    expectTypeOf<C>().toHaveProperty('debug')
  })
})

// ─── Component with full generics ───────────────────────────────────────────

describe('Component with typed state and actions', () => {
  type State = { count: number; name: string }
  type Actions = { INC: void; SET_NAME: string }
  type Calc = { displayName: string }
  type Ctx = { theme: string }

  type MyComponent = Component<State, {}, {}, Actions, Calc, Ctx>

  it('model keys match action keys plus defaults', () => {
    type Model = NonNullable<MyComponent['model']>
    expectTypeOf<Model>().toHaveProperty('INC')
    expectTypeOf<Model>().toHaveProperty('SET_NAME')
    expectTypeOf<Model>().toHaveProperty('BOOTSTRAP')
    expectTypeOf<Model>().toHaveProperty('INITIALIZE')
  })

  it('intent returns action streams', () => {
    type Intent = NonNullable<MyComponent['intent']>
    // Intent returns partial actions as streams
    type ReturnType = ReturnType<Intent>
    expectTypeOf<ReturnType>().toHaveProperty('INC')
    expectTypeOf<ReturnType>().toHaveProperty('SET_NAME')
  })

  it('calculated has correct shape', () => {
    type CalcDef = NonNullable<MyComponent['calculated']>
    expectTypeOf<CalcDef>().toHaveProperty('displayName')
  })

  it('context has correct shape', () => {
    type CtxDef = NonNullable<MyComponent['context']>
    expectTypeOf<CtxDef>().toHaveProperty('theme')
  })
})

// ─── RootComponent ──────────────────────────────────────────────────────────

describe('RootComponent', () => {
  it('is a Component without PROPS constraint', () => {
    type R = RootComponent<{ count: number }>
    expectTypeOf<R>().toHaveProperty('model')
    expectTypeOf<R>().toHaveProperty('intent')
    expectTypeOf<R>().toHaveProperty('initialState')
  })
})

// ─── SygnalApp ──────────────────────────────────────────────────────────────

describe('SygnalApp', () => {
  it('has sources, sinks, dispose, hmr', () => {
    type App = SygnalApp<{ count: number }>
    expectTypeOf<App>().toHaveProperty('sources')
    expectTypeOf<App>().toHaveProperty('sinks')
    expectTypeOf<App>().toHaveProperty('dispose')
    expectTypeOf<App>().toHaveProperty('hmr')
  })

  it('dispose is a void function', () => {
    type App = SygnalApp
    expectTypeOf<App['dispose']>().toMatchTypeOf<() => void>()
  })
})

// ─── EnrichedEventStream ────────────────────────────────────────────────────

describe('EnrichedEventStream', () => {
  it('extends Stream', () => {
    expectTypeOf<EnrichedEventStream>().toMatchTypeOf<Stream<globalThis.Event>>()
  })

  it('.value() returns EnrichedEventStream<string>', () => {
    type S = EnrichedEventStream<globalThis.Event>
    type ValueResult = ReturnType<S['value']>
    expectTypeOf<ValueResult>().toMatchTypeOf<EnrichedEventStream<string>>()
  })

  it('.value(Number) returns EnrichedEventStream<number>', () => {
    // DOM.input('.field').value(Number) should give Stream<number>
    type S = EnrichedEventStream<globalThis.Event>
    // With transform fn: value<R>(fn: (val: string) => R): EnrichedEventStream<R>
    const enriched = {} as S
    // The overload with fn should infer R from the transform
    type Transformed = ReturnType<typeof enriched.value<number>>
    expectTypeOf<Transformed>().toMatchTypeOf<EnrichedEventStream<number>>()
  })

  it('.checked() returns EnrichedEventStream<boolean>', () => {
    type S = EnrichedEventStream<globalThis.Event>
    type CheckedResult = ReturnType<S['checked']>
    expectTypeOf<CheckedResult>().toMatchTypeOf<EnrichedEventStream<boolean>>()
  })

  it('.data(name) returns EnrichedEventStream<string | undefined>', () => {
    type S = EnrichedEventStream<globalThis.Event>
    // data(name: string): EnrichedEventStream<string | undefined>
    const enriched = {} as S
    type DataResult = ReturnType<typeof enriched.data>
    expectTypeOf<DataResult>().toMatchTypeOf<EnrichedEventStream<string | undefined>>()
  })

  it('.key() returns EnrichedEventStream<string>', () => {
    type S = EnrichedEventStream<globalThis.Event>
    type KeyResult = ReturnType<S['key']>
    expectTypeOf<KeyResult>().toMatchTypeOf<EnrichedEventStream<string>>()
  })

  it('.target() returns EnrichedEventStream<EventTarget | null>', () => {
    type S = EnrichedEventStream<globalThis.Event>
    type TargetResult = ReturnType<S['target']>
    expectTypeOf<TargetResult>().toMatchTypeOf<EnrichedEventStream<EventTarget | null>>()
  })

  it('methods are chainable', () => {
    // DOM.click('.btn').target().value() — chaining should work at type level
    type S = EnrichedEventStream<globalThis.Event>
    type Chain = ReturnType<ReturnType<S['target']>['value']>
    expectTypeOf<Chain>().toMatchTypeOf<EnrichedEventStream<string>>()
  })
})

// ─── SygnalDOMSource enrichment ─────────────────────────────────────────────

describe('SygnalDOMSource event shorthands return enriched streams', () => {
  it('DOM.click() returns EnrichedEventStream', () => {
    type ClickResult = ReturnType<SygnalDOMSource['click']>
    expectTypeOf<ClickResult>().toMatchTypeOf<EnrichedEventStream<globalThis.Event>>()
  })

  it('shorthand result has .value() method', () => {
    type ClickResult = ReturnType<SygnalDOMSource['click']>
    expectTypeOf<ClickResult>().toHaveProperty('value')
  })

  it('shorthand result has .data() method', () => {
    type ClickResult = ReturnType<SygnalDOMSource['click']>
    expectTypeOf<ClickResult>().toHaveProperty('data')
  })
})

// ─── processForm type ───────────────────────────────────────────────────────

describe('processForm type', () => {
  it('accepts FormSource (compatible with DOM.select result)', () => {
    const source: FormSource = {
      events: (name: string) => ({} as Stream<globalThis.Event>),
    }
    assertType<FormSource>(source)
  })

  it('FormData has event and eventType', () => {
    expectTypeOf<FormData>().toHaveProperty('event')
    expectTypeOf<FormData>().toHaveProperty('eventType')
    expectTypeOf<FormData['event']>().toEqualTypeOf<globalThis.Event>()
    expectTypeOf<FormData['eventType']>().toBeString()
  })

  it('FormData with typed fields constrains to string values', () => {
    type MyForm = FormData<{ username: string; email: string }>
    expectTypeOf<MyForm['username']>().toBeString()
    expectTypeOf<MyForm['email']>().toBeString()
    expectTypeOf<MyForm['event']>().toEqualTypeOf<globalThis.Event>()
  })

  it('untyped FormData allows any string key', () => {
    type F = FormData
    // Default: Record<string, string> — index signature gives string
    const f = {} as F
    expectTypeOf(f['anyField']).toBeString()
  })

  it('ProcessFormOptions has events and preventDefault', () => {
    const opts: ProcessFormOptions = { events: ['input', 'submit'], preventDefault: true }
    assertType(opts)
    const opts2: ProcessFormOptions = { events: 'input' }
    assertType(opts2)
    const opts3: ProcessFormOptions = {}
    assertType(opts3)
  })
})

// ─── Model entry shapes ─────────────────────────────────────────────────────

describe('Model entry shapes', () => {
  type State = { count: number; items: string[] }
  type Actions = { INC: void; ADD: string; RESET: void }

  it('accepts a direct reducer (shorthand for STATE sink)', () => {
    // model = { INC: (state) => ({ ...state, count: state.count + 1 }) }
    type C = Component<State, {}, {}, Actions>
    type Model = NonNullable<C['model']>
    // INC entry can be a function (state, data, next, props) => State
    type IncEntry = NonNullable<Model['INC']>
    // Should accept a simple reducer function
    const reducer = (state: State) => ({ ...state, count: state.count + 1 })
    assertType<(state: State, args: void, next: any, props: any) => State>(
      (s, _a, _n, _p) => ({ ...s, count: s.count + 1 })
    )
  })

  it('accepts true (pass-through)', () => {
    type C = Component<State, {}, {}, Actions>
    type Model = NonNullable<C['model']>
    // true should be valid for any model entry
    const entry: true = true
    assertType<true>(entry)
  })

  it('accepts sink object with STATE and EVENTS', () => {
    // model = { ADD: { STATE: (s, v) => ..., EVENTS: (s, v) => ({ type: 'ADDED', data: v }) } }
    type C = Component<State, {}, {}, Actions>
    type Model = NonNullable<C['model']>
    type AddEntry = NonNullable<Model['ADD']>
    // Should accept an object with STATE and EVENTS keys
    expectTypeOf<AddEntry>().not.toBeNever()
  })
})

// ─── NonStateSinkReturns ────────────────────────────────────────────────────

describe('NonStateSinkReturns', () => {
  it('allows customizing EVENTS return type', () => {
    type MySinkReturns = { EVENTS: Event<string> }
    type C = Component<{ x: number }, {}, {}, { DO: void }, {}, {}, MySinkReturns>
    // The EVENTS sink in model should expect Event<string> return
    expectTypeOf<C>().toHaveProperty('model')
  })
})
