// App.test.jsx
import { test, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { App } from './App.jsx'

const text = (t, selector) => t.query(selector).textContent.replace(/\s/g, ' ')

test('restores the saved locale, pluralises, switches language and saves it', async () => {
  const t = renderComponent(App, { storage: { locale: { version: 1, state: { locale: 'fr' } } } })
  await t.ready()
  expect(text(t, 'h1')).toBe('Bonjour, Ada !')
  expect(text(t, '.count')).toBe('0 article')

  t.simulateEvent('.add', 'click')
  t.simulateEvent('.add', 'click')
  await t.next((state) => state.cart.items === 2)
  expect(text(t, '.count')).toBe('2 articles')
  expect(text(t, '.total')).toBe('Total : 9,00 €')

  t.simulateEvent('.locale', 'change', { value: 'en' })
  await t.next((state) => state.locale === 'en')
  expect(text(t, 'h2')).toBe('Your cart')
  expect(text(t, '.count')).toBe('2 items')
  expect(text(t, '.total')).toBe('Total: €9.00')
  expect(t.query('main').getAttribute('lang')).toBe('en')

  await t.settle()
  expect(t.storage('locale')).toEqual({ version: 1, state: { locale: 'en' } })
  t.dispose()
})
