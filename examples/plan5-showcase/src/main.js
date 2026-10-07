// The showcase shell (plain DOM, not a Sygnal app): a sidebar of sections, and for each demo a
// card with the live demo and its source. Every demo is its own Sygnal app, started by the
// `start(mountPoint, uid)` its file exports, so one demo's drivers or errors never touch another.
import './shell/styles.css'
import './shell/demos.css'
import { sections } from './sections.js'
import { highlight } from './shell/highlight.js'

const params = new URLSearchParams(location.search)
const entry = sections.find((s) => s.id === params.get('s')) || sections[0]
const { section: current } = await entry.load()

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') node.className = v
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v)
    else node.setAttribute(k, v)
  }
  for (const c of children.flat()) if (c != null) node.append(c)
  return node
}

function sidebar() {
  return el('nav', { className: 'sidebar', 'aria-label': 'Sections' },
    el('a', { className: 'brand', href: '?', 'data-router-ignore': '' },
      el('strong', {}, 'Sygnal 6.0'), el('span', {}, 'PLAN-5 feature showcase')),
    el('ol', { className: 'nav-sections' }, sections.map((s) => el('li', {},
      el('a', { href: `?s=${s.id}`, 'data-router-ignore': '', ...(s === entry ? { 'aria-current': 'page' } : {}) },
        s.title, s === entry ? el('span', { className: 'count' }, String(current.demos.length)) : null),
      s === entry
        ? el('ol', { className: 'nav-demos' }, current.demos.map((d) => el('li', {},
          el('button', { type: 'button', onClick: () => document.getElementById('card-' + d.id).scrollIntoView({ behavior: 'smooth', block: 'start' }) }, d.title))))
        : null))))
}

function codePanel(demo) {
  const names = Object.keys(demo.files)
  const pre = el('pre', { className: 'code' })
  const code = el('code', { className: 'hljs' })
  pre.append(code)
  const tabs = el('div', { className: 'code-tabs', role: 'tablist', 'aria-label': `${demo.title} source files` })
  let shown = names[0]
  const show = (name) => {
    shown = name
    code.innerHTML = highlight(demo.files[name], name)
    for (const b of tabs.querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.file === name))
  }
  for (const name of names) {
    tabs.append(el('button', { type: 'button', role: 'tab', 'data-file': name, onClick: () => show(name) }, name))
  }
  const copy = el('button', { type: 'button', className: 'copy', onClick: async () => {
    try { await navigator.clipboard.writeText(demo.files[shown]); copy.textContent = 'Copied' } catch { copy.textContent = 'Copy failed' }
    setTimeout(() => { copy.textContent = 'Copy' }, 1200)
  } }, 'Copy')
  show(shown)
  return el('div', { className: 'code-panel' }, el('div', { className: 'code-bar' }, tabs, copy), pre)
}

const running = new Map()

function start(demo) {
  const mount = document.getElementById('demo-' + demo.id)
  running.get(demo.id)?.dispose?.()
  mount.replaceChildren()
  mount.removeAttribute('data-sygnal-error')
  try {
    running.set(demo.id, demo.start('#demo-' + demo.id, demo.id))
  } catch (e) {
    console.error(e)
    mount.append(el('p', { className: 'demo-crash', role: 'alert' }, `This demo failed to start: ${e.message}`))
  }
}

function card(demo) {
  const header = el('header', { className: 'card-head' },
    el('div', {},
      el('h2', {}, demo.title),
      el('p', { className: 'desc' }, demo.description),
      demo.refs ? el('p', { className: 'refs' }, demo.refs) : null),
    demo.codeOnly ? null : el('button', { type: 'button', className: 'restart', onClick: () => start(demo) }, 'Restart'))
  const body = demo.codeOnly
    ? el('div', { className: 'card-body code-only' }, codePanel(demo))
    : el('div', { className: 'card-body' },
      el('div', { className: 'demo-frame' }, el('div', { className: 'demo-mount', id: 'demo-' + demo.id })),
      codePanel(demo))
  return el('article', { className: 'card' + (demo.wide ? ' wide' : ''), id: 'card-' + demo.id }, header, body)
}

const main = el('main', { className: 'content' },
  el('header', { className: 'section-head' }, el('h1', {}, current.title), el('p', {}, current.intro)),
  current.demos.map(card))

document.getElementById('shell').append(sidebar(), main)
for (const demo of current.demos) if (!demo.codeOnly) start(demo)
