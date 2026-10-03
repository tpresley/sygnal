/**
 * PLAN-4 2-B type tests: GS-6 STATE.watch. Compiled by `npm run test:types`; never executed.
 */
import { describe, it, expectTypeOf } from 'vitest'
import { debounce } from 'sygnal'
import type { Component, IntentSources } from 'sygnal'
import type { Stream } from 'xstream'

type Draft = { draft: string; status: 'idle' | 'saving'; user: { name: string } }

describe('GS-6: STATE.watch', () => {
  it('is a stream of the selector result; options are { immediate?: boolean }', () => {
    const intent = ({ STATE }: IntentSources<Draft>) => {
      const draft$ = STATE.watch(s => s.draft)
      expectTypeOf(draft$).toEqualTypeOf<Stream<string>>()
      const user$ = STATE.watch(s => ({ name: s.user.name }), { immediate: true })
      expectTypeOf(user$).toEqualTypeOf<Stream<{ name: string }>>()
      // @ts-expect-error not a key of the state
      STATE.watch(s => s.nope)
      // @ts-expect-error immediate is a boolean
      STATE.watch(s => s.draft, { immediate: 'yes' })
      return { SAVE: draft$.compose(debounce(500)) }
    }
    const Editor: Component<Draft> = ({ state }) => <textarea value={state.draft} />
    Editor.initialState = { draft: '', status: 'idle', user: { name: '' } }
    Editor.intent = intent
    Editor.model = { SAVE: (s) => ({ ...s, status: 'saving' }) }
  })
})
