/**
 * PLAN-4.6 core: the Switchable host (R2). Registered on import (the public `Switchable`
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
import {resolve} from './collection'
import {Inst, shallowEq, bindingChanged, known, watch} from '../instance'
import {Cell, keyCell, lensCell, localCell, pathOf} from '../cell'
import {isObj} from '../define'
import {uidPart} from '../../shared'
import {error as logError, fail} from '../../extra/diagnostics/legacy'

/** `view`: the page component as given; `fn`: as resolved (a lazy() page: the loaded one, G-317) */
interface Page { inst: Inst; i: any; view: any; fn: any }

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

/** F-3: a per-page map (an object that is not a lens or a byId selection: no `get`), or null */
const mapOf = (st: any) => isObj(st) && typeof st.get != 'function' ? st : null

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
  map: any
  cur!: string
  ready = true
  disposed = false
  outv: any; last: any; lr = true
  props: any
  kids: any[] = []
  uidBase: string

  constructor(public owner: Inst, props: Record<string, any>, children: any[], id: string) {
    check(owner, props)
    const st = props.state
    // F-3: `state={{ page: key | lens | byId }}` (not a lens, not a byId selection): each listed
    // page binds its own target, with a tag child's lifetime rules; the others share the owner's state
    this.map = mapOf(st)
    this.cell = this.bind(this.map ? undefined : st)
    this.uidBase = owner.uid(uidPart(id.replace(/.*::(r\.)?/, '')))
    this.props = props
    this.kids = children
    for (const name in props.of) {
      const view = props.of[name], fn = resolve(view, owner)
      this.pages[name] = {inst: this.make(name, fn), i: undefined, view, fn}
    }
    this.setProps(props, children)
  }

  bind(st: any): Cell {
    const owner = this.owner, calc = typeof st == 'string' && owner.def.calcNames?.has(pathOf(st)[0])
    return typeof st == 'string' ? keyCell(owner.cell, st, calc && owner.def.name, undefined, 'Switchable sub-component')
      : st !== undefined ? lensCell(owner.cell, st, owner.def.name, (e) => owner.app.appError(owner, e, 'view'))
      : owner.cell
  }

  make(name: string, view: any): Inst {
    const o = this.owner, app = o.app, def = app.def(view), scope = app.scope()
    const c = this.map ? this.bind(this.map[name]) : this.cell
    const inst = new Inst(app, def, o, def.isolated ? localCell(app, c) : c, o.dom && o.dom.isolateSource(o.dom, scope),
      this.props, this.kids, scope, this.uidBase + '-' + uidPart(name), 'page')
    inst.shown = false
    return inst
  }

  setProps(props: Record<string, any>, children: any[]) {
    let cur = props.current
    if (!(typeof cur == 'string' && cur in this.pages)) {
      // (today this threw out of the owner's render; the core keeps the page shown)
      logError('SYG416', this.owner, `Switchable 'current' '${cur}' is not a key of 'of'`, CUR_FIX)
      cur = this.cur
    }
    if (!sameProps(props, this.props) || children !== this.kids) {
      this.props = props
      this.kids = children
      for (const n in this.pages) this.pages[n].inst.setProps(props, children)
    }
    // F-3: a page whose own binding target changed (7.0's rule, per page), or that the owner
    // disposed because its target was deleted, is made again
    const m = this.map, nm = this.map = mapOf(props.state)
    // G-317: a lazy() page that has loaded is made again with the loaded component
    for (const n in this.pages) {
      const p = this.pages[n], fn = resolve(p.view, this.owner)
      if (fn !== p.fn || p.inst.disposed || m && nm && bindingChanged(m[n], nm[n])) {
        const shown = p.inst.shown
        p.inst.disposed || p.inst.dispose()
        p.inst = this.make(n, p.fn = fn)
        p.inst.shown = shown
      }
      // the owner disposes a page whose target is deleted, as a tag child; it is made again above
      if (nm && known(nm[n])) watch(this.owner, p.inst)
    }
    const page = this.pages[cur]
    if (page) {
      // D83: shown with another instance key than it was last shown with: made again
      if (page.i !== undefined && page.i !== props.instance) {
        page.inst.dispose()
        page.inst = this.make(cur, page.fn)
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
  /** G-319: a hidden page's Collections follow their arrays (no view call) */
  sync() {
    if (!this.disposed) for (const n in this.pages) this.pages[n].inst.sync()
  }

  render(): any {
    if (this.disposed) return this.outv
    for (const n in this.pages) if (n !== this.cur) this.pages[n].inst.sync()
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
