import { defineElement } from 'sygnal/element'
import Board from './Board.jsx'

const options = {
  props: { heading: String, tasks: Array, readonly: Boolean },
  events: { PARENT: 'task-picked' },
  shadow: true,
  styles: '.title { color: rgb(0, 128, 0); }',
}
defineElement('task-board', Board, options)

export function defineLate() {
  defineElement('late-board', Board, options)
}
