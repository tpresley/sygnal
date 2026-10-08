/**
 * remark-live: live, editable examples on the docs site.
 *
 * Authoring (in any docs page, .md or .mdx), add a word to the fence's meta:
 *
 *   ```jsx live                 run this block; a Result panel appears under it
 *   ```jsx live=Profile         mount the component `Profile` (default: the `export default`,
 *                               else the last top-level capitalized function declaration)
 *   ```js live-file=./Chart.js  don't run this block: it is the module `./Chart.js`, which the
 *                               page's `live` blocks can import (`import { X } from './Chart.js'`)
 *   ```jsx live live-height=320 a minimum height (px) for the Result panel
 *   ```css live                 a stylesheet for the page's demos (added to the page as is)
 *
 * The languages are js, jsx, ts, tsx (and css for stylesheets). What the reader sees is what
 * runs: there is no hidden setup code, so a sample that needs more lines to run shows them.
 * A demo can import `sygnal`, its subpaths and the libraries in `docs/src/live/modules.ts`
 * (add a library there and to docs/package.json); `import('./x.js')` and `import('lib')` go
 * through the same resolver (a live-file or a listed module), so `lazy()` works.
 *
 * Each demo runs as `run(Component, drivers, { mountPoint, uid })`, with the default drivers
 * plus these local ones, under the names the docs use (no main.js needed in the sample):
 *   TIMER: makeTimerDriver()      timers static, Tooltip delays, Toaster timeouts
 *   BROWSER: makeBrowserDriver()  the browser static and BROWSER commands
 *   DND: makeDragDriver()         drag and drop
 * Not included (they need a server or change the page): HTTP, WS, SW, HEAD, the router.
 * An error a component's own .onError handled is shown as a quiet note ("Reported to
 * run({ onError }): ..."), not as a failure; any other error marks the demo as failed.
 *
 * The meta words are removed before
 * Expressive Code renders the block, so its frames and titles are unchanged.
 *
 * The client side is `docs/src/live/` (loaded only on pages with a live block, by the
 * MarkdownContent override in `docs/src/components/`). `npm --prefix docs run check-live`
 * opens every page with a demo in Playwright after a build.
 *
 * Output, after the code block:
 *   <div class="sygnal-live not-content" data-live-id="live-N" data-lang="jsx"
 *        data-code="<encodeURIComponent(code)>" [data-component="Name"] [data-height="320"]></div>
 *   <div class="sygnal-live-file" hidden data-live-file="./Chart.js" data-lang data-code></div>
 *   <div class="sygnal-live-css" hidden data-code></div>
 */

const RUNNABLE = new Set(['js', 'jsx', 'ts', 'tsx', 'javascript', 'typescript', 'css'])

/** the live options of a fence's meta, and the meta without them */
export function parseLiveMeta(meta) {
  const opts = {}
  const rest = []
  // tokens are separated by spaces outside quotes (an Expressive Code title="a live demo" stays whole)
  for (const tok of (meta || '').match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []) {
    let m
    if (tok === 'live') opts.live = true
    else if ((m = tok.match(/^live=([A-Za-z_$][\w$]*)$/))) { opts.live = true; opts.component = m[1] }
    else if ((m = tok.match(/^live-file=(\S+)$/))) opts.file = m[1]
    else if ((m = tok.match(/^live-height=(\d+)$/))) opts.height = m[1]
    else if (/^live(=|-)/.test(tok)) throw new Error(`remark-live: unknown or malformed live option '${tok}'`)
    else rest.push(tok)
  }
  return { opts, meta: rest.join(' ') }
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

export default function remarkLive() {
  return (tree, file) => {
    const mdx = /\.mdx$/.test(file?.path || '')
    let n = 0
    const where = (node) => `${file?.path || 'a docs page'}:${node.position?.start?.line ?? '?'}`
    const walk = (parent) => {
      if (!parent.children) return
      for (let i = 0; i < parent.children.length; i++) {
        const node = parent.children[i]
        if (node.type !== 'code') { walk(node); continue }
        if (!node.meta || !/(^|\s)live/.test(node.meta)) continue
        let parsed
        try { parsed = parseLiveMeta(node.meta) } catch (e) { throw new Error(`${e.message} (${where(node)})`) }
        const { opts, meta } = parsed
        if (!opts.live && !opts.file) continue
        const lang = (node.lang || '').toLowerCase()
        if (!RUNNABLE.has(lang)) throw new Error(`remark-live: a live block must be js, jsx, ts, tsx or css, not '${node.lang}' (${where(node)})`)
        if (opts.live && opts.file) throw new Error(`remark-live: a block is either live or a live-file, not both (${where(node)})`)
        node.meta = meta || null
        const code = encodeURIComponent(node.value)
        let out
        if (lang === 'css') {
          if (opts.file) throw new Error(`remark-live: a css block takes 'live', not live-file (${where(node)})`)
          out = makeNode(mdx, { class: 'sygnal-live-css', hidden: true, 'data-code': code })
        } else if (opts.file) {
          out = makeNode(mdx, { class: 'sygnal-live-file', hidden: true, 'data-live-file': opts.file, 'data-lang': lang, 'data-code': code })
        } else {
          out = makeNode(mdx, {
            class: 'sygnal-live not-content',
            'data-live-id': `live-${n++}`,
            'data-lang': lang,
            'data-code': code,
            'data-component': opts.component,
            'data-height': opts.height,
          })
        }
        parent.children.splice(i + 1, 0, out)
        i++
      }
    }
    walk(tree)
  }
}
