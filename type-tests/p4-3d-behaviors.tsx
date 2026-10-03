/**
 * PLAN-4 3-D type tests: the first-party behaviors pager, selection, undo (GS-1) and the
 * undoable() model wrapper (GS-8). Compiled by `npm run test:types`; never executed.
 */
import { describe, it, expectTypeOf } from 'vitest'
import { controls, pager, selection, isSelected, undoable, undo, ABORT } from 'sygnal'
import type { Component, UsesActions, UsesState, PagerState, PagerCalculated, SelectionState, UndoHistory, BehaviorState } from 'sygnal'

const { Older, Newer, Pick, All, Undo, Redo } = controls({ Older: 'button', Newer: 'button', Pick: 'input', All: 'input', Undo: 'button', Redo: 'button' })

describe('pager', () => {
  it('slice, calculated fields, options and actions', () => {
    const p = pager({ pageSize: 10, total: 42, next: Newer, prev: Older })
    expectTypeOf<BehaviorState<typeof p>>().toEqualTypeOf<PagerState & PagerCalculated>()
    expectTypeOf(p.state.pages).toEqualTypeOf<number | null>()
    pager()
    pager({ next: '.next' })
    // @ts-expect-error pageSize is a number
    pager({ pageSize: '10' })
    // @ts-expect-error an unknown option
    pager({ nxt: Newer })
    const uses = { pager: p }
    expectTypeOf<keyof UsesActions<typeof uses>>().toEqualTypeOf<'pager.NEXT' | 'pager.PREV' | 'pager.GOTO' | 'pager.SET_TOTAL'>()
    expectTypeOf<UsesActions<typeof uses>['pager.GOTO']>().toEqualTypeOf<number>()
  })
})

describe('selection', () => {
  it('slice, count, isSelected', () => {
    const uses = { sel: selection({ multi: true, item: Pick, all: All, from: 'mails' }) }
    type State = { mails: { id: number }[] } & UsesState<typeof uses>
    expectTypeOf<State['sel']['selected']>().toEqualTypeOf<string[]>()
    expectTypeOf<State['sel']['count']>().toEqualTypeOf<number>()
    const s = {} as State
    expectTypeOf(isSelected(s.sel, 1)).toEqualTypeOf<boolean>()
    isSelected(undefined, 'a')
    expectTypeOf<keyof UsesActions<typeof uses>>().toEqualTypeOf<'sel.SELECT' | 'sel.SELECT_ALL' | 'sel.TOGGLE_ALL' | 'sel.CLEAR'>()
    // @ts-expect-error multi is a boolean
    selection({ multi: 'yes' })
    const st: SelectionState = { selected: [] }
    expectTypeOf(st.selected).toEqualTypeOf<string[]>()
  })
})

describe('undoable / undo', () => {
  type State = { doc: { text: string }; history?: UndoHistory<{ text: string }> }
  it('undoable keeps the model entries and adds UNDO / REDO', () => {
    const model = undoable({
      TYPE: (s: State, text: string) => ({ ...s, doc: { text } }),
      LOAD: (s: State) => (s.doc.text ? ABORT : s),
    }, { key: 'doc', limit: 50, coalesceMs: 500, resetOn: ['LOAD'], track: ['TYPE'] })
    expectTypeOf(model.TYPE).toEqualTypeOf<(s: State, text: string) => State>()
    expectTypeOf(model).toHaveProperty('UNDO')
    expectTypeOf(model).toHaveProperty('REDO')
    // @ts-expect-error key is required
    undoable({}, {})
    const Editor: Component<State> = ({ state }) => <div>{state.doc.text}{state.history?.past.length}</div>
    Editor.model = model
  })

  it('undo() is a behavior with canUndo / canRedo', () => {
    const uses = { history: undo({ key: 'doc', undo: Undo, redo: Redo, coalesceMs: 300 }) }
    type S = { doc: string } & UsesState<typeof uses>
    expectTypeOf<S['history']['canUndo']>().toEqualTypeOf<boolean>()
    expectTypeOf<S['history']['past']>().toEqualTypeOf<any[]>()
    expectTypeOf<keyof UsesActions<typeof uses>>().toEqualTypeOf<'history.UNDO' | 'history.REDO'>()
    const Doc: Component<S> = ({ state }) => <button disabled={!state.history.canUndo}>Undo</button>
    Doc.uses = uses
    // @ts-expect-error key is required
    undo({ undo: Undo })
  })
})
