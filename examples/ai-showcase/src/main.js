// The showcase shell (plain DOM, not a Sygnal app): the top bar, the table of contents and one
// card per section. Each widget is its own Sygnal app, started when its card comes near the
// screen; its source is in the card's code panel, hidden until "Show code".
import './shell/styles.css'
import './shell/widgets.css'
import wordmark from './shell/wordmark.svg?raw'
import { sections, PROVIDER_LABELS } from './sections.js'
import { highlight } from './shell/highlight.js'
import { startHeader } from './shell/Header.jsx'

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue
    if (k === 'className') node.className = v
    else if (k === 'html') node.innerHTML = v
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v)
    else node.setAttribute(k, v === true ? '' : v)
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c)
  return node
}

/** `code` spans in a blurb */
const rich = (text) => text.split(/(`[^`]+`)/).map((part) => (part.startsWith('`') ? el('code', {}, part.slice(1, -1)) : part))

const chevron = () => el('span', { 'aria-hidden': 'true', html: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg>' })

function topbar() {
  const theme = el('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Switch theme', title: 'Switch theme', onClick: () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'
    document.documentElement.dataset.theme = next
    try { localStorage.setItem('ai-showcase:theme', next) } catch {}
  } }, el('span', { 'aria-hidden': 'true', html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>' }))
  return el('header', { className: 'topbar' },
    el('a', { className: 'brand', href: '#top', html: wordmark }, el('span', { className: 'tag' }, 'AI')),
    el('div', { className: 'spacer' }),
    el('div', { id: 'header-mount' }),
    theme)
}

function hero() {
  return el('section', { className: 'hero', id: 'top' },
    el('img', { className: 'hero-mark', src: '/logo.svg', alt: '' }),
    el('span', { className: 'eyebrow' }, 'sygnal/ai · live demos'),
    el('h1', {}, 'Native AI, ', el('span', { className: 'grad' }, 'the Sygnal way')),
    el('p', { className: 'lede' }, 'Models plug into the places everything else already goes: a driver for requests, actions for replies, statics for declarations. Each widget below is a small, complete Sygnal app running against real models: local ones on Ollama, hosted ones on Kindo and TypeSafe through this dev server, and the browser\'s own.'),
    el('div', { className: 'principles' },
      el('span', {}, el('b', {}, 'Pay per use'), ' · nothing loads that a widget doesn\'t import'),
      el('span', {}, el('b', {}, 'The model chooses, the app does'), ' · every label is the app\'s own'),
      el('span', {}, el('b', {}, 'Keys stay on the server'), ' · this page never holds one')))
}

function codePanel(files) {
  const names = Object.keys(files)
  const code = el('code', { className: 'language-jsx' })
  let shown = names[0]
  const tabs = names.map((name) => el('button', { type: 'button', role: 'tab', 'data-file': name, onClick: () => show(name) }, name))
  const show = (name) => {
    shown = name
    code.innerHTML = highlight(files[name], name)
    for (const b of tabs) b.setAttribute('aria-selected', String(b.dataset.file === name))
  }
  const copy = el('button', { type: 'button', className: 'copy', onClick: async () => {
    try { await navigator.clipboard.writeText(files[shown]); copy.textContent = 'Copied' } catch { copy.textContent = 'Copy failed' }
    setTimeout(() => { copy.textContent = 'Copy' }, 1200)
  } }, 'Copy')
  show(shown)
  return { bar: el('div', { className: 'code-bar' }, el('div', { role: 'tablist', className: 'code-tabs' }, tabs), copy), pre: el('pre', {}, code) }
}

const running = new Map()

async function start(section) {
  const stage = document.getElementById(`stage-${section.id}`)
  running.get(section.id)?.app?.dispose?.()
  stage.replaceChildren(el('p', { className: 'loading' }, 'Loading…'))
  try {
    const demo = running.get(section.id)?.demo ?? await section.load()
    const mount = el('div', { className: 'mount', id: `mount-${section.id}` })
    stage.replaceChildren(mount)
    const app = demo.start ? demo.start(mount, section.id) : null
    running.set(section.id, { demo, app })
    return demo
  } catch (e) {
    console.error(e)
    stage.replaceChildren(el('p', { className: 'stage-crash', role: 'alert' }, `This widget failed to start: ${e.message}`))
  }
}

function feature(section, i) {
  const panel = el('div', { className: 'code-panel', hidden: true })
  const toggle = el('button', { type: 'button', className: 'code-toggle', 'aria-expanded': 'false', 'aria-controls': `code-${section.id}`, onClick: async () => {
    const open = panel.hidden
    if (open && !panel.firstChild) {
      const demo = running.get(section.id)?.demo ?? await section.load()
      const { bar, pre } = codePanel(demo.files)
      panel.append(bar, pre)
    }
    panel.hidden = !open
    toggle.setAttribute('aria-expanded', String(open))
    toggle.lastChild.textContent = open ? 'Hide code' : 'Show code'
  } }, chevron(), el('span', {}, 'Show code'))
  panel.id = `code-${section.id}`
  const n = String(i + 1).padStart(2, '0')
  return el('article', { className: 'feature', id: section.id },
    el('div', { className: 'feature-head' },
      el('div', { className: 'feature-num' }, n),
      el('div', {},
        el('h2', {}, section.title),
        el('p', {}, rich(section.blurb)),
        el('div', { className: 'meta' },
          section.providers.map((p) => el('span', { className: `chip p-${p.split('-')[0]}` }, PROVIDER_LABELS[p])),
          section.apis.map((a) => el('span', { className: 'chip api' }, a))))),
    el('div', { className: 'stage', id: `stage-${section.id}` }, el('p', { className: 'loading' }, 'Starts when you scroll here…')),
    el('div', { className: 'feature-foot' }, toggle,
      el('button', { type: 'button', className: 'restart', onClick: () => start(section) }, '↻ Restart')),
    panel)
}

function toc() {
  return el('nav', { className: 'toc', 'aria-label': 'Sections' },
    el('h4', {}, 'Features'),
    el('ol', {}, sections.map((s, i) => el('li', {}, el('a', { href: `#${s.id}`, 'data-id': s.id }, el('span', { className: 'n' }, String(i + 1).padStart(2, '0')), s.title)))))
}

document.getElementById('shell').append(
  topbar(),
  el('div', { className: 'layout' }, toc(), el('main', {}, hero(), sections.map(feature))))

startHeader(document.getElementById('header-mount'))

// start each widget when its card comes near the screen
const starter = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue
    starter.unobserve(e.target)
    start(sections.find((s) => s.id === e.target.id))
  }
}, { rootMargin: '300px 0px' })
for (const s of sections) starter.observe(document.getElementById(s.id))

// highlight the section in view
const links = new Map([...document.querySelectorAll('.toc a')].map((a) => [a.dataset.id, a]))
const spy = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) for (const [id, a] of links) a.classList.toggle('active', id === e.target.id)
}, { rootMargin: '-40% 0px -55% 0px' })
for (const s of sections) spy.observe(document.getElementById(s.id))
