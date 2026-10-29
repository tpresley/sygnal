// Prototype of what a `sygnal/compiled` runtime would hold: the helpers a compiling
// `sygnal/vite` would import into compiled views. Not part of the library; the apps in
// ../apps are hand-written compiler output that imports this file.
//
// Tier A, `P`: a vnode built directly, its data already routed into snabbdom's module
// buckets (no sanitizeData / route / flatten / sanitizeText at run time). Same six fields and
// the same `$p` prototype flag as the pragma's Plain, so the core treats it as plain (its view
// walk skips the subtree; the same-output check applies).
//
// Tier B, `block()`: a Million/Solid-style block. The element under the block is made by
// snabbdom from `sel`; its inside is a clone of a parsed template, and only the dynamic
// "holes" are written, by direct DOM ops, when their value changed. To snabbdom a block is
// a childless element with constant `data` (a hoisted hook object), so the module update
// hook returns at once (sameData: the same object) and the diff never walks inside.

export function P(sel, data, children, text, key) {
  this.sel = sel
  this.data = data
  this.children = children
  this.text = text
  this.elm = undefined
  this.key = key
}
Object.defineProperty(P.prototype, '$p', { value: 1 })

// A hole kind: what the compiler knows about the expression's position
//   'text': a text child (the template has a placeholder text node there)
//   'class': the root's class attribute (className)
//   'dataset:<name>': a data-* value on the root
// `paths`: per hole, the child-index path from the block's root element to its node
export function block(sel, html, holes) {
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  const content = tpl.content
  const n = holes.length
  const resolve = (elm, path) => { let x = elm; for (let i = 0; i < path.length; i++) x = x.childNodes[path[i]]; return x }
  const write = (node, kind, v) => {
    if (kind === 'text') node.data = v == null || v === false ? '' : '' + v
    else if (kind === 'class') node.className = v
    else node.dataset[kind.slice(8)] = v
  }
  const hook = {
    create(_, vn) {
      const elm = vn.elm
      elm.appendChild(content.cloneNode(true))
      const refs = vn.r = new Array(n), v = vn.v
      for (let i = 0; i < n; i++) { const h = holes[i]; write(refs[i] = resolve(elm, h[1]), h[0], v[i]) }
    },
    update(old, vn) {
      const refs = vn.r = old.r, a = old.v, b = vn.v
      for (let i = 0; i < n; i++) if (a[i] !== b[i]) write(refs[i], holes[i][0], b[i])
    },
  }
  const data = { hook }
  // the block's vnode: no children, no text; the values on the vnode (snabbdom keeps own fields)
  return (values, key) => { const vn = new P(sel, data, undefined, undefined, key); vn.v = values; return vn }
}
