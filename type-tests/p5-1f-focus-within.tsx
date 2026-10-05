/**
 * PLAN-5 1-F (D194) type tests: focusWithin as an ELEMENT focus target. Compiled by
 * `npm run test:types`; never executed.
 */
import { describe, it, expectTypeOf } from 'vitest'
import { focusWithin, ABORT } from 'sygnal'
import type { Component, ElementCommand, WithinTarget } from 'sygnal'

describe('D194: focusWithin', () => {
  it('returns a target the focus command takes, with its options', () => {
    expectTypeOf(focusWithin('.title')).toEqualTypeOf<WithinTarget>()
    const cmd: ElementCommand = { focus: focusWithin('.title'), preventScroll: true }
    void cmd
    // @ts-expect-error a selector string
    focusWithin(3)
  })

  it('works in a model ELEMENT entry', () => {
    type State = { rows: { id: number }[]; next: number }
    const List: Component<State> = () => <ul />
    List.model = {
      ADD: {
        STATE: (s) => ({ ...s, rows: [...s.rows, { id: s.next }], next: s.next + 1 }),
        ELEMENT: (s) => (s.next > 10 ? ABORT : { focus: focusWithin(`[data-id="${s.next}"] input`) }),
      },
    }
  })
})
