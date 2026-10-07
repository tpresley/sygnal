import { useCallback, useEffect, useState } from 'react'

// The expenses REST API, and hooks that load from it.

async function request(url, { method = 'GET', json } = {}) {
  const res = await fetch(url, {
    method,
    headers: json ? { 'Content-Type': 'application/json' } : undefined,
    body: json ? JSON.stringify(json) : undefined,
  })
  if (!res.ok) {
    const error = new Error(`Request failed (${res.status})`)
    error.status = res.status
    throw error
  }
  return res.status === 204 ? null : res.json()
}

export const api = {
  list: () => request('/api/expenses').then((body) => body.expenses),
  get: (id) => request(`/api/expenses/${id}`),
  create: (expense) => request('/api/expenses', { method: 'POST', json: expense }),
  setStatus: (id, status) => request(`/api/expenses/${id}`, { method: 'PUT', json: { status } }),
  remove: (id) => request(`/api/expenses/${id}`, { method: 'DELETE' }),
}

/**
 * Loads `load()` when the component mounts and whenever `deps` change.
 * Returns { status: 'loading' | 'success' | 'error', data, error, reload, setData }.
 */
export function useResource(load, deps) {
  const [result, setResult] = useState({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let current = true
    setResult({ status: 'loading' })
    load().then(
      (data) => current && setResult({ status: 'success', data }),
      (error) => current && setResult({ status: 'error', error })
    )
    return () => {
      current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  const setData = useCallback((data) => setResult({ status: 'success', data }), [])
  return { ...result, reload, setData }
}

export const useExpenses = () => useResource(api.list, [])

export const useExpense = (id) => useResource(() => api.get(id), [id])
