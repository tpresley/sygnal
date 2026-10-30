// The host page's side of the tree: mirrors the guest's serialized host tree into the real DOM,
// through a sanitizer, and forwards DOM events back.
//
// Everything that arrives is untrusted (the guest can send any JSON). The mirror:
//   - creates only allowlisted tags and attributes (no on*, srcdoc, formaction, <script>, <iframe>,
//     <style>, <svg>, …); unknown tags are dropped, never rendered;
//   - checks URLs: <a href> only http(s)/mailto (clicks never navigate by themselves: see events),
//     <img src> only data:image/* or an allowlisted origin (an image is a network request, so an
//     exfiltration channel);
//   - filters inline style (no url(), image-set(), expression(), escapes; names must be plain);
//   - prefixes ids (and for / aria-* references to them) so the guest can't clobber the page's ids
//     or `window.<id>` named access; `name` only on form fields (document.<name> clobbering);
//   - limits nodes, depth and text so a huge tree can't stall the page;
//   - confines layout: the root has `contain: content` (a containing block for position: fixed,
//     paint clipped) and `isolation: isolate`, so the guest can't overlay the page (UI spoofing).
// A violation is recorded (violations[]) and the offending part is dropped; a malformed tree
// (a cycle, an id reused under itself) throws, and the sandbox is killed.

const TAGS = new Set(('div span p a button input textarea select option optgroup label ul ol li h1 h2 h3 h4 h5 h6 strong em b i u s small ' +
  'code pre kbd br hr img table caption thead tbody tfoot tr td th colgroup col form fieldset legend section article header ' +
  'footer nav main aside figure figcaption details summary progress meter time abbr blockquote q cite dl dt dd mark sub sup output').split(' '))
const ATTRS = /^(class|title|role|tabindex|lang|dir|hidden|alt|width|height|colspan|rowspan|scope|open|value|placeholder|checked|selected|disabled|readonly|required|multiple|min|max|step|minlength|maxlength|pattern|size|rows|cols|wrap|autocomplete|spellcheck|start|reversed|datetime|high|low|optimum|label|draggable)$|^aria-[a-z-]+$|^data-[a-z0-9-]+$/
const INPUT_TYPES = /^(text|search|email|url|tel|number|range|date|time|datetime-local|month|week|color|checkbox|radio|button|submit|reset|hidden)$/
const ID_REFS = /^(for|aria-labelledby|aria-describedby|aria-controls|aria-owns|aria-activedescendant|list)$/
const SAFE_HREF = /^(https?:|mailto:)/i
const BAD_STYLE = /url\s*\(|image-set|expression|javascript:|\\|@|<|behavior|binding/i
const FIELD = /^(input|textarea|select|button|output|fieldset)$/

let roots = 0

export const DEFAULT_POLICY = {maxNodes: 5000, maxDepth: 128, maxText: 1 << 20, imageOrigins: []}

/**
 * One element's attributes and inline style through the allowlist (the mirror and SSR share it):
 * returns {attrs: Map, css: string}; what it drops goes to violate(what).
 */
export function sanitize(tag, n, prefix, policy, violate) {
  const attrs = new Map()
  for (const [k0, v0] of Object.entries(n.a || {})) {
    const k = String(k0).toLowerCase(), v = String(v0)
    if (k === 'id') attrs.set('id', prefix + v)
    else if (ID_REFS.test(k)) attrs.set(k, v.split(/\s+/).map(x => prefix + x).join(' '))
    else if (k === 'name') { if (FIELD.test(tag)) attrs.set(k, v); else violate(`name on <${tag}>`) }
    else if (k === 'type') { if (tag !== 'input' || INPUT_TYPES.test(v)) attrs.set(k, v); else violate(`input type ${v}`) }
    else if (k === 'href') { if (tag === 'a' && SAFE_HREF.test(v.trim())) attrs.set(k, v); else violate(`href ${v.slice(0, 40)}`) }
    else if (k === 'src') { if (tag === 'img' && imageOk(v, policy)) attrs.set(k, v); else violate(`src ${v.slice(0, 40)}`) }
    else if (k === 'style') violate('style attribute') // inline style arrives as n.s, filtered below
    else if (ATTRS.test(k)) attrs.set(k, v)
    else violate(`attribute ${k}`)
  }
  if (tag === 'a' && attrs.has('href')) { attrs.set('rel', 'noopener noreferrer'); attrs.set('target', '_blank') }
  const css = []
  for (const [k, v0] of Object.entries(n.s || {})) {
    const name = String(k).replace(/[A-Z]/g, c => '-' + c.toLowerCase()), v = String(v0)
    if (!/^-?[a-z][a-z-]*$/.test(name) || BAD_STYLE.test(v)) { violate(`style ${name}`); continue }
    css.push(`${name}: ${v}`)
  }
  return {attrs, css: css.join('; ')}
}
function imageOk(v, policy) {
  if (/^data:image\/(png|gif|jpeg|webp);base64,/i.test(v)) return true
  try { return policy.imageOrigins.includes(new URL(v).origin) } catch { return false }
}

const VOID = new Set(['br', 'hr', 'img', 'input', 'col'])
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c])
/**
 * SSR from a sandbox: one render message's tree as HTML, through the same allowlist and limits
 * (a full tree: no bare ids). Edge / multi-tenant rendering of a tenant's component.
 */
export function treeToHTML(tree, opts = {}) {
  const policy = {...DEFAULT_POLICY, ...opts.policy}, prefix = opts.prefix ?? 'sbx-'
  const violations = [], violate = (w) => { if (violations.length < 100) violations.push(w) }
  let count = 0, text = 0
  const out = (n, depth) => {
    if (depth > policy.maxDepth || ++count > policy.maxNodes) throw new Error('sandbox tree: over the limits')
    if (!n || typeof n != 'object') throw new Error('sandbox tree: malformed node (SSR needs a full tree)')
    if (typeof n.x == 'string') { if ((text += n.x.length) > policy.maxText) throw new Error('sandbox tree: too much text'); return esc(n.x) }
    const tag = String(n.t)
    if (!TAGS.has(tag)) { violate(`tag <${tag}>`); return '' }
    const {attrs, css} = sanitize(tag, n, prefix, policy, violate)
    if ('v' in n && tag === 'input') attrs.set('value', String(n.v))
    if (n.k && (tag === 'input' || tag === 'option')) attrs.set(tag === 'option' ? 'selected' : 'checked', '')
    if (css) attrs.set('style', css)
    const open = `<${tag}${[...attrs].map(([k, v]) => ` ${k}="${esc(v)}"`).join('')}>`
    if (VOID.has(tag)) return open
    const inner = tag === 'textarea' ? esc(n.v ?? '') : (Array.isArray(n.c) ? n.c : []).map(c => out(c, depth + 1)).join('')
    return `${open}${inner}</${tag}>`
  }
  return {html: (Array.isArray(tree) ? tree : []).map(n => out(n, 0)).join(''), violations}
}

export function createMirror(container, opts = {}) {
  const policy = {...DEFAULT_POLICY, ...opts.policy}
  const doc = container.ownerDocument
  const prefix = `sbx${++roots}-`
  const root = doc.createElement('div')
  root.setAttribute('data-sandbox-root', '')
  root.style.cssText = 'contain: content; isolation: isolate; position: relative; overflow: hidden'
  container.appendChild(root)

  const nodes = new Map()     // guest id → real node
  const idOf = new WeakMap()  // real node → guest id
  const violations = []
  const violate = (what) => { if (violations.length < 100) violations.push(what) }
  let count, text, alive

  const keepSubtree = (n) => {
    const i = idOf.get(n)
    if (i !== undefined) alive.add(i)
    for (const c of n.childNodes) keepSubtree(c)
  }

  function build(n, depth) {
    if (depth > policy.maxDepth) throw new Error('sandbox tree: too deep')
    if (++count > policy.maxNodes) throw new Error('sandbox tree: too many nodes')
    if (typeof n == 'number') {
      const real = nodes.get(n)
      if (!real) return null // dropped by the sanitizer when it was sent
      keepSubtree(real)
      return real
    }
    if (!n || typeof n != 'object' || typeof n.i != 'number') throw new Error('sandbox tree: malformed node')
    alive.add(n.i)
    if (typeof n.x == 'string') {
      if ((text += n.x.length) > policy.maxText) throw new Error('sandbox tree: too much text')
      let t = nodes.get(n.i)
      if (!t || t.nodeType !== 3) { t = doc.createTextNode(n.x); nodes.set(n.i, t); idOf.set(t, n.i) }
      else if (t.data !== n.x) t.data = n.x
      return t
    }
    const tag = String(n.t)
    if (!TAGS.has(tag)) { violate(`tag <${tag}>`); return null }
    let el = nodes.get(n.i)
    if (!el || el.localName !== tag) { el = doc.createElement(tag); nodes.set(n.i, el); idOf.set(el, n.i) }
    const {attrs: want, css: cssText} = sanitize(tag, n, prefix, policy, violate)
    for (const a of [...el.attributes]) if (a.name !== 'style' && !want.has(a.name)) el.removeAttribute(a.name)
    for (const [k, v] of want) if (el.getAttribute(k) !== v) el.setAttribute(k, v)
    if ((el.getAttribute('style') || '') !== cssText) cssText ? el.setAttribute('style', cssText) : el.removeAttribute('style')
    // field state the guest controls
    if ('v' in n && el.value !== String(n.v)) el.value = String(n.v)
    if ('k' in n && (tag === 'input' || tag === 'option')) tag === 'option' ? (el.selected = !!n.k) : (el.checked = !!n.k)
    // children, in order
    const kids = []
    for (const c of Array.isArray(n.c) ? n.c : []) { const r = build(c, depth + 1); if (r) kids.push(r) }
    for (let i = 0; i < kids.length; i++) {
      if (kids[i].contains(el)) throw new Error('sandbox tree: a node inside itself')
      if (el.childNodes[i] !== kids[i]) el.insertBefore(kids[i], el.childNodes[i] || null)
    }
    while (el.childNodes.length > kids.length) el.removeChild(el.lastChild)
    return el
  }

  return {
    root, violations, prefix,
    /** apply one render: {tree: [...], types: [...]}; throws on a malformed tree */
    apply(tree) {
      count = 0; text = 0; alive = new Set()
      const top = []
      for (const n of Array.isArray(tree) ? tree : []) { const r = build(n, 0); if (r) top.push(r) }
      for (let i = 0; i < top.length; i++) if (root.childNodes[i] !== top[i]) root.insertBefore(top[i], root.childNodes[i] || null)
      while (root.childNodes.length > top.length) root.removeChild(root.lastChild)
      for (const k of nodes.keys()) if (!alive.has(k)) nodes.delete(k)
    },
    /** the guest id of a real node, or of its nearest mirrored ancestor inside the root */
    idFor(target) {
      for (let n = target; n && n !== root; n = n.parentNode) { const i = idOf.get(n); if (i !== undefined) return i }
      return undefined
    },
    clear() { root.remove(); nodes.clear() },
  }
}

const FORWARD = /^(click|dblclick|input|change|submit|keydown|keyup|focus|blur|focusin|focusout|pointerdown|pointerup|mouseenter|mouseleave)$/
const NO_BUBBLE = /^(focus|blur|mouseenter|mouseleave)$/
const STOP = ('click dblclick auxclick contextmenu mousedown mouseup mouseover mouseout pointerdown pointerup pointerover pointerout ' +
  'input change submit reset keydown keyup keypress beforeinput focusin focusout touchstart touchend wheel select').split(' ')
const KEYS = ['key', 'code', 'shiftKey', 'ctrlKey', 'altKey', 'metaKey', 'button', 'clientX', 'clientY']

/**
 * DOM events → the guest: one listener at the mirror's root per type the guest listens for
 * (delegation, as the DOM driver does), with the event's plain fields and the target's
 * value / checked. `dispatch(id, type, init)` returns whether the guest prevented the default
 * (in-thread: synchronous), or undefined (a worker: it answers later, too late for this event).
 * A form submit and a link click never act on the page by themselves; an unprevented link click
 * goes to `navigate(href)`.
 */
export function bindEvents(mirror, dispatch, navigate) {
  const root = mirror.root, on = new Map()
  const add = (type, l, capture = false) => { on.set(type, [l, capture]); root.addEventListener(type.replace(/^\$/, ''), l, capture) }
  function onEvent(e) {
    const id = mirror.idFor(e.target)
    if (id === undefined) return
    const t = e.target, init = {}
    for (const k of KEYS) if (e[k] !== undefined) init[k] = e[k]
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) { init.value = t.value; if (t.type === 'checkbox' || t.type === 'radio') init.checked = t.checked }
    if (dispatch(id, e.type, init)) e.preventDefault()
  }
  add('$submit', (e) => e.preventDefault())
  // The guest's elements are not the host app's: its delegated intents (DOM.select('.danger'),
  // bubbling at the app root) must never see a sandboxed element's events, or a guest could render
  // a class the host listens to and have the user trigger a host action. The page's own capture
  // listeners still see them.
  for (const t of STOP) add('$' + t, (e) => e.stopPropagation())
  const link = (e) => {
    const a = e.target?.closest?.('a[href]')
    if (!a || !root.contains(a)) return
    const was = e.defaultPrevented
    e.preventDefault()
    if (!was) navigate?.(a.getAttribute('href'))
  }
  add('$click', link)
  return {
    listen(types) {
      for (const t of types) if (!on.has(t) && FORWARD.test(t)) add(t, onEvent, NO_BUBBLE.test(t))
      // the link check runs after the guest's own click (whose preventDefault it honours): last
      if (types.includes('click')) { root.removeEventListener('click', link); root.addEventListener('click', link) }
    },
    detach() { for (const [t, [l, c]] of on) root.removeEventListener(t.replace(/^\$/, ''), l, c); on.clear() },
  }
}
