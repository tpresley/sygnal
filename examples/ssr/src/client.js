/**
 * Client-side hydration.
 *
 * The server renders both components and embeds their state
 * into window.__COUNTER_STATE__ and window.__TODO_STATE__.
 * We pick up that state here and boot each component into
 * its server-rendered mount point so it becomes interactive.
 */
import { run } from 'sygnal'
import Counter from './Counter.jsx'
import TodoList from './TodoList.jsx'

// Hydrate Counter
const counterState = window.__COUNTER_STATE__
if (counterState) {
  Counter.initialState = counterState
}
run(Counter, {}, { mountPoint: '#counter-app' })

// Hydrate TodoList
const todoState = window.__TODO_STATE__
if (todoState) {
  TodoList.initialState = todoState
}
run(TodoList, {}, { mountPoint: '#todo-app' })
