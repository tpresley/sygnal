/**
 * PLAN-5 2-U type tests: the 'sygnal/ui' entry. Compiled by `npm run test:types`; never executed.
 */
import { describe, it, expectTypeOf } from 'vitest'
import { event } from 'sygnal'
import type { Component, UsesState, UsesActions } from 'sygnal'
import {
  dialog, popover, tooltip, tabs, tabsAttrs, accordion, accordionAttrs, disclosure, disclosureAttrs, Toaster,
} from 'sygnal/ui'
import type { DialogState, TabsState, AccordionState, Toast, PartAttrs } from 'sygnal/ui'

describe('2-U: sygnal/ui', () => {
  it('types each behavior slice and its namespaced actions', () => {
    const uses = {
      help: dialog({ dialog: '.help', trigger: '.open-help', close: '.close-help', returnFocus: false }),
      filters: popover({ popover: '.filters', close: '.done' }),
      tip: tooltip({ trigger: '.save', tip: '.save-tip', showDelay: 300 }),
      tabs: tabs({ tab: '.tab', selected: 'general', activation: 'manual', orientation: 'vertical' }),
      faq: accordion({ trigger: '.faq-trigger', multiple: true, expanded: ['a', 'b'] }),
      more: disclosure({ trigger: '.more', open: true }),
    }
    type S = UsesState<typeof uses>
    expectTypeOf<S['help']>().toEqualTypeOf<DialogState>()
    expectTypeOf<S['filters']['open']>().toEqualTypeOf<boolean>()
    expectTypeOf<S['tip']['pending']>().toEqualTypeOf<null | 'show' | 'hide'>()
    expectTypeOf<S['tabs']>().toEqualTypeOf<TabsState>()
    expectTypeOf<S['faq']>().toEqualTypeOf<AccordionState>()
    expectTypeOf<S['more']['open']>().toEqualTypeOf<boolean>()
    expectTypeOf<UsesActions<typeof uses>['help.CLOSE']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<UsesActions<typeof uses>['tabs.SELECT']>().toEqualTypeOf<string | number>()

    const Settings: Component<S> = ({ state, uid }) => {
      const t = tabsAttrs(state.tabs, uid)
      const f = accordionAttrs(state.faq, uid)
      const m = disclosureAttrs(state.more, uid)
      expectTypeOf(t.tab('a')).toEqualTypeOf<PartAttrs>()
      return (
        <div>
          <div {...t.list} aria-label="Settings"><button className="tab" {...t.tab('general')}>General</button></div>
          <section {...t.panel('general')}>…</section>
          <h3><button className="faq-trigger" {...f.trigger('a')}>A</button></h3>
          <div {...f.panel('a')}>…</div>
          <button className="more" {...m.trigger}>More</button>
          <div {...m.panel}>…</div>
          <Toaster label="Alerts" pauseOnHover={false} />
        </div>
      )
    }
    Settings.uses = uses
    // @ts-expect-error dialog is required
    dialog({ trigger: '.x' })
    // @ts-expect-error activation is 'automatic' | 'manual'
    tabs({ tab: '.t', activation: 'focus' })
  })

  it('types the TOAST payload', () => {
    const t: Toast = { text: 'Saved', kind: 'success', timeoutMs: 0, id: 'save' }
    event('TOAST', t)
    // @ts-expect-error unknown kind
    const bad: Toast = { text: 'x', kind: 'danger' }
    void bad
  })
})
