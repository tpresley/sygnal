/**
 * SYG265 / SYG266 at run time: a view or a non-EFFECT model handler really makes a network call
 * or runs another side effect, however it was written (research:
 * dev-plans/research/undeclared-effects). The static rule misses what it can't read (a computed
 * name built at run time, a package, a function from a parameter); this sees the call itself.
 *
 * While such code runs synchronously, `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`,
 * `EventSource`, the `Storage` methods, `document.cookie`, `pushState` / `replaceState`, the
 * timers and `postMessage` are swapped for wrappers that report and call through; they are put
 * back when it returns, so nothing stays patched and fake timers are left alone. Not covered: what
 * runs later (a promise continuation, a timer's callback), calculated fields and declaration
 * statics run by the core outside these brackets, and `location` (unforgeable).
 *
 * `next()` is the framework's own timer: it runs with the traps off. The view bracket patches
 * `Inst.prototype.view` once, from an InstanceView's private reference: there is no hook around a
 * view and none is added for this, so the core stays at 0 bytes. Only while diagnostics are on.
 */
import {bridge, devReport, once} from './shared'

type Trap = [target: any, key: string, code: string, name: string]

let current: {name: string, place: string} | null = null
let depth = 0
let off = 0
let list: Trap[] | null = null
let saved: any[] = []

const FIX_NET = "Return it from a model entry's HTTP sink, or a `resources` entry; a socket goes in `connections`"
const FIX_OTHER = 'Move it to an EFFECT entry, a driver sink, `persist`, `timers`, or an ELEMENT command'

function note(code: string, api: string): void {
  if (!current || off) return
  const {name, place} = current
  if (!once(`${code}:${name}:${place}:${api}`)) return
  devReport(code, {
    component: name,
    message: `${place} of ${name} called ${api} while it ran, which no model entry declares`,
    fix: code == 'SYG265' ? FIX_NET : FIX_OTHER,
    data: {place, api},
  })
}

function wrapper(orig: any, code: string, api: string): any {
  return function (this: any, ...args: any[]) {
    note(code, api)
    return new.target ? Reflect.construct(orig, args) : orig.apply(this, args)
  }
}

function traps(): Trap[] {
  if (list) return list
  const g: any = globalThis, out: Trap[] = []
  for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']) out.push([g, k, 'SYG265', k])
  out.push([g.navigator, 'sendBeacon', 'SYG265', 'navigator.sendBeacon'])
  for (const k of ['setItem', 'removeItem', 'clear']) out.push([g.Storage?.prototype, k, 'SYG266', `Storage.${k}`])
  for (const k of ['setTimeout', 'setInterval', 'requestAnimationFrame', 'postMessage']) out.push([g, k, 'SYG266', k])
  for (const k of ['pushState', 'replaceState']) out.push([g.history, k, 'SYG266', `history.${k}`])
  return (list = out.filter(([t, k]) => t && typeof t[k] == 'function'))
}

const COOKIE = typeof Document != 'undefined' ? Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') : undefined

function install(): void {
  saved = traps().map(([t, k, code, name]) => { const was = t[k]; t[k] = wrapper(was, code, name); return was })
  if (COOKIE) Object.defineProperty(Document.prototype, 'cookie', {...COOKIE, set(v: any) { note('SYG266', 'document.cookie'); COOKIE.set!.call(this, v) }})
}

function restore(): void {
  traps().forEach(([t, k], i) => { t[k] = saved[i] })
  saved = []
  if (COOKIE) Object.defineProperty(Document.prototype, 'cookie', COOKIE)
}

/** `run` with the traps on, reporting against component `name`. */
function guarded<T>(name: string, place: string, run: () => T): T {
  if (depth++ == 0) { current = {name, place}; install() }
  try { return run() } finally { if (--depth == 0) { restore(); current = null } }
}

/** A non-EFFECT handler, guarded; the `next` it gets runs with the traps off. */
export const guardedHandler = (f: any, type: string, sink: string, h: any) => (s: any, d: any, nx: any, p: any, ...r: any[]) => {
  const free = (...a: any[]) => { off++; try { return nx(...a) } finally { off-- } }
  return guarded(f.name, sink == 'STATE' ? `the STATE reducer for '${type}'` : `the ${sink} handler of '${type}'`, () => h(s, d, nx && free, p, ...r))
}

const PATCHED = Symbol.for('sygnal.effects.view')

/** Once per core: the bracket around every view. Goes through the bridge, so a later copy of this entry takes over. */
export function patchView(iv: any): void {
  const proto = iv?.i && Object.getPrototypeOf(iv.i)
  if (!proto || typeof proto.view != 'function' || proto[PATCHED]) return
  const view = proto.view
  proto[PATCHED] = true
  proto.view = function (this: any, ...a: any[]) {
    const g = bridge()?.__guardView
    return g ? g(this.def.name, () => view.apply(this, a)) : view.apply(this, a)
  }
}

export function installEffectHooks(): () => void {
  const core = bridge(), on = () => core.hooks.on()
  core.__guardView = (name: string, run: () => any) => (on() ? guarded(name, 'the view', run) : run())
  return () => { delete core.__guardView }
}
