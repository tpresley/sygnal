import { vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AppProviders, routes } from './App.jsx'

/**
 * A fake API in place of `fetch`: each request stays pending until the test answers it with
 * respond('GET /api/expenses', body) or fail('PUT /api/expenses/2', 500) (the oldest pending
 * request with that method and path). requests() lists every request: { method, path, json }.
 */
export function fakeApi() {
  const sent = []
  const pending = []
  const fetch = vi.fn((url, init = {}) => {
    const request = { method: init.method ?? 'GET', path: String(url), json: init.body ? JSON.parse(init.body) : undefined }
    sent.push(request)
    return new Promise((resolve) => pending.push({ request, resolve }))
  })
  vi.stubGlobal('fetch', fetch)

  async function answer(route, body, status) {
    const find = () => pending.findIndex(({ request }) => `${request.method} ${request.path}` === route)
    await waitFor(() => {
      if (find() < 0) throw new Error(`no pending ${route}; sent: ${sent.map((r) => `${r.method} ${r.path}`).join(', ')}`)
    })
    const [{ resolve }] = pending.splice(find(), 1)
    await act(async () => {
      resolve(new Response(body == null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
    })
  }

  return {
    requests: () => sent,
    respond: (route, body, status = 200) => answer(route, body, status),
    fail: (route, status) => answer(route, { error: 'failed' }, status),
  }
}

/** Render the app at `url` with a memory router; returns the router (router.state.location). */
export function renderApp(url) {
  const router = createMemoryRouter(routes, { initialEntries: [url] })
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  )
  return router
}
