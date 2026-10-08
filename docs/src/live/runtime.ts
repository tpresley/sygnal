// The client side of the live examples (the remark plugin: src/plugins/remark-live.mjs).
// Loaded only on a page with a `.sygnal-live` panel (src/components/MarkdownContent.astro);
// Babel, Sygnal, the libraries a demo imports and CodeMirror load lazily from here: a demo
// mounts when it scrolls near the viewport, the editor loads on the first Edit click.
import liveCss from './live.css?inline'
import { MODULES } from './modules'
import type { Compiled } from './compile'

type State = 'idle' | 'loading' | 'running' | 'error'

interface Panel {
  el: HTMLElement
  id: string
  lang: string
  original: string
  code: string
  component?: string
  name: string
  gen: number
  app?: { dispose(): void }
  mount?: HTMLElement
  result: HTMLElement
  errorEl: HTMLElement
  editorBox: HTMLElement
  editBtn: HTMLButtonElement
  runBtn: HTMLButtonElement
  resetBtn: HTMLButtonElement
  editor?: any
  editorLoading?: Promise<void>
  timer?: ReturnType<typeof setTimeout>
}

const BASE = 'http://live/'
const ENTRY = '/__example'
const EXTS = ['', '.js', '.jsx', '.ts', '.tsx']
const DEBOUNCE = 400

const decode = (s: string | undefined) => decodeURIComponent(s || '')

/** the page's live-file modules, by path ('/SalesChart.js') */
const files = new Map<string, { code: string; lang: string }>()
const namespaces = new Map<string, Promise<any>>()

/** a module namespace as Babel's CommonJS interop expects it (default import = the default export) */
function load(spec: string): Promise<any> {
  let p = namespaces.get(spec)
  if (!p) {
    const importer = MODULES[spec]
    if (!importer) return Promise.reject(unknownModule(spec))
    p = importer().then((ns) => (ns && ns.__esModule ? ns : Object.assign(Object.create(null), ns, { __esModule: true })))
    p.catch(() => namespaces.delete(spec))
    namespaces.set(spec, p)
  }
  return p
}

function unknownModule(spec: string) {
  const local = [...files.keys()].map((f) => `.${f}`)
  return new Error(
    `Unknown module '${spec}'. A live example can import: ${[...Object.keys(MODULES), ...local].join(', ')}.` +
      (/^[./]/.test(spec) ? ' A local module is a block with live-file=<path> on the same page.' : ' Add a library in docs/src/live/modules.ts.'),
  )
}

const isRelative = (spec: string) => /^\.{0,2}\//.test(spec)

function resolveFile(spec: string, from: string): string {
  const path = new URL(spec, BASE + from.replace(/^\//, '')).pathname
  const tries = [...EXTS.map((e) => path + e), ...(/\.js$/.test(path) ? ['.ts', '.tsx', '.jsx'].map((e) => path.replace(/\.js$/, e)) : [])]
  for (const t of tries) if (files.has(t)) return t
  throw unknownModule(spec)
}

const LANG_EXT: Record<string, string> = { javascript: 'js', typescript: 'ts' }
const ext = (lang: string) => LANG_EXT[lang] || lang

function setState(p: Panel, s: State) {
  p.el.dataset.liveState = s
}

function showError(p: Panel, err: any, info?: any) {
  const where = info && (info.componentName || info.phase) ? ` (${[info.componentName, info.phase, info.action].filter(Boolean).join(', ')})` : ''
  const msg = err instanceof Error ? `${err.name === 'Error' ? '' : err.name + ': '}${err.message}` : String(err)
  const pre = document.createElement('pre')
  pre.textContent = msg + where
  p.errorEl.replaceChildren(pre)
  p.errorEl.hidden = false
  if (!p.mount) p.result.replaceChildren()
  setState(p, 'error')
}

function clearError(p: Panel) {
  p.errorEl.replaceChildren()
  p.errorEl.hidden = true
}

function disposeApp(p: Panel) {
  const app = p.app
  p.app = undefined
  if (app) try { app.dispose() } catch (e) { console.warn('[live] dispose threw', e) }
}

async function runPanel(p: Panel) {
  const gen = ++p.gen
  clearTimeout(p.timer)
  if (p.el.dataset.liveState !== 'running') setState(p, 'loading')
  try {
    const [{ compile }, Sygnal, jsx] = await Promise.all([import('./compile'), load('sygnal'), load('sygnal/jsx-runtime')])
    if (gen !== p.gen) return

    // compile the example and the live-files it imports (transitively)
    const entry = compile(p.code, { lang: p.lang, filename: `${p.name}.${ext(p.lang)}`, component: p.component || 'auto' })
    const compiled = new Map<string, Compiled>([[ENTRY, entry]])
    const bare = new Set<string>()
    const links = new Map<string, Map<string, string>>()
    const visit = (from: string, c: Compiled) => {
      const map = new Map<string, string>()
      links.set(from, map)
      for (const spec of c.requires) {
        if (!isRelative(spec)) { bare.add(spec); continue }
        const key = resolveFile(spec, from)
        map.set(spec, key)
        if (!compiled.has(key)) {
          const f = files.get(key)!
          const fc = compile(f.code, { lang: f.lang, filename: key.slice(1), component: false })
          compiled.set(key, fc)
          visit(key, fc)
        }
      }
    }
    visit(ENTRY, entry)
    for (const spec of bare) if (!MODULES[spec]) throw unknownModule(spec)
    const loaded = new Map<string, any>()
    await Promise.all([...bare].map(async (s) => loaded.set(s, await load(s))))
    if (gen !== p.gen) return

    // evaluate: CommonJS-style, one fresh instance of each live-file per run
    const h = Sygnal.createElement
    const Fragment = jsx.Fragment
    const instances = new Map<string, { exports: any }>()
    let picked: { name: string; get: () => any } | undefined
    const evaluate = (key: string) => {
      const done = instances.get(key)
      if (done) return done.exports
      const module = { exports: {} as any }
      instances.set(key, module)
      const map = links.get(key)!
      const req = (spec: string) => (isRelative(spec) ? evaluate(map.get(spec)!) : loaded.get(spec))
      const set = key === ENTRY ? (name: string, get: () => any) => { picked = { name, get } } : () => {}
      const source = `${compiled.get(key)!.code}\n//# sourceURL=live/${p.id}${key === ENTRY ? '/' + p.name : key}`
      // eslint-disable-next-line no-new-func
      new Function('require', 'module', 'exports', '__h', '__Fragment', '__liveSet', source)(req, module, module.exports, h, Fragment, set)
      return module.exports
    }
    const exports = evaluate(ENTRY)

    let Component: any
    let name: string
    if (picked) {
      name = picked.name
      try { Component = picked.get() } catch (e) {
        throw new Error(`No component named '${picked.name}' in this example (live=${picked.name})`)
      }
    } else {
      Component = exports.default
      name = Component?.componentName || Component?.name || 'default export'
    }
    if (typeof Component !== 'function') {
      throw new Error(p.component
        ? `'${p.component}' is not a component function`
        : 'Nothing to mount: export default a component, or define one with a capitalized function declaration (or name it with live=Name in the fence)')
    }

    // mount into a fresh element: the previous app is disposed first
    disposeApp(p)
    clearError(p)
    const mount = document.createElement('div')
    mount.className = 'live-mount'
    p.mount ? p.mount.replaceWith(mount) : p.result.replaceChildren(mount)
    p.mount = mount
    p.result.setAttribute('aria-label', `Result: ${name}`)
    setState(p, 'running')
    p.app = Sygnal.run(Component, {}, {
      mountPoint: mount,
      uid: p.id,
      onError: (e: any, info: any) => { if (gen === p.gen) showError(p, e, info) },
    })
  } catch (err) {
    if (gen !== p.gen) return
    showError(p, err)
  }
}

function scheduleRun(p: Panel) {
  clearTimeout(p.timer)
  p.timer = setTimeout(() => runPanel(p), DEBOUNCE)
}

async function openEditor(p: Panel) {
  if (!p.editorLoading) {
    p.editorLoading = (async () => {
      const { createEditor, EditorView } = await import('./editor')
      p.editor = createEditor(p.editorBox, p.code, {
        typescript: p.lang === 'ts' || p.lang === 'tsx' || p.lang === 'typescript',
        onChange: () => {
          p.code = p.editor.state.doc.toString()
          scheduleRun(p)
        },
        keys: [{ key: 'Mod-Enter', run: () => { runPanel(p); return true } }],
        extra: [EditorView.contentAttributes.of({ 'aria-label': `Code of the example ${p.name}` })],
      })
    })()
  }
  await p.editorLoading
}

function button(cls: string, text: string, label?: string) {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = cls
  b.textContent = text
  if (label) b.setAttribute('aria-label', label)
  return b
}

function setup(el: HTMLElement): Panel {
  const id = el.dataset.liveId || `live-${Math.random().toString(36).slice(2, 8)}`
  const code = decode(el.dataset.code)
  const component = el.dataset.component || undefined
  const guess = component || code.match(/export\s+default\s+function\s+([A-Z][\w$]*)/)?.[1]
    || [...code.matchAll(/^(?:export\s+)?function\s+([A-Z][\w$]*)/gm)].pop()?.[1] || 'Example'

  const bar = document.createElement('div')
  bar.className = 'live-bar'
  const title = document.createElement('span')
  title.className = 'live-title'
  title.textContent = 'Result'
  const actions = document.createElement('div')
  actions.className = 'live-actions'
  const editBtn = button('live-edit', 'Edit', `Edit the code of ${guess}`)
  const runBtn = button('live-run', 'Run', `Run the edited code of ${guess}`)
  runBtn.title = 'Run (Ctrl+Enter / ⌘+Enter)'
  const resetBtn = button('live-reset', 'Reset', `Reset the code of ${guess}`)
  runBtn.hidden = true
  resetBtn.hidden = true
  actions.append(editBtn, runBtn, resetBtn)
  bar.append(title, actions)

  const editorBox = document.createElement('div')
  editorBox.className = 'live-editor'
  editorBox.id = `${id}-editor`
  editorBox.hidden = true
  editBtn.setAttribute('aria-expanded', 'false')
  editBtn.setAttribute('aria-controls', editorBox.id)

  const result = document.createElement('div')
  result.className = 'live-result'
  result.setAttribute('role', 'region')
  result.setAttribute('aria-label', `Result: ${guess}`)
  if (el.dataset.height) result.style.minHeight = `${Number(el.dataset.height)}px`
  const loading = document.createElement('p')
  loading.className = 'live-loading'
  loading.textContent = 'Loading the example…'
  result.append(loading)

  const errorEl = document.createElement('div')
  errorEl.className = 'live-error'
  errorEl.setAttribute('role', 'alert')
  errorEl.hidden = true

  el.replaceChildren(bar, editorBox, result, errorEl)
  const p: Panel = { el, id, lang: el.dataset.lang || 'jsx', original: code, code, component, name: guess, gen: 0, result, errorEl, editorBox, editBtn, runBtn, resetBtn }
  setState(p, 'idle')

  editBtn.addEventListener('click', async () => {
    const open = editorBox.hidden
    editorBox.hidden = !open
    runBtn.hidden = !open
    resetBtn.hidden = !open
    editBtn.textContent = open ? 'Hide code' : 'Edit'
    editBtn.setAttribute('aria-expanded', String(open))
    if (open) {
      try {
        await openEditor(p)
        p.editor.focus()
      } catch (e) {
        showError(p, e)
      }
    }
  })
  runBtn.addEventListener('click', () => runPanel(p))
  resetBtn.addEventListener('click', () => {
    p.code = p.original
    if (p.editor) p.editor.dispatch({ changes: { from: 0, to: p.editor.state.doc.length, insert: p.original } })
    runPanel(p)
  })
  return p
}

export function start() {
  // the panel's stylesheet, as a string: a CSS import would be added to every page
  const own = document.createElement('style')
  own.dataset.sygnalLive = 'panel'
  own.textContent = liveCss
  document.head.append(own)

  for (const f of document.querySelectorAll<HTMLElement>('.sygnal-live-file')) {
    const path = new URL(f.dataset.liveFile || '', BASE).pathname
    files.set(path, { code: decode(f.dataset.code), lang: f.dataset.lang || 'js' })
  }
  const css = [...document.querySelectorAll<HTMLElement>('.sygnal-live-css')].map((c) => decode(c.dataset.code))
  if (css.length) {
    const style = document.createElement('style')
    style.dataset.sygnalLive = ''
    style.textContent = css.join('\n')
    document.head.append(style)
  }

  const panels = [...document.querySelectorAll<HTMLElement>('.sygnal-live')].map((el) => {
    try {
      return setup(el)
    } catch (e) {
      console.warn('[live] could not set up a demo', e)
      return null
    }
  }).filter(Boolean) as Panel[]

  const byEl = new Map(panels.map((p) => [p.el, p]))
  if (typeof IntersectionObserver !== 'function') {
    panels.forEach(runPanel)
    return
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      io.unobserve(e.target)
      const p = byEl.get(e.target as HTMLElement)
      if (p && p.gen === 0) runPanel(p)
    }
  }, { rootMargin: '300px 0px' })
  panels.forEach((p) => io.observe(p.el))
}
