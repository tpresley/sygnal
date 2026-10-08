// The client side of the live examples (the remark plugin: src/plugins/remark-live.mjs).
// Loaded only on a page with a `.sygnal-live` panel (src/components/MarkdownContent.astro).
// The build compiled every block, so a demo needs Sygnal and the libraries it imports, not
// Babel: the compiler (src/live/compile.mjs, with Babel) loads on the first run of edited code,
// CodeMirror on the first Edit click. A demo mounts when it scrolls near the viewport.
import liveCss from './live.css?inline'
import { MODULES } from './modules'
import { isRelative, fileKey, resolveLiveFile } from './paths.mjs'
import { makeDemoFetch, type NoteKind } from './server'

type State = 'idle' | 'loading' | 'running' | 'error'
interface Compiled { code: string; requires: string[] }
interface LiveModule { code: string; lang: string; compiled?: Compiled }

interface Panel {
  el: HTMLElement
  id: string
  lang: string
  original: string
  /** the build's compile of the original code */
  compiled?: Compiled
  code: string
  component?: string
  /** the demo server block that serves this panel (the last live-server before it), a files key */
  server?: string
  name: string
  gen: number
  app?: { dispose(): void; __runtime?: any }
  /** the running app's identity: its callbacks act only while it is the panel's app */
  token?: object
  mount?: HTMLElement
  /** demo-server requests in flight (data-live-pending, for check-live) */
  pending: number
  result: HTMLElement
  errorEl: HTMLElement
  noteEl: HTMLElement
  editorBox: HTMLElement
  editBtn: HTMLButtonElement
  runBtn: HTMLButtonElement
  resetBtn: HTMLButtonElement
  editor?: any
  editorLoading?: Promise<void>
  timer?: ReturnType<typeof setTimeout>
}

const ENTRY = '/__example'
const DEBOUNCE = 400

const decode = (s: string | undefined) => decodeURIComponent(s || '')
const decodeJSON = (s: string | undefined) => { try { return s ? JSON.parse(decodeURIComponent(s)) : undefined } catch { return undefined } }

/** the page's live-file modules (and demo servers), by key ('/SalesChart.js') */
const files = new Map<string, LiveModule>()
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
  const local = [...files.keys()].filter((f) => !f.startsWith('/__demo-server')).map((f) => `.${f}`)
  return new Error(
    `Unknown module '${spec}'. A live example can import: ${[...Object.keys(MODULES), ...local].join(', ')}.` +
      (isRelative(spec) ? ' A local module is a block with live-file=<path> on the same page.' : ' Add a library in docs/src/live/modules.ts.'),
  )
}

function resolveFile(spec: string, from: string): string {
  const key = resolveLiveFile(spec, from, (k: string) => files.has(k))
  if (!key) throw unknownModule(spec)
  return key
}

const LANG_EXT: Record<string, string> = { javascript: 'js', typescript: 'ts' }
const ext = (lang: string) => LANG_EXT[lang] || lang

/** the compiler (and Babel): only for edited code, or a block the build didn't compile */
let compiler: Promise<typeof import('./compile.mjs')> | undefined
const getCompiler = () => {
  compiler ||= import('./compile.mjs')
  compiler.catch(() => { compiler = undefined })
  return compiler
}

function setState(p: Panel, s: State) {
  p.el.dataset.liveState = s
}

const where = (info?: any) => (info && (info.componentName || info.phase) ? ` (${[info.componentName, info.phase, info.action].filter(Boolean).join(', ')})` : '')

function showError(p: Panel, err: any, info?: any, stale = false) {
  const msg = err instanceof Error ? `${err.name === 'Error' ? '' : err.name + ': '}${err.message}` : String(err)
  const pre = document.createElement('pre')
  pre.textContent = msg + where(info)
  const parts: Node[] = [pre]
  if (stale) {
    // the previous app keeps running: say so
    const s = document.createElement('p')
    s.className = 'live-stale'
    s.textContent = 'The result above is the previous version of the code; it keeps running until the code runs again.'
    parts.push(s)
  }
  p.errorEl.replaceChildren(...parts)
  p.errorEl.hidden = false
  if (!p.mount) p.result.replaceChildren()
  setState(p, 'error')
}

/**
 * The drivers every live demo gets, under the names the docs use in run(): the local ones
 * (no real server, no page-level side effects). Documented in src/plugins/remark-live.mjs
 */
function defaultDrivers(Sygnal: any, mount: Element, http: any) {
  return {
    HTTP: http,
    // run()'s DOM driver plus the View Transition hook (the `viewTransitions` static). Without
    // that static, or without document.startViewTransition, it patches exactly as run()'s own
    DOM: Sygnal.makeViewTransitionDOMDriver(mount),
    TIMER: Sygnal.makeTimerDriver(),
    BROWSER: Sygnal.makeBrowserDriver(),
    DND: Sygnal.makeDragDriver(),
  }
}

type Kind = NoteKind | 'handled-error'

/** a quiet line in the panel (handled errors, demo server requests): the last 6 are kept */
function addNote(p: Panel, text: string, kind: Kind) {
  const line = document.createElement('div')
  line.textContent = text
  line.dataset.kind = kind
  p.noteEl.append(line)
  while (p.noteEl.childElementCount > 6) p.noteEl.firstElementChild!.remove()
  p.noteEl.hidden = false
}

function clearMessages(p: Panel) {
  p.noteEl.replaceChildren()
  p.noteEl.hidden = true
  p.errorEl.replaceChildren()
  p.errorEl.hidden = true
}

function disposeApp(p: Panel) {
  const app = p.app
  p.app = undefined
  p.token = undefined
  if (app) try { app.dispose() } catch (e) { console.warn('[live] dispose threw', e) }
}

// ---- after the DOM patch -----------------------------------------------------------------

/** the View Transition the page started last (the DOM driver patches inside its update) */
let lastTransition: any
function trackViewTransitions() {
  const d: any = document
  if (typeof d.startViewTransition !== 'function' || d.startViewTransition.__live) return
  const start = d.startViewTransition
  const wrapped = function (this: any, ...args: any[]) {
    const t = start.apply(this, args)
    lastTransition = t
    return t
  }
  wrapped.__live = true
  d.startViewTransition = wrapped
}

const frame = () => new Promise<void>((r) => {
  // a frame, or 100 ms in a background tab (no frames)
  const t = setTimeout(r, 100)
  requestAnimationFrame(() => { clearTimeout(t); r() })
})

/**
 * Resolves once the DOM shows the app's latest render: its flush is done, a View Transition it
 * started has run its update (the patch), and a frame has passed
 */
async function afterPatch(app: any) {
  await null // run() has returned
  await app?.__runtime?.flushed?.()
  const t = lastTransition
  if (t?.updateCallbackDone) await Promise.race([t.updateCallbackDone.catch(() => {}), new Promise((r) => setTimeout(r, 1000))])
  await frame()
}

/** Sygnal's placeholder for an unhandled error, in the demo or in a portal target outside the panels */
function hasErrorPlaceholder(mount: Element) {
  if (mount.querySelector('[data-sygnal-error]')) return true
  for (const el of document.querySelectorAll('[data-sygnal-error]')) if (!el.closest('.sygnal-live')) return true
  return false
}

// ---- running a demo ----------------------------------------------------------------------

async function runPanel(p: Panel) {
  const gen = ++p.gen
  clearTimeout(p.timer)
  if (!p.app) setState(p, 'loading')
  const edited = p.code !== p.original || !p.compiled
  try {
    const [Sygnal, jsx] = await Promise.all([load('sygnal'), load('sygnal/jsx-runtime')])
    // the build compiled the original code and the live-files: the compiler only for an edit
    const compileFn = edited || [...files.values()].some((f) => !f.compiled) ? (await getCompiler()).compile : undefined
    if (gen !== p.gen) return
    const compileModule = (key: string): Compiled => {
      const f = files.get(key)!
      return f.compiled || (f.compiled = compileFn!(f.code, { lang: f.lang, filename: key.slice(1), component: false }))
    }

    // the example and the modules it imports (transitively)
    const entry: Compiled = edited
      ? compileFn!(p.code, { lang: p.lang, filename: `${p.name}.${ext(p.lang)}`, component: p.component || 'auto', sourceMaps: true })
      : p.compiled!
    const compiled = new Map<string, Compiled>([[ENTRY, entry]])
    const bare = new Set<string>()
    const links = new Map<string, Map<string, string>>()
    const visit = (from: string, c: Compiled, into = bare) => {
      const map = new Map<string, string>()
      links.set(from, map)
      for (const spec of c.requires) {
        if (!isRelative(spec)) { into.add(spec); continue }
        const key = resolveFile(spec, from)
        map.set(spec, key)
        if (!compiled.has(key)) {
          const fc = compileModule(key)
          compiled.set(key, fc)
          visit(key, fc, into)
        }
      }
    }
    visit(ENTRY, entry)
    // the demo server block, a module like a live-file (one fresh instance per run)
    if (p.server && !compiled.has(p.server)) {
      const sc = compileModule(p.server)
      compiled.set(p.server, sc)
      visit(p.server, sc)
    }
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
      // import('spec'): a Promise of the namespace, through the same resolver. A string-literal
      // specifier was loaded up front; a computed one is resolved here
      const dynImport = async (spec: string) => {
        spec = String(spec)
        await null
        if (!isRelative(spec)) return loaded.get(spec) ?? load(spec)
        let target = map.get(spec)
        if (!target) {
          target = resolveFile(spec, key)
          map.set(spec, target)
          if (!compiled.has(target)) {
            const f = files.get(target)!
            if (!f.compiled) f.compiled = (await getCompiler()).compile(f.code, { lang: f.lang, filename: target.slice(1), component: false })
            const fc = compileModule(target)
            compiled.set(target, fc)
            const more = new Set<string>()
            visit(target, fc, more)
            await Promise.all([...more].map(async (s) => loaded.set(s, await load(s))))
          }
        }
        const ns = evaluate(target)
        return ns && ns.__esModule ? ns : { ...ns, default: ns, __esModule: true }
      }
      const set = key === ENTRY ? (name: string, get: () => any) => { picked = { name, get } } : () => {}
      const source = `${compiled.get(key)!.code}\n//# sourceURL=live/${p.id}${key === ENTRY ? '/' + p.name : key}`
      // eslint-disable-next-line no-new-func
      new Function('require', 'module', 'exports', '__h', '__Fragment', '__liveSet', '__liveImport', source)(req, module, module.exports, h, Fragment, set, dynImport)
      return module.exports
    }
    const exports = evaluate(ENTRY)
    const server = p.server ? evaluate(p.server) : undefined
    const { fetch: _ignored, ...httpOptions } = (server && server.options) || {}

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
    clearMessages(p)
    const mount = document.createElement('div')
    mount.className = 'live-mount'
    p.mount ? p.mount.replaceWith(mount) : p.result.replaceChildren(mount)
    p.mount = mount
    p.result.setAttribute('aria-label', `Result: ${name}`)
    setState(p, 'running')

    // this app's callbacks act while it is the panel's app (a later failed run keeps it)
    const token = {}
    const current = () => p.token === token
    let app: any
    const demoFetch = makeDemoFetch(server ? server.default : undefined, {
      note: (text, kind) => { if (current()) addNote(p, text, kind) },
      pending: (d) => { p.pending += d; p.el.dataset.livePending = String(p.pending) },
    })
    p.token = token
    app = Sygnal.run(Component, defaultDrivers(Sygnal, mount, Sygnal.makeFetchDriver({ ...httpOptions, fetch: demoFetch })), {
      mountPoint: mount,
      uid: p.id,
      onError: (e: any, info: any) => {
        if (!current()) return
        // A view error (or a child that failed to instantiate) that a component's own .onError
        // handled is not a failure: run()'s hook is called for it too (the error-boundaries page
        // teaches that). Unhandled, Sygnal renders its placeholder <div data-sygnal-error>: look
        // once the DOM shows the render (after a View Transition's update, too)
        if (info && (info.phase === 'view' || info.phase === 'instantiate')) {
          p.el.dataset.liveChecking = String(Number(p.el.dataset.liveChecking || 0) + 1)
          afterPatch(app).then(() => {
            p.el.dataset.liveChecking = String(Number(p.el.dataset.liveChecking) - 1)
            if (!current()) return
            if (hasErrorPlaceholder(mount)) showError(p, e, info)
            else addNote(p, `Reported to run({ onError }): ${e instanceof Error ? e.message : String(e)}${where(info)}`, 'handled-error')
          })
        } else showError(p, e, info)
      },
    })
    if (current()) p.app = app
    else try { app.dispose() } catch { /* a newer run took over */ }
  } catch (err) {
    if (gen !== p.gen) return
    showError(p, err, undefined, !!p.app)
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
    // a failed load (a network error) is tried again on the next click
    p.editorLoading.catch(() => { p.editorLoading = undefined })
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

function setup(el: HTMLElement, server?: string): Panel {
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

  const noteEl = document.createElement('div')
  noteEl.className = 'live-note'
  noteEl.setAttribute('role', 'status')
  noteEl.hidden = true

  el.replaceChildren(bar, editorBox, result, noteEl, errorEl)
  el.dataset.livePending = '0'
  const p: Panel = {
    el, id, lang: el.dataset.lang || 'jsx', original: code, compiled: decodeJSON(el.dataset.compiled), code, component, server,
    name: guess, gen: 0, pending: 0, result, errorEl, noteEl, editorBox, editBtn, runBtn, resetBtn,
  }
  setState(p, 'idle')

  // the Expressive Code block this panel follows (its frame, with or without a title)
  const prev = el.previousElementSibling
  const staticCode = prev && prev.matches('.expressive-code, pre') ? prev : null

  editBtn.addEventListener('click', async () => {
    const open = editorBox.hidden
    editorBox.hidden = !open
    runBtn.hidden = !open
    resetBtn.hidden = !open
    editBtn.textContent = open ? 'Hide code' : 'Edit'
    editBtn.setAttribute('aria-expanded', String(open))
    // the editor takes the place of the static code block above the panel (still in the DOM
    // for no-JS and search)
    staticCode?.classList.toggle('sygnal-live-code-hidden', open)
    if (open) {
      try {
        await openEditor(p)
        p.editor.focus()
      } catch (e) {
        showError(p, e, undefined, !!p.app)
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
  trackViewTransitions()

  for (const f of document.querySelectorAll<HTMLElement>('.sygnal-live-file')) {
    files.set(fileKey(f.dataset.liveFile || ''), { code: decode(f.dataset.code), lang: f.dataset.lang || 'js', compiled: decodeJSON(f.dataset.compiled) })
  }
  // the page's `css live` blocks, limited to the panels by the build
  const css = [...document.querySelectorAll<HTMLElement>('.sygnal-live-css')].map((c) => decode(c.dataset.code))
  if (css.length) {
    const style = document.createElement('style')
    style.dataset.sygnalLive = ''
    style.textContent = css.join('\n')
    document.head.append(style)
  }

  // a live-server block serves the panels after it, until the next one
  let server: string | undefined
  let n = 0
  const panels = [...document.querySelectorAll<HTMLElement>('.sygnal-live, .sygnal-live-server')].map((el) => {
    if (el.classList.contains('sygnal-live-server')) {
      server = `/__demo-server-${n++}`
      files.set(server, { code: decode(el.dataset.code), lang: el.dataset.lang || 'js', compiled: decodeJSON(el.dataset.compiled) })
      return null
    }
    try {
      return setup(el, server)
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
