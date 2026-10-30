/**
 * defineIsland(): an imperative island (a WebGL scene, a canvas, a map, an editor) as a JSX tag
 * whose JSX children are declarative: `<Scene><mesh className="cube" /></Scene>`.
 *
 * defineWidget() hosts are opaque (no children). An island's children are rendered by the app's
 * own DOM driver into a hidden container inside the host, as ordinary elements: `<mesh>` is an
 * HTMLUnknownElement in a browser, a HostElement on a host target. The core walks them like any
 * other children, so components, Collection, isolation, context and intents work inside the
 * island unchanged, with no core change and no second driver. The island paints that subtree
 * its own way (three.js objects, canvas draw calls, Leaflet markers) and dispatches DOM-shaped
 * events on its elements (events.ts), which the DOM driver delegates as usual.
 *
 *   const Scene = defineIsland({
 *     name: 'scene',
 *     mount: (el, props, emit) => instance,      // on insert: build the library object in `el`
 *     update: (instance, props, prev) => {},      // the island's own props changed (shallow)
 *     sync: (instance, children) => {},           // after every patch of the island: `children` is
 *                                                 // the patched vnode of the children container
 *     unmount: (instance) => {},
 *   })
 *
 * Why vnodes in sync(): they carry each element's props as the view wrote them (arrays, objects,
 * functions), with `.elm` set by the patch. Reading element properties back would need a list of
 * which expandos are props. The element tree is still the identity (a keyed move keeps `.elm`).
 *
 * The tag is a control render hook (`__sygnalControl`, the pragma's CT-1 path, as defineWidget's),
 * so it's never instantiated as a component.
 */
const S = '__island'
let ids = 0

export interface IslandDef<I = any> {
  name: string
  /** the host element's tag (default div) */
  tag?: string
  mount(el: any, props: any, emit: (type: string, detail?: any) => void): I
  update?(instance: I, props: any, prev: any): void
  sync?(instance: I, children: any): void
  unmount?(instance: I): void
}

const same = (a: any, b: any) => {
  const k = Object.keys(a)
  return k.length == Object.keys(b).length && k.every(x => a[x] === b[x])
}

// the host gets these props; every prop goes to the island
const HOST = /^(id|className|class|style|title|role|tabIndex|hidden)$|^(aria|data)-/

export function defineIsland<I = any>(def: IslandDef<I>): any {
  const n = ++ids
  const mount = (v: any) => {
    const el = v.elm
    const emit = (type: string, detail?: any) => {
      const win: any = el.ownerDocument?.defaultView || {}
      el.dispatchEvent(new (win.CustomEvent || win.Event)(type, {detail, bubbles: true}))
    }
    const s = {p: v.data.ip, i: null as any, k: v.children[0].children as any[]}
    Object.defineProperty(el, S, {value: s, configurable: true})
    s.i = def.mount(el, s.p, emit)
    def.sync?.(s.i, v.children[0])
  }
  const hook = {
    insert: mount,
    postpatch(_: any, v: any) {
      const s = v.elm[S]
      if (!s) return mount(v)
      const p = v.data.ip
      if (!same(s.p, p)) { const prev = s.p; s.p = p; def.update?.(s.i, p, prev) }
      // the children's vnodes are cached per component: the same ones as last time, nothing to sync
      // (the island's own vnode is a new copy whenever its owner re-injects any child component)
      const kids = v.children[0].children || []
      if (s.k && kids.length == s.k.length && kids.every((x: any, i: number) => x === s.k[i])) return
      s.k = kids
      def.sync?.(s.i, v.children[0])
    },
    destroy(v: any) {
      const s = v.elm[S]
      if (s) { delete v.elm[S]; def.unmount?.(s.i) }
    },
  }
  const tag: any = () => {}
  tag.__sygnalControl = (props: any, children: any[], h: any) => {
    const {key, children: _c, ...p} = props || {}
    const hp: any = {hook, 'data-island-host': def.name}
    for (const k in p) if (HOST.test(k)) hp[k] = p[k]
    const v = h(def.tag || 'div', hp, h('div', {hidden: true, 'data-island': def.name}, ...children))
    // own key: snabbdom never patches an island host into a plain element of the same tag (or another island)
    return {...v, key: 'island' + n + (key == null ? '' : '#' + key), data: {...v.data, ip: p}}
  }
  tag.toString = () => `[data-island-host="${def.name}"]`
  return tag
}

/** the island instance mounted on a host element (tests, devtools) */
export const islandOf = (el: any): any => el?.[S]?.i
