// The page DOM is an exact mirror of the worker's host tree after every interaction: the worker
// target and the bridge, connected by a real MessageChannel in one jsdom process, drive
// examples/todomvc (unchanged) through a seeded random sequence of user actions.
import {describe, it, expect, afterEach} from 'vitest'
import {run, xs} from 'sygnal'
import App from '../../../../examples/todomvc/app.tsx'
import {createWorkerTarget} from './src/worker-target'
import {startBridge} from './src/bridge'

const settle = (ms = 20) => new Promise((ok) => setTimeout(ok, ms))

/** tag, attributes, form state and children, the same way for both trees */
function shape(n: any): any {
  if (n.nodeType === 3) return n.data
  const attrs: Record<string, string> = {}
  for (const a of n.attributes instanceof Map ? n.attributes : Array.from(n.attributes as any[]).map((a: any) => [a.name, a.value]))
    attrs[a[0]] = a[1]
  const out: any = {tag: n.localName, attrs, kids: Array.from(n.childNodes).map(shape)}
  // (a checkbox's DOM value defaults to 'on', the host's to '': not compared)
  if (out.tag === 'input') { out.checked = n.checked; if (attrs.type !== 'checkbox') out.value = n.value }
  return out
}

function setup() {
  document.body.innerHTML = '<div id="root"></div>'
  const mount = document.getElementById('root')!
  const ch = new MessageChannel()
  const workerSide: any = {postMessage: (m: any) => ch.port1.postMessage(m), addEventListener: (t: string, f: any) => ch.port1.addEventListener(t, f)}
  const pageSide: any = {postMessage: (m: any) => ch.port2.postMessage(m), addEventListener: (t: string, f: any) => ch.port2.addEventListener(t, f)}
  // the page-side drivers: a store and a router the test drives
  let saved: any[] = []
  let route: any
  const STORE = (sink$: any) => { sink$.addListener({next: (e: any) => { saved = e.value }}); return {get: () => xs.of([])} }
  const ROUTER = () => xs.create({start: (l: any) => { route = l }, stop() {}})
  // the bridge first: it answers the worker's {root} and subscribe messages
  const bridge = startBridge(pageSide, mount, {drivers: {STORE, ROUTER}, stats: true})
  ch.port1.start(); ch.port2.start()
  const target = createWorkerTarget(workerSide)
  const app = run(App as any, {DOM: target.driver, STORE: target.remote('STORE', ['get']), ROUTER: target.remote('ROUTER')} as any)
  return {mount, target, bridge, app, ch, saved: () => saved, go: (r: string) => route?.next(r)}
}

let env: ReturnType<typeof setup> | null = null
afterEach(() => { env?.app.dispose?.(); env?.ch.port1.close(); env?.ch.port2.close(); env = null })

const typeInto = (el: any, text: string) => {
  for (const ch of text) { el.value += ch; el.dispatchEvent(new InputEvent('input', {bubbles: true, data: ch, inputType: 'insertText'})) }
}
const key = (el: any, k: string, keyCode: number) => el.dispatchEvent(new KeyboardEvent('keydown', {bubbles: true, key: k, keyCode} as any))

describe('worker target + bridge (todomvc unchanged)', () => {
  it('mirrors the host tree after each of 120 random actions', async () => {
    env = setup()
    const {mount, target} = env
    await settle()
    // at quiescence: <Transition> changes classes on frames, so compare once the host tree held
    // still for a whole round trip (flushed, delivered, unchanged)
    const expectMirror = async () => {
      for (let i = 0; i < 50; i++) {
        target.flush()
        const host = JSON.stringify(shape(target.doc.body).kids)
        await settle(10)
        if (JSON.stringify(shape(target.doc.body).kids) === host) return expect(shape(mount).kids).toEqual(JSON.parse(host))
      }
      throw new Error('the host tree never settled')
    }
    await expectMirror()

    let seed = 7
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
    const items = () => Array.from(mount.querySelectorAll('.todo-list li')) as HTMLElement[]
    for (let step = 0; step < 120; step++) {
      const list = items()
      const pick = rnd(list.length ? 8 : 1)
      if (pick === 0) {
        const input = mount.querySelector('.new-todo') as HTMLInputElement
        typeInto(input, 'todo ' + step)
        input.form!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))
      } else if (pick === 1) (list[rnd(list.length)].querySelector('.toggle') as HTMLElement).click()
      else if (pick === 2) (list[rnd(list.length)].querySelector('.destroy') as HTMLElement).click()
      else if (pick === 3) (mount.querySelector('.toggle-all') as HTMLElement).click()
      else if (pick === 4) (mount.querySelector('.clear-completed') as HTMLElement | null)?.click()
      else if (pick === 5) env.go(['all', 'active', 'completed'][rnd(3)])
      else {
        // edit: dblclick, type, then Enter, Escape or blur
        const li = list[rnd(list.length)]
        li.querySelector('label')!.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))
        await settle(40)
        const edit = li.querySelector('.edit') as HTMLInputElement
        if (!edit) continue
        typeInto(edit, ' e' + step)
        const how = rnd(3)
        if (how === 0) key(edit, 'Enter', 13)
        else if (how === 1) key(edit, 'Escape', 27)
        else edit.dispatchEvent(new FocusEvent('blur'))
      }
      // the leave Transition holds a removed item 300 ms
      await settle(pick === 2 || pick === 4 || pick === 6 ? 350 : 30)
      await expectMirror()
    }
    expect(env.bridge.stats.ops).toBeGreaterThan(100)
  }, 60000)

  it('one message per flush, and a field value the page sent is not echoed back', async () => {
    env = setup()
    const {mount, bridge} = env
    await settle()
    const input = mount.querySelector('.new-todo') as HTMLInputElement
    typeInto(input, 'a')
    input.form!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))
    await settle(60)
    const li = mount.querySelector('.todo-list li')!
    li.querySelector('label')!.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))
    await settle(60)
    const edit = li.querySelector('.edit') as HTMLInputElement
    bridge.reset()
    let applied = 0
    const orig = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!
    Object.defineProperty(edit, 'value', {get() { return orig.get!.call(this) }, set(v) { applied++; orig.set!.call(this, v) }, configurable: true})
    edit.value = 'ab'; applied = 0
    edit.dispatchEvent(new InputEvent('input', {bubbles: true}))
    await settle(30)
    expect(applied).toBe(0)
    expect(bridge.stats.in).toBeLessThanOrEqual(2) // the flush's ops (+ the STORE sink)
  })

  it('a submit is prevented on the page synchronously', async () => {
    env = setup()
    await settle()
    const ev = new Event('submit', {bubbles: true, cancelable: true})
    env.mount.querySelector('form')!.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
  })

  it('rebases a worker value onto what the user typed since (clear after Enter, then more typing)', async () => {
    env = setup()
    const {mount} = env
    await settle()
    const input = mount.querySelector('.new-todo') as HTMLInputElement
    typeInto(input, 'Buy milk')
    input.form!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))
    typeInto(input, 'W') // before the worker's clear arrives
    await settle(60)
    expect(input.value).toBe('W')
    expect(mount.querySelectorAll('.todo-list li').length).toBe(1)
    typeInto(input, 'alk')
    input.form!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))
    await settle(60)
    expect(Array.from(mount.querySelectorAll('.todo-list label')).map((l) => l.textContent)).toEqual(['Buy milk', 'Walk'])
  })
})
