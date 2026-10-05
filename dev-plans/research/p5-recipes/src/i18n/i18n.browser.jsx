import { renderComponent } from 'sygnal'
import { App } from './App.jsx'
import { equal, pw } from '../browser-util.js'

const text = (t, selector) => t.query(selector).textContent.replace(/\s/g, ' ')

export const tests = {
  async 'i18next: a real language switch re-renders the child through context, plurals and currency per locale, the locale is saved'() {
    const t = renderComponent(App, { dom: 'real', storage: {} })
    await t.ready()
    equal(t.state.locale, 'en', 'detected from navigator.language (en-US)')
    await pw('click', '.add')
    await t.waitForState((state) => state.cart.items === 1)
    equal(text(t, '.count'), '1 item')
    equal(text(t, '.total'), 'Total: €4.50')

    await pw('select', '.locale', 'fr')
    await t.waitForState((state) => state.locale === 'fr')
    equal(text(t, 'h2'), 'Votre panier', 'child re-rendered from the new context')
    equal(text(t, '.count'), '1 article')
    equal(text(t, '.total'), 'Total : 4,50 €')
    equal(text(t, '.add'), 'Ajouter un café')
    equal(t.query('main').getAttribute('lang'), 'fr')
    equal(t.query('.locale').value, 'fr')
    await t.settle()
    equal(t.storage('locale'), { version: 1, state: { locale: 'fr' } })
    t.dispose()
  },
}
