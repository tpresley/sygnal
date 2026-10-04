/**
 * PLAN-4 4-G1 (D143) type tests: undo() / undoable() `coalesce`, persist() `format: 'plain'` and
 * t.storage<ENTRY>(). Compiled by `npm run test:types`; never executed.
 */
import { describe, it, expectTypeOf } from 'vitest'
import { undo, undoable } from 'sygnal'
import type { UndoOptions } from 'sygnal'

describe('undo coalesce', () => {
  it('coalesce lists action names, with or without coalesceMs', () => {
    undo({ key: 'poster', coalesce: ['HEADLINE'], coalesceMs: 1000, undo: '.undo', redo: '.redo' })
    undo({ key: 'poster', coalesce: ['HEADLINE'] })
    undoable({ HEADLINE: (s: { poster: string }, h: string) => ({ ...s, poster: h }) }, { key: 'poster', coalesce: ['HEADLINE'] })
    expectTypeOf<UndoOptions['coalesce']>().toEqualTypeOf<string[] | undefined>()
    // @ts-expect-error coalesce is a list of action names
    undo({ key: 'poster', coalesce: 'HEADLINE' })
  })
})
