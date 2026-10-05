// @vitest-environment jsdom
// PLAN-5 2-Z (D203, E6): the same fromReact adapter and the same React component source on
// preact/compat. vi.mock aliases react, react-dom and react-dom/client as the documented bundler
// alias does (resolve.alias in Vite).
import { it, expect, afterEach, vi } from 'vitest'
import * as compat from 'preact/compat'
import { renderComponent } from '../src/extra/testing.js'
import { App, exercise } from './p5-2z-react-fixtures.js'

vi.mock('react', async () => await import('preact/compat'))
vi.mock('react-dom', async () => await import('preact/compat'))
vi.mock('react-dom/client', async () => await import('preact/compat/client'))

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })

it('runs on preact/compat: props in, callbacks out, newest props, unmount', async () => {
  // the alias is in effect
  expect((await import('react')).createElement).toBe(compat.createElement)
  expect((await import('react-dom/client')).createRoot).toBe((await import('preact/compat/client')).createRoot)
  t = renderComponent(App, { dom: 'real' })
  await exercise(t, expect)
})
