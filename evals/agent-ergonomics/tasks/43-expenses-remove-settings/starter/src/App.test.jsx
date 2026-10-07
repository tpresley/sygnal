import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import App from './App.jsx'
import { router } from './routes.js'

let t
afterEach(() => t?.dispose())

it('shows "Page not found" for an unknown address', async () => {
  t = renderComponent(App, { router, url: '/reports' })
  await t.ready()
  expect(t.query('h1').textContent).toBe('Page not found')
  expect(t.queryAll('nav.main-nav a').map((a) => a.textContent)).toEqual(['Dashboard', 'Expenses', 'New expense', 'Settings'])
  t.expectNoDiagnostics()
})
