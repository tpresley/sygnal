/**
 * remark-live: live, editable examples on the docs site.
 *
 * Authoring (in any docs page, .md or .mdx), add a word to the fence's meta:
 *
 *   ```jsx live                 run this block; a Result panel appears under it
 *   ```jsx live=Profile         mount the component `Profile` (default: the `export default`,
 *                               else the last top-level capitalized function declaration)
 *   ```js live-file=./Chart.js  don't run this block: it is the module `./Chart.js`, which the
 *                               page's live blocks can import (`import { X } from './Chart.js'`);
 *                               one block per path on a page
 *   ```jsx live live-height=320 a minimum height (px) for the Result panel
 *   ```jsx live live-expect=404 the demo shows a request with no demo route on purpose (404),
 *                               `throw` a demo-server handler that throws (500), or both
 *                               (`live-expect=404,throw`); otherwise check-live fails on them
 *   ```css live                 a stylesheet for the page's demos, limited to the panels at
 *                               build time: `.card` becomes `:where(.sygnal-live) .card` (same
 *                               specificity); a bare :root / html / body is the panel; @media,
 *                               @supports and @layer nest; @keyframes, @font-face and the
 *                               document's ::view-transition-* pseudo-elements stay global
 *   ```js live-server           the demo HTTP server of the live blocks after it (see below)
 *
 * The languages are js, jsx, ts, tsx (and css for stylesheets). What the reader sees is what
 * runs: there is no hidden setup code, so a sample that needs more lines to run shows them.
 *
 * Build time: every js/ts block is compiled here (src/live/compile.mjs, the compiler the
 * browser uses for edited code), so a page loads Babel only when a reader runs edited code. The
 * build fails, with the file and line, on a block that doesn't compile, a relative import no
 * live-file on the page provides, an import of a module that isn't in src/live/modules.ts, a
 * duplicate live-file path, top-level await or import.meta.
 *
 * Modules: a demo can import `sygnal`, its subpaths and the libraries in src/live/modules.ts
 * (add a library there and to docs/package.json, at an exact version); `import('./x.js')` and
 * `import('lib')` go through the same resolver, so `lazy()` works. Live code must be idempotent
 * at module level: a library module is loaded once per page and shared by every demo and every
 * re-run (an edit, Reset), so module-level side effects on it run again on the same instance
 * (`customElements.define` of the same tag throws; `Chart.register` is fine). The live-files
 * and the demo server are evaluated anew on each run.
 *
 * Drivers: each demo runs as `run(Component, drivers, { mountPoint, uid, onError })` with
 * run()'s defaults plus, under the names the docs use (no main.js needed in the sample):
 *   TIMER: makeTimerDriver()       timers static, Tooltip delays, Toaster timeouts
 *   BROWSER: makeBrowserDriver()   the browser static and BROWSER commands
 *   DND: makeDragDriver()          drag and drop
 *   HTTP: makeFetchDriver({ fetch: demoFetch, ...options })  Sygnal's real fetch driver over a
 *                                  stubbed network (src/live/server.ts): categories,
 *                                  latest/abort, resources and the query cache are the driver's
 *   DOM: makeViewTransitionDOMDriver(mountPoint)  run()'s DOM driver plus the hook for the
 *                                  `viewTransitions` static: a listed action's patch runs in
 *                                  document.startViewTransition() (Chromium 111+, Safari 18+,
 *                                  Firefox 144+); without the API or with prefers-reduced-motion
 *                                  it patches at once, and without the static it is run()'s own
 * Not included (they need a real server or change the page): WS, SW, HEAD, the router.
 *
 * The demo server is a visible block, ```js live-server (its frame is titled "Demo server"
 * unless it has a title). Its default export is a route table:
 *
 *   export default {
 *     'POST /api/signup': ({ json }) => json.email === 'taken@example.com'
 *       ? { status: 409, json: { email: 'Already registered' } } : { status: 201, json: { id: 1 } },
 *     'GET /api/quotes/:id': ({ params }) => ({ json: { id: params.id, text: '…' } }),
 *   }
 *
 * A key is 'METHOD /path' ('/path' alone: any method; ':name' segments are params, a last '*'
 * the rest). A handler gets { method, url, path, params, query, json, body, headers } and
 * returns { status = 200, json | text, headers, delayMs = 600 } or a Promise of it (a handler
 * that throws: 500). Handlers may keep state in module scope (one fresh instance per demo run).
 * An optional `export const options = { cache: queryCache() }` is merged into
 * makeFetchDriver's options (everything but `fetch`). A server block serves every live block
 * after it on the page, until the next live-server block replaces it. Without one, or with no
 * matching route, a request gets a 404 (the driver's error path). Each request is a quiet note
 * in the panel: "Demo server: POST /api/signup → 201 (600 ms)", "→ 404 (no demo route, 600 ms)",
 * "→ aborted (120 ms)" (an aborted request rejects with an AbortError, as fetch does).
 *
 * Errors: an error a component's own .onError handled is a quiet note ("Reported to
 * run({ onError }): ..."), not a failure; any other error shows in the panel's error area. A
 * stylesheet a demo imports from the module map is added to the page when the demo loads; Web
 * Awesome's theme is scoped to the demo area (its :root rules apply to `.sygnal-live
 * .live-result`) and follows the docs theme (.wa-dark / .wa-light on the panels).
 *
 * The meta words are removed before Expressive Code renders the block, so its frames and titles
 * are unchanged. The client side is src/live/ (loaded only on pages with a live block, by the
 * MarkdownContent override in src/components/). After a docs change, build and run
 * `node docs/scripts/check-live.mjs` with BROWSER=chromium, firefox and webkit: it opens every
 * demo and fails on an error, an empty render, a console error, a request with no demo route or
 * a throwing handler (unless live-expect), or a request still pending.
 *
 * Output, after the code block (data: encodeURIComponent of the text / JSON):
 *   <div class="sygnal-live not-content" data-live-id="live-N" data-lang="jsx" data-code
 *        data-compiled="{code, requires}" [data-component] [data-height] [data-expect]></div>
 *   <div class="sygnal-live-file" hidden data-live-file="./Chart.js" data-lang data-code data-compiled></div>
 *   <div class="sygnal-live-css" hidden data-code="<the scoped css>"></div>
 *   <div class="sygnal-live-server" hidden data-lang data-code data-compiled></div>
 */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { compile, fileKey, isRelative, resolveLiveFile } from '../live/compile.mjs'

const RUNNABLE = new Set(['js', 'jsx', 'ts', 'tsx', 'javascript', 'typescript', 'css'])
const EXPECTS = new Set(['404', 'throw'])

/** the specifiers a live example can import: the keys of src/live/modules.ts */
let moduleKeys
const MODULE_KEYS = () => moduleKeys ||= new Set(
  [...fs.readFileSync(fileURLToPath(new URL('../live/modules.ts', import.meta.url)), 'utf8').matchAll(/^\s*'([^']+)':\s*\(\)\s*=>/gm)].map((m) => m[1]),
)

/** the live options of a fence's meta, and the meta without them */
export function parseLiveMeta(meta) {
  const opts = {}
  const rest = []
  // tokens are separated by spaces outside quotes (an Expressive Code title="a live demo" stays whole)
  for (const tok of (meta || '').match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []) {
    let m
    if (tok === 'live') opts.live = true
    else if (tok === 'live-server') opts.server = true
    else if ((m = tok.match(/^live=([A-Za-z_$][\w$]*)$/))) { opts.live = true; opts.component = m[1] }
    else if ((m = tok.match(/^live-file=(\S+)$/))) opts.file = m[1]
    else if ((m = tok.match(/^live-height=(\d+)$/))) opts.height = m[1]
    else if ((m = tok.match(/^live-expect=([\w,]+)$/)) && m[1].split(',').every((x) => EXPECTS.has(x))) opts.expect = m[1]
    else if (/^live(=|-)/.test(tok)) throw new Error(`remark-live: unknown or malformed live option '${tok}'`)
    else rest.push(tok)
  }
  return { opts, meta: rest.join(' ') }
}

const PANEL = ':where(.sygnal-live)'

/**
 * A selector of a `css live` block, limited to the demo panels without changing its
 * specificity: `.card` -> `:where(.sygnal-live) .card`. A bare `:root` / `html` / `body` is the
 * panel (`body .x` -> `:where(.sygnal-live) .x`); one with qualifiers (`html[data-theme=dark]`)
 * stays, and the panel goes after it. The document's own pseudo-elements
 * (`::view-transition-*`) are left alone.
 */
export function scopeSelector(selector) {
  const s = selector.trim()
  if (/^(:root|html)?::view-transition/.test(s)) return s
  const m = s.match(/^(:root|html|body)((?:[.#[:][^\s>+~]*)?)(?:\s*([>+~])\s*|\s+|$)(.*)$/s)
  if (m) {
    const [, el, quals, comb, rest] = m
    if (!quals && el !== 'body' && /^body\b/.test(rest)) return scopeSelector(rest) // html > body .x
    const tail = rest ? ` ${comb ? comb + ' ' : ''}${rest}` : ''
    return quals ? `${el}${quals} ${PANEL}${tail}` : `${PANEL}${tail}`
  }
  return `${PANEL} ${s}`
}

/** a `css live` block's rules, limited to the panels (@media / @supports / @layer nesting kept) */
export function scopeCss(css) {
  const root = postcss.parse(css)
  root.walkRules((rule) => {
    for (let p = rule.parent; p && p.type !== 'root'; p = p.parent) {
      // keyframe selectors (from, 50%) and nested rules (CSS nesting: relative to their parent)
      if (p.type === 'rule' || (p.type === 'atrule' && /keyframes$/i.test(p.name))) return
    }
    rule.selectors = rule.selectors.map(scopeSelector)
  })
  return root.toString()
}

const attr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

function makeNode(mdx, attrs) {
  const entries = Object.entries(attrs).filter(([, v]) => v !== undefined && v !== false)
  if (mdx) {
    return {
      type: 'mdxJsxFlowElement',
      name: 'div',
      attributes: entries.map(([name, value]) => ({ type: 'mdxJsxAttribute', name, value: value === true ? null : String(value) })),
      children: [],
    }
  }
  const html = entries.map(([k, v]) => (v === true ? k : `${k}="${attr(v)}"`)).join(' ')
  return { type: 'html', value: `<div ${html}></div>` }
}

const enc = (v) => encodeURIComponent(typeof v === 'string' ? v : JSON.stringify(v))

export default function remarkLive() {
  return (tree, file) => {
    const mdx = /\.mdx$/.test(file?.path || '')
    const where = (node, line = 0) => `${file?.path || 'a docs page'}:${(node.position?.start?.line ?? 0) + line || '?'}`

    // 1. the page's live blocks, in order
    const blocks = []
    const walk = (parent) => {
      if (!parent.children) return
      for (const node of parent.children) {
        if (node.type !== 'code') { walk(node); continue }
        if (!node.meta || !/(^|\s)live/.test(node.meta)) continue
        let parsed
        try { parsed = parseLiveMeta(node.meta) } catch (e) { throw new Error(`${e.message} (${where(node)})`) }
        const { opts, meta } = parsed
        if (!opts.live && !opts.file && !opts.server) {
          if (opts.expect || opts.height) throw new Error(`remark-live: live-expect and live-height go on a live block (${where(node)})`)
          continue
        }
        const lang = (node.lang || '').toLowerCase()
        if (!RUNNABLE.has(lang)) throw new Error(`remark-live: a live block must be js, jsx, ts, tsx or css, not '${node.lang}' (${where(node)})`)
        if ([opts.live, opts.file, opts.server].filter(Boolean).length > 1) throw new Error(`remark-live: a block is one of live, live-file or live-server (${where(node)})`)
        if (lang === 'css' && (opts.file || opts.server)) throw new Error(`remark-live: a css block takes 'live' only (${where(node)})`)
        if (lang === 'css' && (opts.expect || opts.height || opts.component)) throw new Error(`remark-live: live=Name, live-height and live-expect go on a js/ts live block (${where(node)})`)
        if ((opts.expect || opts.height) && !opts.live) throw new Error(`remark-live: live-expect and live-height go on a live block (${where(node)})`)
        // a server block is labelled in its frame (unless it has a title of its own)
        node.meta = (opts.server && !/(^|\s)title=/.test(meta) ? `${meta} title="Demo server"` : meta).trim() || null
        blocks.push({ node, parent, opts, lang })
      }
    }
    walk(tree)
    if (!blocks.length) return

    // 2. the live-files, by path (one block per path)
    const files = new Map()
    for (const b of blocks) {
      if (!b.opts.file) continue
      b.key = fileKey(b.opts.file)
      if (files.has(b.key)) throw new Error(`remark-live: two live-file blocks for ${b.opts.file} on one page (${where(files.get(b.key).node)} and ${where(b.node)})`)
      files.set(b.key, b)
    }

    // 3. compile every js/ts block (the browser loads Babel only for edited code); a syntax
    // error, an import nothing provides, or a module the docs can't load fails the build
    for (const b of blocks) {
      if (b.lang === 'css') continue
      const kind = b.opts.file ? 'live-file' : b.opts.server ? 'live-server' : 'live'
      try {
        b.compiled = compile(b.node.value, {
          lang: b.lang,
          filename: b.opts.file ? b.key.slice(1) : kind === 'live-server' ? 'demo-server.' + b.lang : 'example.' + b.lang,
          component: b.opts.live ? b.opts.component || 'auto' : false,
        })
      } catch (e) {
        // the fence's line + the line in the block (Babel's loc is 1-based)
        throw new Error(`remark-live: a ${kind} block does not compile (${where(b.node, e.loc?.line ?? 0)}): ${String(e.message).split('\n')[0]}`)
      }
      for (const spec of b.compiled.requires) {
        if (isRelative(spec)) {
          if (!resolveLiveFile(spec, b.key || '/', (k) => files.has(k))) {
            throw new Error(`remark-live: a ${kind} block imports '${spec}', but no live-file block on this page provides it (${where(b.node)})`)
          }
        } else if (!MODULE_KEYS().has(spec)) {
          throw new Error(`remark-live: a ${kind} block imports '${spec}', which live examples can't load: add it to docs/src/live/modules.ts and docs/package.json (${where(b.node)})`)
        }
      }
    }

    // 4. the panel data, after each block
    let n = 0
    for (const b of blocks) {
      let out
      if (b.lang === 'css') {
        let css
        try { css = scopeCss(b.node.value) } catch (e) { throw new Error(`remark-live: a css live block does not parse (${where(b.node, e.line ?? 0)}): ${e.reason || e.message}`) }
        out = makeNode(mdx, { class: 'sygnal-live-css', hidden: true, 'data-code': enc(css) })
      } else if (b.opts.server) {
        out = makeNode(mdx, { class: 'sygnal-live-server', hidden: true, 'data-lang': b.lang, 'data-code': enc(b.node.value), 'data-compiled': enc(b.compiled) })
      } else if (b.opts.file) {
        out = makeNode(mdx, { class: 'sygnal-live-file', hidden: true, 'data-live-file': b.opts.file, 'data-lang': b.lang, 'data-code': enc(b.node.value), 'data-compiled': enc(b.compiled) })
      } else {
        out = makeNode(mdx, {
          class: 'sygnal-live not-content',
          'data-live-id': `live-${n++}`,
          'data-lang': b.lang,
          'data-code': enc(b.node.value),
          'data-compiled': enc(b.compiled),
          'data-component': b.opts.component,
          'data-height': b.opts.height,
          'data-expect': b.opts.expect,
        })
      }
      b.parent.children.splice(b.parent.children.indexOf(b.node) + 1, 0, out)
    }
  }
}
