// sygnal/replay: stable addresses for component instances.
//
// Instance ids (InstanceView.id) are a per-app counter: they match between a recording and its
// replay only while the code creates exactly the same instances in the same order. An address is
// a path from the root that survives more refactors:
//   App                         the root (the recording's root name: a replay of a renamed or
//                               wrapped root component keeps the addresses)
//   App/LaneComponent[lane-2]   a Collection item: its state's `id` (the item key), else
//   App/Header:0                the n-th instance of that component name under that parent
// The recorder and the replayer both build addresses with this, from the hooks they see.

export function addresses(rootName?: string) {
  const byId = new Map<number, string>()     // instance id -> address
  const live = new Map<string, any>()        // address -> InstanceView (the replayer's dispatch targets)
  const counts = new Map<string, number>()   // parent address + name -> instances created so far
  const self = {
    create(iv: any): string {
      let a: string
      if (iv.isRoot || iv.parentId === undefined) a = rootName ?? iv.name
      else {
        const parent = byId.get(iv.parentId) ?? `#${iv.parentId}`
        const s = iv.state
        const key = iv.kind == 'item' && s && typeof s == 'object' && (typeof s.id == 'string' || typeof s.id == 'number') ? s.id : undefined
        if (key !== undefined) a = `${parent}/${iv.name}[${key}]`
        else {
          const k = parent + '/' + iv.name
          const n = counts.get(k) || 0
          counts.set(k, n + 1)
          a = `${k}:${n}`
        }
      }
      // two live items with the same key (D169 duplicates): the second made unique
      if (live.has(a) && !live.get(a).disposed) a += `~${iv.id}`
      byId.set(iv.id, a)
      live.set(a, iv)
      return a
    },
    of(iv: any): string { return byId.get(iv.id) ?? self.create(iv) },
    dispose(iv: any) {
      const a = byId.get(iv.id)
      if (a !== undefined && live.get(a) === iv) live.delete(a)
    },
    find(a: string): any {
      const iv = live.get(a)
      return iv && !iv.disposed ? iv : undefined
    },
  }
  return self
}
