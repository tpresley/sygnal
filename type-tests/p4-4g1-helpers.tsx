/**
 * PLAN-4 4-G1 (D143) type tests: undo() / undoable() `coalesce`, persist() `format: 'plain'` and
 * t.storage<ENTRY>(). Compiled by `npm run test:types`; never executed.
 */
import { describe, it, expectTypeOf } from 'vitest'
import { persist, renderComponent, undo, undoable } from 'sygnal'
import type { RootComponent, PersistedEntry, UndoOptions } from 'sygnal'

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

describe("persist format: 'plain'", () => {
  type Note = { title: string; body: string; status: string }
  const Note: RootComponent<Note> = ({ state }) => <p>{state.title}</p>
  Note.initialState = { title: '', body: '', status: '' }

  it('plain format, typed against the state keys', () => {
    Note.persist = persist({ key: 'note-draft', pick: ['title', 'body'], format: 'plain' })
    Note.persist = persist({ key: 'note-draft', pick: ['title', 'body'], format: 'plain', sync: true, storage: 'session' })
    Note.persist = persist({ key: 'note-draft', format: 'versioned', version: 2, migrate: (old, from) => (from === 1 ? { title: old.t } : undefined) })
    // @ts-expect-error not a state key
    Note.persist = persist({ key: 'note-draft', pick: ['titel'], format: 'plain' })
    // @ts-expect-error a plain entry has no version
    Note.persist = persist({ key: 'note-draft', format: 'plain', version: 2 })
    // @ts-expect-error a plain entry has no migrate
    Note.persist = persist({ key: 'note-draft', format: 'plain', migrate: () => undefined })
    // @ts-expect-error an unknown format
    Note.persist = persist({ key: 'note-draft', format: 'raw' })
  })

  it('renderComponent seeds a plain entry; t.storage<ENTRY>() reads it typed', async () => {
    const t = renderComponent(Note, { storage: { 'note-draft': { title: 'x', body: 'y' } } })
    await t.settle()
    expectTypeOf(t.storage('note-draft')).toEqualTypeOf<PersistedEntry<Note> | undefined>()
    expectTypeOf(t.storage<{ title: string; body: string }>('note-draft')).toEqualTypeOf<{ title: string; body: string } | undefined>()
    const title: string | undefined = t.storage<Pick<Note, 'title' | 'body'>>('note-draft')?.title
    void title
  })
})
