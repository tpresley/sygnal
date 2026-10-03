/**
 * PLAN-4 3-A: ElementCommandRegistry augmentation (a control spec's commands, D102, and other
 * methods of the element). Compiled with the SygnalEvents registry program (see
 * ./events-registry.ts): the augmentation is global to a program.
 */
import { controls } from 'sygnal'
import type { Component, ControlSpecObject } from 'sygnal'

declare module 'sygnal' {
  interface ElementCommandRegistry {
    open: { at?: number }
    play: {}
  }
}

const dateSpec: ControlSpecObject<{ value?: string }> = {
  kind: 'test-date',
  vnode: (props, children, h) => h('div', { className: 'date' }),
  commands: { open: (el, options) => void [el, options] },
}
const { DueDate, Player } = controls({ DueDate: dateSpec, Player: 'video' })

const Planner: Component<{}> = () => <div><DueDate /><Player /></div>
Planner.model = {
  PICK: { ELEMENT: { open: DueDate, at: 3 } },
  PLAY: { ELEMENT: { play: Player } },
  BOTH: { ELEMENT: [{ open: DueDate }, { focus: DueDate }] },
  // @ts-expect-error at is a number
  BAD: { ELEMENT: { open: DueDate, at: 'now' } },
  // @ts-expect-error still not a command
  TYPO: { ELEMENT: { opne: DueDate } },
}
void Planner
