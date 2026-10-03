// PLAN-4 GS-13 (D127): 'sygnal/element' defineElement types
import { defineElement } from 'sygnal/element'
import type { ElementOptions, SygnalElementConstructor } from 'sygnal/element'

function Board({ state }: { state: { title: string } }) { return null }

// Typed props: the constructor's instances carry them
const TaskBoard = defineElement('task-board', Board, {
  props: { title: String, count: Number, readonly: Boolean, tasks: Array, meta: Object },
  events: { PARENT: 'task-picked' },
  shadow: true,
  styles: ['.title { color: green }', new CSSStyleSheet()],
})
const el = new TaskBoard()
const title: string | undefined = el.title
const count: number | undefined = el.count
const readonly: boolean = el.readonly
const tasks: any[] | undefined = el.tasks
el.meta = { a: 1 }
el.addEventListener('task-picked', (e) => (e as CustomEvent).detail)
// @ts-expect-error count is a number
el.count = 'x'
// @ts-expect-error not a declared prop (and not an HTMLElement member)
el.nope = 1
const html: HTMLElement = el
const attrs: string[] = TaskBoard.observedAttributes

// An array of names: all String
const Names = defineElement('name-tag', Board, { props: ['first', 'lastName'] })
const n = new Names()
const first: string | undefined = n.first
// @ts-expect-error a string prop
n.lastName = 3

// No options
const Plain: SygnalElementConstructor = defineElement('plain-el', Board)
customElements.get('plain-el') satisfies CustomElementConstructor | undefined

// Options type, and invalid values
const opts: ElementOptions = { shadow: 'closed', props: ['a'] }
// @ts-expect-error shadow mode
defineElement('bad-el', Board, { shadow: 'half' })
// @ts-expect-error prop types are constructors
defineElement('bad-el2', Board, { props: { a: 'string' } })
// @ts-expect-error events map sink names to event names
defineElement('bad-el3', Board, { events: { PARENT: 1 } })

export { title, count, readonly, tasks, html, attrs, first, Plain, opts }
