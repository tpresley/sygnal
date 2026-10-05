/**
 * PLAN-5 V-1 type tests: <VirtualCollection> props and the scrollToIndex / scrollToId element
 * commands. Compiled by `npm run test:types`; never executed.
 */
import { describe, it } from 'vitest'
import { VirtualCollection } from 'sygnal'
import type { Component, ElementCommand } from 'sygnal'

type Row = { id: number; label: string }
type State = { rows: Row[]; title: string; target: number }

const Item: Component<Row> = ({ state }) => <div className="row">{state.label}</div>

describe('V-1: VirtualCollection', () => {
  it('takes Collection props plus the container props', () => {
    const List: Component<State> = () => (
      <div>
        <VirtualCollection of={Item} from="rows" className="rows" estimateSize={32} overscan={8} aria-label="Rows" />
        <VirtualCollection of={Item} from="rows" estimateSize={(r: Row) => (r.label.length > 40 ? 64 : 32)} role="listbox" style={{ height: '400px' }} />
        <VirtualCollection of={Item} from="rows" filter={(r: Row) => r.id > 2} sort={{ label: 'asc' }} tabIndex={-1} />
      </div>
    )
    void List
  })

  it('type-checks from against the parent state (instantiation expression)', () => {
    const Rows = VirtualCollection<{}, State>
    void <Rows of={Item} from="rows" />
    // @ts-expect-error 'title' is not an array field
    void <Rows of={Item} from="title" />
  })

  it('rejects a non-number estimateSize / overscan', () => {
    // @ts-expect-error a string
    void <VirtualCollection of={Item} from="rows" estimateSize="32" />
    // @ts-expect-error a string
    void <VirtualCollection of={Item} from="rows" overscan="5" />
  })

  it('scrollToIndex / scrollToId are element commands with their options', () => {
    const a: ElementCommand = { scrollToIndex: '.rows', index: 500, align: 'start' }
    const b: ElementCommand = { scrollToId: '.rows', id: 'r-9', align: 'center', behavior: 'smooth' }
    void a; void b
    // @ts-expect-error an align that doesn't exist
    const c: ElementCommand = { scrollToIndex: '.rows', index: 1, align: 'top' }
    void c
    const List: Component<State> = () => <div />
    List.model = {
      JUMP: { ELEMENT: (s) => ({ scrollToIndex: '.rows', index: s.target }) },
      FIND: { ELEMENT: (s, id: number) => ({ scrollToId: '.rows', id }) },
    }
  })
})
