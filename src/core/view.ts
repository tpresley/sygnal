/**
 * PLAN-4.6 core: the read-only InstanceView hooks and tools get (04 §2.3), never the raw
 * instance. Made on the first hook call that needs it (an app without hooks makes none).
 */
import type {InstanceView} from './hooks'
import type {Inst} from './instance'

class View implements InstanceView {
  constructor(private i: Inst) {}
  get id() { return this.i.id }
  get parentId() { return this.i.parent?.id }
  get name() { return this.i.def.name }
  get def() { return this.i.def }
  get state() { return this.i.cell.get() }
  get props() { return this.i.props }
  get context() { return this.i.context() }
  get isRoot() { return !this.i.parent }
  get kind() { return this.i.kind }
  /** false on a hidden Switchable page and below it */
  get shown() {
    for (let i: any = this.i; i; i = i.parent) if (!i.shown) return false
    return true
  }
  get disposed() { return this.i.disposed }
  get uid() { return this.i.uidBase }
  get sources() { return this.i.sources() }
  children(): InstanceView[] {
    const out: InstanceView[] = []
    this.i.kids.forEach((k: any) => {
      if (k.def && k.app) out.push(viewOf(k))
      else if (k.insts) for (const j of k.insts()) out.push(viewOf(j))
    })
    return out
  }
}

export const viewOf = (i: Inst): InstanceView => (i.iv ||= new View(i))
