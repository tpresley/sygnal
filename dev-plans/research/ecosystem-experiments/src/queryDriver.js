// Throwaway: TanStack query-core as a Sygnal driver. Sink: { category, queryKey, queryFn, ...options }.
// Source: select(category) → { category, status, data, error, isFetching, ... }. Shared cache across components.
import { xs } from 'sygnal'
import { QueryClient, QueryObserver } from '@tanstack/query-core'
export function makeQueryDriver(client = new QueryClient()) {
  return (sink$) => {
    const out$ = xs.create()
    const observers = new Map()
    sink$.addListener({ next: (req) => {
      if (req.invalidate) return void client.invalidateQueries({ queryKey: req.invalidate })
      let entry = observers.get(req.category)
      if (!entry) {
        const obs = new QueryObserver(client, req)
        entry = { obs, unsub: obs.subscribe(r => out$.shamefullySendNext({ category: req.category, ...r })) }
        observers.set(req.category, entry)
        out$.shamefullySendNext({ category: req.category, ...obs.getCurrentResult() })
      } else entry.obs.setOptions(req)
    } })
    return { select: (cat) => out$.filter(r => r.category === cat), client }
  }
}
