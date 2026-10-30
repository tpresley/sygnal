/**
 * Shared logic: state, model, intent, calculated, and the controls the intent selects. No view,
 * nothing platform-specific: the same object is attached to a web view and a terminal view
 * (tasks.web.tsx, tasks.tui.tsx) by withView().
 */
import {controls, set, toggle} from 'sygnal'
import {TextInput, Pressable, Toggle} from '../primitives'

export const {Draft, Add, ClearDone} = controls({Draft: TextInput, Add: Pressable, ClearDone: Pressable})
export const {Done, Remove} = controls({Done: Toggle, Remove: Pressable})

export const TaskLogic = {
  intent: ({DOM}: any) => ({TOGGLE: DOM.click(Done), REMOVE: DOM.click(Remove)}),
  model: {TOGGLE: toggle('done'), REMOVE: () => undefined},
}

export const TasksLogic = {
  initialState: {draft: '', tasks: [] as {id: number, title: string, done: boolean}[]},
  calculated: {left: (s: any) => s.tasks.filter((t: any) => !t.done).length},
  intent: ({DOM}: any) => ({
    DRAFT: DOM.input(Draft).value(),
    ADD: DOM.click(Add),
    ENTER: DOM.keydown(Draft).key().filter((k: string) => k == 'Enter'),
    CLEAR: DOM.click(ClearDone),
  }),
  model: {
    DRAFT: set((_: any, draft: string) => ({draft})),
    ADD: (s: any) => add(s),
    ENTER: (s: any) => add(s),
    CLEAR: set((s: any) => ({tasks: s.tasks.filter((t: any) => !t.done)})),
  },
}
const add = (s: any) => {
  const title = s.draft.trim()
  if (!title) return s
  const id = s.tasks.reduce((m: number, t: any) => Math.max(m, t.id), 0) + 1
  return {...s, draft: '', tasks: [...s.tasks, {id, title, done: false}]}
}

/** a view with a logic's statics (a component is a function plus statics: the view is swappable) */
export const withView = <V extends Function>(logic: object, view: V): V => Object.assign(view, logic)
