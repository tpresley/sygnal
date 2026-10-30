// The worker target and the page bridge in one jsdom process, connected by a real MessageChannel:
// the page DOM is an exact mirror of the worker's host tree after every one of 120 seeded random
// user actions on the app (examples/todomvc's, unchanged). The real Worker in Chromium, Firefox and
// WebKit is the root browser-tests' worker suite.
import { describe, it, expect, afterEach } from 'vitest'
import { run, xs } from 'sygnal'
import { createWorkerTarget } from 'sygnal/worker'
import { startBridge } from 'sygnal/worker/page'
import App from './app'
// the app's files here and in examples/todomvc, as text
const here = import.meta.glob(['./app.tsx', './components/*.tsx', './lib/*.ts'], { query: '?raw', import: 'default', eager: true })
const there = import.meta.glob(['../todomvc/app.tsx', '../todomvc/components/*.tsx', '../todomvc/lib/*.ts'], { query: '?raw', import: 'default', eager: true })

const settle = (ms = 20) => new Promise((ok) => setTimeout(ok, ms))

/** tag, attributes, form state and children, the same way for both trees */
function shape(n: any): any {
  if (n.nodeType === 3) return n.data
  const attrs: Record<string, string> = {}
  for (const a of n.attributes instanceof Map ? n.attributes : Array.from(n.attributes as any[]).map((a: any) => [a.name, a.value]))
    attrs[a[0]] = a[1]
  const out: any = { tag: n.localName, attrs, kids: Array.from(n.childNodes).map(shape) }
  // (a checkbox's DOM value defaults to 'on', the host's to '': not compared)
  if (out.tag === 'input') { out.checked = n.checked; if (attrs.type !== 'checkbox') out.value = n.value }
  return out
}

function setup() {
  document.body.innerHTML = '<div id="root"></div>'
  const mount = document.getElementById('root')!
  const ch = new MessageChannel()
  // the page-side drivers: a store and a router the test drives
  let saved: any = null
  let route: any
  const STORE = (sink$: any) => { sink$.addListener({ next: (e: any) => { saved = e.value } }); return { get: () => xs.of([]) } }
  const ROUTER = () => xs.create({ start: (l: any) => { route = l }, stop() {} })
  const bridge = startBridge(ch.port2, mount, { drivers: { STORE, ROUTER } })
  const target = createWorkerTarget(ch.port1)
  const app = run(App as any, { DOM: target.driver, STORE: target.remote('STORE', ['get']), ROUTER: target.remote('ROUTER') } as any)
  return { mount, target, bridge, app, ch, saved: () => saved, go: (r: string) => route?.next(r) }
}

let env: ReturnType<typeof setup> | null = null
afterEach(() => { env?.app.dispose?.(); env?.bridge.stop(); env?.ch.port1.close(); env?.ch.port2.close(); env = null })

const typeInto = (el: any, text: string) => {
  for (const c of text) { el.value += c; el.dispatchEvent(new InputEvent('input', { bubbles: true, data: c, inputType: 'insertText' })) }
}
const key = (el: any, k: string, keyCode: number) => el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: k, keyCode } as any))
const submit = (form: any) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

describe('todomvc in a worker (sygnal/worker + sygnal/worker/page)', () => {
  it('the app is examples/todomvc\'s, unchanged', () => {
    expect(Object.keys(here).sort()).toEqual(['./app.tsx', './components/todos.tsx', './lib/localStorageDriver.ts', './lib/routerDriver.ts', './lib/utils.ts'])
    for (const f in here) expect(here[f], f).toBe(there['../todomvc/' + f.slice(2)])
  })

  it('mirrors the host tree after each of 120 random actions', async () => {
    env = setup()
    const { mount, target, bridge } = env
    await bridge.ready
    // at quiescence: <Transition> changes classes on frames, so compare once the host tree held
    // still for a whole round trip (flushed, delivered, unchanged)
    const expectMirror = async () => {
      for (let i = 0; i < 100; i++) {
        target.flush()
        const host = JSON.stringify(shape(target.doc.body).kids)
        await settle(10)
        if (JSON.stringify(shape(target.doc.body).kids) === host && JSON.stringify(shape(mount).kids) === host) return
      }
      expect(shape(mount).kids).toEqual(shape(target.doc.body).kids)
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
        submit(input.form)
      } else if (pick === 1) (list[rnd(list.length)].querySelector('.toggle') as HTMLElement).click()
      else if (pick === 2) (list[rnd(list.length)].querySelector('.destroy') as HTMLElement).click()
      else if (pick === 3) (mount.querySelector('.toggle-all') as HTMLElement).click()
      else if (pick === 4) (mount.querySelector('.clear-completed') as HTMLElement | null)?.click()
      else if (pick === 5) env.go(['all', 'active', 'completed'][rnd(3)])
      else {
        // edit: dblclick, type, then Enter, Escape or blur
        const li = list[rnd(list.length)]
        li.querySelector('label')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
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
    expect(bridge.stats.ops).toBeGreaterThan(100)
  }, 90000)

  it('persists through the page\'s STORE driver, and a submit never navigates', async () => {
    env = setup()
    const { mount, bridge } = env
    await bridge.ready
    const input = mount.querySelector('.new-todo') as HTMLInputElement
    typeInto(input, 'Buy milk')
    const ev = new Event('submit', { bubbles: true, cancelable: true })
    input.form!.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    for (let i = 0; i < 100 && !(env.saved()?.length && input.value === ''); i++) await settle(10)
    expect(env.saved().map((t: any) => t.title)).toEqual(['Buy milk'])
    expect(input.value).toBe('')
  })
})
