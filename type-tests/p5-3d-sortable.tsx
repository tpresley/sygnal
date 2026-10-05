/**
 * PLAN-5 3-D (B-1) type tests: the `sortable` behavior. Compiled by `npm run test:types`; never
 * executed.
 */
import { describe, it, expectTypeOf } from 'vitest'
import { Collection, sortable } from 'sygnal'
import type { Component, UsesActions, UsesState, SortableState, SortableDropped } from 'sygnal'

describe('sortable', () => {
  it('slice, options and actions', () => {
    const uses = { sort: sortable({ from: 'tasks', item: '.task', handle: '.grip' }) }
    type State = { tasks: { id: number; title: string }[] } & UsesState<typeof uses>
    expectTypeOf<State['sort']>().toEqualTypeOf<SortableState>()
    expectTypeOf<State['sort']['dragging']>().toEqualTypeOf<string | null>()
    expectTypeOf<State['sort']['helpId']>().toEqualTypeOf<string | null>()
    expectTypeOf<UsesActions<typeof uses>['sort.DROPPED']>().toEqualTypeOf<SortableDropped>()
    expectTypeOf<SortableDropped['index']>().toEqualTypeOf<number>()

    sortable({ from: ['todo', 'done'], axis: 'x', threshold: 8, attr: 'data-key', idField: 'key',
      label: (t) => t.title, messages: { drop: (label, n, m) => `${label}: ${n}/${m}` } })
    // @ts-expect-error from is required
    sortable({ item: '.task' })
    // @ts-expect-error axis is 'x' or 'y'
    sortable({ from: 'tasks', axis: 'z' })

    const List: Component<State> = ({ state }) => (
      <section>
        <p id={state.sort.helpId ?? undefined} hidden>Space picks up an item</p>
        <ul><Collection of={() => <li />} from="tasks" /></ul>
        <p role="status" aria-live="assertive">{state.sort.message}</p>
      </section>
    )
    List.uses = uses
  })
})
