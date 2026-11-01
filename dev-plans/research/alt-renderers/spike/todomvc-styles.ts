import type {TermRule} from './terminal'

// todomvc's CSS, as far as layout goes, for the terminal
export const todoStyles: TermRule[] = [
  ['.todo .edit', {display: 'none'}],
  ['.todo.editing .edit', {display: 'inline'}],
  ['.todo.editing .view', {display: 'none'}],
  ['.todo.completed label', {after: ' ✓'}],
  ['.filters li', {display: 'inline'}],
  ['.filters a.selected', {before: '*', after: '*'}],
  ['h1', {upper: true}],
  ['label[for="toggle-all"]', {display: 'none'}],
  // <Transition name="todo" duration={300}>'s classes, as todomvc's CSS animates them
  ['.todo-leave-active', {after: ' (leaving)'}],
]
