// The showcase shell (plain DOM, not a Sygnal app): the top bar, two tabs (Features, and Building
// Chat: one chat built up step by step), a table of contents per tab and one card per section.
// Each widget is its own Sygnal app, started when its card comes near the screen (a hidden tab's
// cards wait until it is shown); its source is in the card's code panel, hidden until "Show code".
import './shell/styles.css'
import './shell/widgets.css'
import wordmark from './shell/wordmark.svg?raw'
import { sections, PROVIDER_LABELS } from './sections.js'
import { steps } from './building/steps.js'
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

/** the indexes of the lines of `after` that are not in `before` (a longest-common-subsequence diff) */
function newLines(before, after) {
  const a = before.split('\n'), b = after.split('\n')
  const common = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) common[i][j] = a[i] === b[j] ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1])
  }
  const added = []
  for (let i = 0, j = 0; j < b.length;) {
    if (i < a.length && a[i] === b[j]) { i++; j++ } else if (i < a.length && common[i + 1][j] >= common[i][j + 1]) i++
    else { if (b[j].trim()) added.push(j); j++ }
  }
  return added
}

/** `changedSince`: per file, `{ source, label }` to compare with: its new lines are marked */
function codePanel(files, changedSince = {}) {
  const names = Object.keys(files)
  const code = el('code', { className: 'language-jsx' })
  const marks = el('div', { className: 'line-marks', 'aria-hidden': 'true' })
  const legend = el('span', { className: 'code-legend' })
  let shown = names[0]
  const tabs = names.map((name) => el('button', { type: 'button', role: 'tab', 'data-file': name, onClick: () => show(name) }, name))
  const show = (name) => {
    shown = name
    code.innerHTML = highlight(files[name], name)
    for (const b of tabs) b.setAttribute('aria-selected', String(b.dataset.file === name))
    const base = changedSince[name]
    const added = base ? newLines(base.source, files[name]) : []
    marks.replaceChildren(...added.map((n) => el('i', { style: `top: calc(16px + ${n} * 1.6em)` })))
    legend.replaceChildren(...(base ? [el('i', { className: 'swatch' }), `${added.length} lines new since ${base.label}`] : []))
  }
  const copy = el('button', { type: 'button', className: 'copy', onClick: async () => {
    try { await navigator.clipboard.writeText(files[shown]); copy.textContent = 'Copied' } catch { copy.textContent = 'Copy failed' }
    setTimeout(() => { copy.textContent = 'Copy' }, 1200)
  } }, 'Copy')
  show(shown)
  return { bar: el('div', { className: 'code-bar' }, el('div', { role: 'tablist', className: 'code-tabs' }, tabs), legend, copy), pre: el('pre', {}, marks, code) }
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
      const { bar, pre } = codePanel(demo.files, demo.changedSince)
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

const TABS = [
  { id: 'features', label: 'Features', list: sections },
  { id: 'building', label: 'Building Chat', list: steps },
]
const all = [...sections, ...steps]

function toc(tab) {
  return el('nav', { className: 'toc', 'aria-label': `${tab.label}: sections`, 'data-tab': tab.id },
    el('h4', {}, tab.id === 'building' ? 'Steps' : tab.label),
    el('ol', {}, tab.list.map((s, i) => el('li', {}, el('a', { href: `#${s.id}`, 'data-id': s.id }, el('span', { className: 'n' }, String(i + 1).padStart(2, '0')), s.title)))))
}

/** the Building Chat tab's intro, with whether its one model is reachable */
function buildingIntro() {
  const status = el('p', { className: 'kimi-status', role: 'status' }, 'Looking for Kimi K3…')
  const check = async () => {
    try {
      const kindo = (await (await fetch('/api/providers')).json()).kindo
      const ready = kindo?.reachable && kindo.models.some((m) => /kimi[-_. ]?k3/i.test(m))
      status.className = `kimi-status ${ready ? 'ok' : 'warn'}`
      status.textContent = ready ? 'Kimi K3 on Kindo is ready.' : kindo?.configured ? `Kindo isn't answering: ${kindo.error ?? 'no Kimi K3'}.` : 'These steps need a Kindo key: add one with Keys, top right.'
    } catch { status.textContent = 'Could not reach the dev server.' }
  }
  check()
  document.addEventListener('showcase:keys', check)
  return el('div', { className: 'pane-intro' },
    el('p', {}, 'One chat, built up a feature at a time. Each step is a complete Sygnal app: the step before\'s code plus one feature, with the new lines marked under Show code. Every step talks to one model, Kimi K3 on Kindo, so none of them has a model picker. The chips fill in the prompt; you press Send.'),
    status)
}

function tabBar() {
  return el('div', { className: 'tab-bar', role: 'tablist', 'aria-label': 'Showcase' },
    TABS.map((t) => el('button', { type: 'button', role: 'tab', id: `tab-${t.id}`, 'aria-controls': `pane-${t.id}`, 'data-tab': t.id, onClick: () => selectTab(t.id, true) }, t.label)))
}

function selectTab(id, fromClick = false) {
  for (const b of document.querySelectorAll('.tab-bar [role="tab"]')) b.setAttribute('aria-selected', String(b.dataset.tab === id))
  for (const t of TABS) {
    document.getElementById(`pane-${t.id}`).hidden = t.id !== id
    document.querySelector(`.toc[data-tab="${t.id}"]`).hidden = t.id !== id
  }
  if (fromClick) {
    history.replaceState(null, '', `#${id}`)
    const bar = document.querySelector('.tab-bar')
    if (bar.getBoundingClientRect().top < 0) bar.scrollIntoView()
  }
}

/** the tab a link opens: #building, or one of its steps; else Features */
const tabOf = (hash) => (hash === '#building' || steps.some((s) => `#${s.id}` === hash) ? 'building' : 'features')

document.getElementById('shell').append(
  topbar(),
  el('div', { className: 'layout' },
    el('div', { className: 'tocs' }, TABS.map(toc)),
    el('main', {}, hero(), tabBar(),
      el('div', { className: 'pane', id: 'pane-features', role: 'tabpanel', 'aria-labelledby': 'tab-features' }, sections.map(feature)),
      el('div', { className: 'pane', id: 'pane-building', role: 'tabpanel', 'aria-labelledby': 'tab-building' }, buildingIntro(), steps.map(feature)))))

selectTab(tabOf(location.hash))
// a link to a tab or a section opens its tab (not other anchors, such as #top)
const known = (hash) => [...TABS, ...all].some((x) => `#${x.id}` === hash)
window.addEventListener('hashchange', () => {
  if (!known(location.hash)) return
  const tab = tabOf(location.hash)
  const hidden = document.getElementById(`pane-${tab}`).hidden
  selectTab(tab)
  // the browser scrolled while the target was hidden: scroll again now that it is shown
  if (hidden) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'instant' })
})
startHeader(document.getElementById('header-mount'))

// start each widget when its card comes near the screen
const starter = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue
    starter.unobserve(e.target)
    start(all.find((s) => s.id === e.target.id))
  }
}, { rootMargin: '300px 0px' })
for (const s of all) starter.observe(document.getElementById(s.id))

// highlight the section in view
const links = new Map([...document.querySelectorAll('.toc a')].map((a) => [a.dataset.id, a]))
const spy = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) for (const [id, a] of links) a.classList.toggle('active', id === e.target.id)
}, { rootMargin: '-40% 0px -55% 0px' })
for (const s of all) spy.observe(document.getElementById(s.id))
