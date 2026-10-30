/** @jsxImportSource sygnal */
// The native view of the todo list: the neutral tags (view, row, txt, pressable, textinput,
// toggle), drawn as React Native components by nativeHost.js
import { Collection } from 'sygnal'
import { TodoLogic, TodosLogic, Draft, Add, ClearDone, Done, Remove } from './todos.logic'

export function Todo({ state }) {
  return (
    <row className="todo">
      <Done checked={state.done} />
      <txt style={{ flex: 1, fontSize: 17, textDecorationLine: state.done ? 'line-through' : 'none' }}>{state.title}</txt>
      <Remove aria-label={`Remove ${state.title}`}>✕</Remove>
    </row>
  )
}
Todo.intent = TodoLogic.intent
Todo.model = TodoLogic.model

export default function Todos({ state }) {
  return (
    <view>
      <txt style={{ fontSize: 28, fontWeight: '700' }}>Todos ({state.left} left)</txt>
      <row>
        <Draft value={state.draft} placeholder="What needs doing?" />
        <Add>Add</Add>
      </row>
      <view style={{ gap: 10 }}><Collection of={Todo} from="todos" /></view>
      <ClearDone>Clear done</ClearDone>
    </view>
  )
}
Todos.initialState = TodosLogic.initialState
Todos.calculated = TodosLogic.calculated
Todos.intent = TodosLogic.intent
Todos.model = TodosLogic.model
