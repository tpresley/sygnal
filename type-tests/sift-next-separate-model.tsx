import type { Component } from 'sygnal'

type State = { n: number; saved?: string }
type Actions = { SAVE: number; SAVED: { id: string } }

const Saver: Component<State, {}, {}, Actions> = ({ state }) => <div>{state.n}</div>

// a model declared apart from the component: its `next` annotated as a plain function
const model = {
  SAVE: {
    EFFECT: (_s: State, _d: number, next: (action: string, data?: any) => void) => { next('SAVED', { id: 'a' }) },
  },
  SAVED: (s: State, d: { id: string }) => ({ ...s, saved: d.id }),
}
Saver.model = model

// a separately declared model whose EFFECT names a delay too
const model2 = {
  SAVE: { EFFECT: (_s: State, _d: number, next: (action: string, data?: any, delay?: number) => void) => next('SAVED', { id: 'b' }, 10) },
}
Saver.model = model2

// inline, next stays checked against the component's actions (name and data)
Saver.model = {
  SAVE: {
    EFFECT: (_s, n, next) => {
      next('SAVED', { id: String(n) })
      next('SAVE', 2, 100)
      // @ts-expect-error — NOPE is not an action
      next('NOPE')
      // @ts-expect-error — SAVED carries { id: string }
      next('SAVED', 42)
      // a name computed at run time
      const name: string = n > 1 ? 'SAVE' : 'SAVED'
      next(name)
    },
  },
}

// a reducer typed for another component's actions doesn't fit
type OtherActions = { OTHER: boolean }
const other = {
  SAVE: { EFFECT: (_s: State, _d: number, next: <K extends keyof OtherActions>(action: K, data?: OtherActions[K]) => void) => next('OTHER', true) },
}
// @ts-expect-error — its next() only knows OTHER
Saver.model = other
