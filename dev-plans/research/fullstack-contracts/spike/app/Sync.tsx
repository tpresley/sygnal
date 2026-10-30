// Sync: one connection to the server's invalidation stream. Another client's mutation makes the
// named queries stale here too, and every mounted resource on them refetches. As a mixin for
// the spike (a component's connections + one model entry); in a library this would be a
// behavior or a driver option (see the README).
import { api } from './api.ts'

export const withSync = <C extends { connections?: any; model?: any }>(C: C): C => {
  const Synced: any = (props: any) => (C as any)(props)
  Object.assign(Synced, C, {
    connections: (state: any, ctx: any) => ({ ...C.connections?.(state, ctx), sync: api.$sync({ message: 'STALE' }) }),
    model: { ...C.model, STALE: { HTTP: (_state: any, tags: string[]) => ({ invalidate: tags }) } },
  })
  return Synced
}
