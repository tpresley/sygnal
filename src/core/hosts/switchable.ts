/**
 * PLAN-4.6 next core: the Switchable host (R2). Registered on import (the public `Switchable`
 * module imports this file).
 *
 * - `of={{ name: Fn }}` (D163: functions only; SYG415), `current` (SYG416), `state` (a key, a
 *   lens or none: the pages' state; SYG409 / SYG410 as for a tag child), `instance` (D83).
 * - Every page is created at mount and stays alive while hidden: its intent, actions, PARENT
 *   (to the owner's CHILD.select) and, in R3, its background statics run from mount (R4-1).
 * - A hidden page is not rendered: its view is first called when it is first shown, and a page
 *   shown again renders only if its inputs changed meanwhile (G-121; D172: no `lazy` prop).
 * - An `isolatedState` page owns its state (a local cell), whatever the Switchable's `state` is,
 *   so it never sees a state-bound sibling's slice, nor they its local state (G-292).
 * - D83: the current page shown with another `instance` than it last had is disposed and made
 *   again (fresh local state, DISPOSE / BOOTSTRAP); a page never shown adopts the first one.
 * - Its output is the current page's vnode (the page's own DOM scope); READY stays out, as today
 *   (the owner treats the Switchable as ready).
 */
import {hosts} from '../registry'
import {Inst, shallowEq} from '../instance'
import {Cell, keyCell, lensCell, localCell} from '../cell'
import {isObj} from '../define'
import {uidPart} from '../../shared'
import {error as logError, fail} from '../../extra/diagnostics/legacy'

interface Page { inst: Inst; i: any; view: any }

const OF_FIX = 'Use of={{ name: Component }}', CUR_FIX = "Set current to a key of 'of'"

/** today's addComponent checks (thrown: the owner renders its error fallback, SYG408) */
function check(owner: Inst, props: Record<string, any>) {
  const of = props.of
  if (!of) fail('SYG415', owner, "Switchable is missing 'of'", OF_FIX)
  if (!isObj(of)) fail('SYG415', owner, `Switchable 'of' is a ${typeof of}`, OF_FIX)
  if (!Object.values(of).every(c => typeof c == 'function')) fail('SYG415', owner, "Switchable 'of' has a value that is not a component", OF_FIX)
  const cur = props.current
  if (!cur || typeof cur != 'string') fail('SYG416', owner, `Switchable 'current' is missing or a ${typeof cur}`, CUR_FIX)
  if (!(cur in of)) fail('SYG416', owner, `Switchable 'current' '${cur}' is not a key of 'of'`, CUR_FIX)
}

/** a page's props: the Switchable's, kept by identity while equal (`of` compared shallowly) */
function sameProps(a: any, b: any) {
  if (!a || !b) return false
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  for (const k of ka) if (a[k] !== b[k] && !(k == 'of' && shallowEq(a[k], b[k]))) return false
  return true
}

export class SwitchableHost {
  pages: Record<string, Page> = {}
  cell: Cell
  cur!: string
  ready = true
  disposed = false
  outv: any; last: any; lr = true
  props: any
  kids: any[] = []
  uidBase: string

  constructor(public owner: Inst, props: Record<string, any>, children: any[], id: string) {
    check(owner, props)
    const st = props.state, calc = typeof st == 'string' && owner.def.calcNames?.has(st)
    this.cell = typeof st == 'string' ? keyCell(owner.cell, st, calc && owner.def.name, undefined, 'Switchable sub-component')
      : st !== undefined ? lensCell(owner.cell, st, owner.def.name, (e) => owner.app.appError(owner, e, 'view'))
      : owner.cell
    this.uidBase = owner.uid(uidPart(id.replace(/.*::(r\.)?/, '')))
    this.props = props
    this.kids = children
    for (const name in props.of) this.pages[name] = {inst: this.make(name, props.of[name]), i: undefined, view: props.of[name]}
    this.setProps(props, children)
  }

  make(name: string, view: any): Inst {
    const o = this.owner, app = o.app, def = app.def(view), scope = app.scope()
    const inst = new Inst(app, def, o, def.isolated ? localCell(app, this.cell) : this.cell, o.dom && o.dom.isolateSource(o.dom, scope),
      this.props, this.kids, scope, this.uidBase + '-' + uidPart(name), 'page')
    inst.shown = false
    return inst
  }

  setProps(props: Record<string, any>, children: any[]) {
    let cur = props.current
    if (!(typeof cur == 'string' && cur in this.pages)) {
      // (today this threw out of the owner's render; the next core keeps the page shown)
      logError('SYG416', this.owner, `Switchable 'current' '${cur}' is not a key of 'of'`, CUR_FIX)
      cur = this.cur
    }
    if (!sameProps(props, this.props) || children !== this.kids) {
      this.props = props
      this.kids = children
      for (const n in this.pages) this.pages[n].inst.setProps(props, children)
    }
    const page = this.pages[cur]
    if (page) {
      // D83: shown with another instance key than it was last shown with: made again
      if (page.i !== undefined && page.i !== props.instance) {
        page.inst.dispose()
        page.inst = this.make(cur, page.view)
      }
      page.i = props.instance
    }
    if (cur !== this.cur) {
      if (this.cur !== undefined) this.pages[this.cur].inst.shown = false
      this.cur = cur
    }
    if (page) page.inst.shown = true
  }

  insts(): Inst[] { return Object.values(this.pages).map(p => p.inst) }

  /** only the current page renders (G-121); a hidden page keeps its last vnode and catches up when shown */
  render(): any {
    if (this.disposed) return this.outv
    const page = this.pages[this.cur]
    return (this.outv = page ? page.inst.render() : undefined)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const n in this.pages) this.pages[n].inst.dispose()
  }
}

hosts.switchable = (owner, props, children, id) => new SwitchableHost(owner, props, children, id)
