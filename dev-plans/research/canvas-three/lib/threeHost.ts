/**
 * A whole app as a three.js scene on sygnal/host (no DOM at all: a game, a Node test, a worker).
 * The same target as <Scene>, reading the host driver's patched root vnode; input through the
 * same pointer router, as HostEvents. `DOM.click('.cube')` works as in the browser.
 *
 *   const host = createThreeHost({ width: 640, height: 400 })
 *   run(App, { DOM: host.driver })
 *   host.click(host.doc.querySelector('.cube'))
 */
import {HostDocument, makeHostDriver} from 'sygnal/host'
import {createThreeTarget} from './three'
import {pointerRouter} from './events'

export function createThreeHost({width = 300, height = 150, doc = new HostDocument()} = {}) {
  const target = createThreeTarget()
  target.setSize(width, height)
  let rootVnode: any = null
  // the root vnode as patched (props as the views wrote them, .elm set)
  const capture = {update: (_: any, v: any) => { if (v.elm === doc.body) rootVnode = v }}
  const driver = makeHostDriver(doc, {modules: [capture], onPatch: () => target.sync(rootVnode)})
  const router = pointerRouter((x, y) => target.pick(x / width * 2 - 1, -(y / height) * 2 + 1), doc.body)
  const pixelOf = (el: any) => { const p = target.project(el); return p && [(p[0] + 1) / 2 * width, (1 - p[1]) / 2 * height] }
  return {
    doc, driver, target, router, pixelOf,
    pointer: (kind: string, x: number, y: number, init?: any) => router.input(kind, x, y, init),
    click(el: any) {
      const [x, y] = pixelOf(el)!
      router.input('down', x, y)
      return router.input('up', x, y)
    },
  }
}
