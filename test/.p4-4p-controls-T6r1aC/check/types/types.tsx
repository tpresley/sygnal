import { controls } from 'sygnal'
import type { Component, RenderResult } from 'sygnal'

const { Draft, Add } = controls({ Draft: 'input', Add: 'button' })

type State = { draft: string }

export const NewTodo: Component<State> = ({ state }) => (
  <div>
    <label>New todo <Draft value={state.draft} placeholder="Milk" /></label>
    <Add type="button">Add</Add>
  </div>
)

// @ts-expect-error: `valeu` is not an <input> prop
export const typo = <Draft valeu="x" />

export const draftOf = (t: RenderResult<State>): string => t.query(Draft)?.value ?? ''
