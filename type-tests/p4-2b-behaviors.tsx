/**
 * PLAN-4 2-B type tests: GS-1 defineBehavior and the `uses` static. Compiled by
 * `npm run test:types`; never executed.
 */
import { describe, it, expectTypeOf } from 'vitest'
import { defineBehavior, controls, ABORT, run } from 'sygnal'
import type { AnyControl, Behavior, BehaviorFactory, BehaviorState, Component, RootComponent, UsesActions, UsesState } from 'sygnal'
import type { Stream } from 'xstream'

const { Older, Newer } = controls({ Older: 'button', Newer: 'button' })

const pager = defineBehavior({
  initialState: { page: 0, pageSize: 20 },
  intent: ({ DOM, STATE }, { next, prev }: { next: AnyControl; prev: AnyControl }) => {
    expectTypeOf(STATE.watch(s => s.page)).toEqualTypeOf<Stream<number>>()
    return { NEXT: DOM.click(next), PREV: DOM.click(prev), JUMP: STATE.watch(s => s.pageSize) }
  },
  model: {
    NEXT: (p) => ({ ...p, page: p.page + 1 }),
    PREV: (p) => (p.page === 0 ? ABORT : { ...p, page: p.page - 1 }),
    JUMP: (p, n) => ({ ...p, page: Number(n) }),
  },
  calculated: { offset: (p) => p.page * p.pageSize },
})

describe('GS-1: defineBehavior', () => {
  it('infers the slice, the calculated fields, the options and the action names', () => {
    type Slice = { page: number; pageSize: number }
    expectTypeOf(pager).toMatchTypeOf<BehaviorFactory<Slice, any, { offset: number }, { next: AnyControl; prev: AnyControl }>>()
    const used = pager({ pageSize: 10, next: Newer, prev: Older })
    expectTypeOf(used.state).toEqualTypeOf<Slice & { offset: number }>()
    expectTypeOf<BehaviorState<typeof used>>().toEqualTypeOf<Slice & { offset: number }>()
    expectTypeOf(used.merge).toBeFunction()
    // @ts-expect-error a slice option has the slice's type
    pager({ pageSize: 'ten', next: Newer, prev: Older })
    // @ts-expect-error the typed options are required properties
    pager({ pageSize: 10 })
  })

  it('model reducers get the slice (with calculated fields) and must return a slice', () => {
    defineBehavior({
      initialState: { open: false },
      model: {
        TOGGLE: (s) => {
          expectTypeOf(s.open).toEqualTypeOf<boolean>()
          return { ...s, open: !s.open }
        },
        // @ts-expect-error not the slice
        BAD: (s) => ({ ...s, open: 'yes' }),
        EMIT: { EVENTS: (s) => ({ type: 'OPENED', data: s.open }), EFFECT: (s, _d, next) => { next('TOGGLE') } },
      },
    })
  })
})

describe('GS-1: uses on a component', () => {
  const uses = { pager: pager({ next: Newer, prev: Older }) }
  type State = { items: string[] } & UsesState<typeof uses>
  type Actions = UsesActions<typeof uses>

  it('UsesState / UsesActions give the host state keys and the namespaced actions', () => {
    expectTypeOf<State['pager']>().toEqualTypeOf<{ page: number; pageSize: number } & { offset: number }>()
    expectTypeOf<keyof Actions>().toEqualTypeOf<'pager.NEXT' | 'pager.PREV' | 'pager.JUMP'>()
    expectTypeOf<Actions['pager.JUMP']>().toEqualTypeOf<number>()
  })

  it('is a static of Component and RootComponent; the host may handle a behavior action', () => {
    const List: Component<State> = ({ state }) => <ul>{state.items.slice(state.pager.offset).map(i => <li>{i}</li>)}</ul>
    List.initialState = { items: [], pager: pager().state }
    List.uses = uses
    List.model = { 'pager.NEXT': { EFFECT: (s) => { console.log(s.pager.page) } } }
    const App: RootComponent<State> = () => <div />
    App.uses = { pager: pager({ next: Newer, prev: Older }) }
    // @ts-expect-error not a behavior
    App.uses = { pager: 3 }
    run(App)
    expectTypeOf<NonNullable<Component['uses']>[string]>().toEqualTypeOf<Behavior<any, any, any, any>>()
  })
})
