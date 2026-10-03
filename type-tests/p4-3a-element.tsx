/**
 * PLAN-4 3-A type tests: element commands, the built-in ELEMENT sink (GS-2), and t.commands.
 * Compiled by `npm run test:types`; never executed. Registered commands (ElementCommandRegistry)
 * are in ./registry/element-commands-registry.tsx (an augmentation is global to a program).
 */
import { describe, it, expectTypeOf } from 'vitest'
import { controls, renderComponent, ABORT } from 'sygnal'
import type { Component, ElementCommand, ElementCommands, ElementTarget } from 'sygnal'

const { Email, HelpDialog, Row, Tip, Submit } = controls({ Email: 'input', HelpDialog: 'dialog', Row: 'li', Tip: 'div', Submit: 'button' })

type State = { email: string; errors: { email?: string } }

describe('ELEMENT sink values', () => {
  it('commands: method first, then its options; controls or selectors', () => {
    const C: Component<State> = ({ state }) => <form><Email value={state.email} /><HelpDialog /><Submit /></form>
    C.model = {
      SUBMIT: {
        STATE: (s) => ({ ...s, errors: s.email.includes('@') ? {} : { email: 'Invalid' } }),
        ELEMENT: (s) => (s.email.includes('@') ? ABORT : { focus: Email }),
      },
      OPEN_HELP: { ELEMENT: { showModal: HelpDialog } },
      CLOSE_HELP: { ELEMENT: { close: HelpDialog, returnValue: 'ok' } },
      SCROLL: { ELEMENT: { scrollIntoView: '.row:last-child', block: 'nearest', behavior: 'smooth' } },
      FOCUS: { ELEMENT: { focus: Email, preventScroll: true } },
      TIP: { ELEMENT: [{ showPopover: Tip }, { togglePopover: Tip, force: false }, { hidePopover: Tip }] },
      MANY: { ELEMENT: (s) => [{ focus: Email }, { select: Email }] },
      CLICK: { ELEMENT: { click: `${Row} button` } },
    }
    void C
  })

  it('rejects unknown methods, wrong options and wrong targets', () => {
    const C: Component<State> = () => <div />
    C.model = {
      // @ts-expect-error a typo is not a command (register other methods in ElementCommandRegistry)
      A: { ELEMENT: { fokus: Email } },
      // @ts-expect-error block is a ScrollLogicalPosition
      B: { ELEMENT: { scrollIntoView: Row, block: 'middle' } },
      // @ts-expect-error returnValue is a string
      D: { ELEMENT: { close: HelpDialog, returnValue: 1 } },
      // @ts-expect-error the target is a control or a selector
      E: { ELEMENT: { focus: 42 } },
    }
    void C
  })

  it('the exported types', () => {
    expectTypeOf<{ focus: typeof Email }>().toMatchTypeOf<ElementCommand>()
    expectTypeOf<ElementCommand[]>().toMatchTypeOf<ElementCommands>()
    expectTypeOf<string>().toMatchTypeOf<ElementTarget>()
    expectTypeOf<typeof Email>().toMatchTypeOf<ElementTarget>()
  })
})

describe('t.commands', () => {
  it('lists the ELEMENT commands', () => {
    const C: Component<State> = () => <div />
    const t = renderComponent(C)
    expectTypeOf(t.commands('ELEMENT')).toEqualTypeOf<ElementCommand[]>()
    expectTypeOf(t.commands()).toEqualTypeOf<ElementCommand[]>()
    expectTypeOf(t.commands('HTTP')).toEqualTypeOf<any[]>()
  })
})
