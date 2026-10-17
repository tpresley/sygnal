// Unit tests for the app graph panel's plain logic (PLAN-10 E-2, graphCore.ts) and the page it
// shows: plain Node (node --test), no VS Code. The page comes from the repository's sygnal-check,
// which the build copies into server/sygnal-check.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {
  columnFor, componentKeyAt, idLine, makeNonce, pageMeta, panelTitle, readPageMessage, relativeInRoot, resolveInRoot,
  type InspectGraph,
} from '../../src/graphCore.ts'
// @ts-expect-error: plain JavaScript without types
import { graphHtml } from '../../../../sygnal-check/src/graphView/html.js'
// @ts-expect-error: plain JavaScript without types
import { linkTarget } from '../../../../sygnal-check/src/graphView/vscodeHost.js'

const comp = (name: string, file: string, line: number, extra: Record<string, unknown> = {}) => ({ name, id: `${file}:${line}`, key: `${file}#${name}`, file, kind: 'child', ...extra })
const graph: InspectGraph = {
  version: 1,
  components: [
    comp('Cart', 'src/Cart.jsx', 4, {
      actions: [{ name: 'CHECKOUT', line: 16, column: 3, modelAt: { line: 20, column: 3 } }],
      selectors: [{ selector: '.checkout', line: 16, column: 23 }],
      eventSites: [{ type: 'NAVIGATE', role: 'emit', line: 20, column: 29 }],
    }),
    comp('Total', 'src/Cart.jsx', 30),
    comp('App', 'src/App.jsx', 7, { children: [{ name: 'Cart', line: 12, column: 9, file: 'src/other.jsx' }] }),
    { name: 'Ghost', id: 'src/Cart.jsx:40', key: 'src/Cart.jsx#Ghost', file: 'src/Cart.jsx', ghost: true },
  ],
}

test('idLine', () => {
  assert.equal(idLine('src/Cart.jsx:4'), 4)
  assert.equal(idLine('C:/x/Cart.jsx:12'), 12)
  assert.equal(idLine('nothing'), null)
})

test('componentKeyAt: from a component to the next one in the file', () => {
  assert.equal(componentKeyAt(graph, 'src/Cart.jsx', 1), null) // the imports
  assert.equal(componentKeyAt(graph, 'src/Cart.jsx', 4), 'src/Cart.jsx#Cart')
  assert.equal(componentKeyAt(graph, 'src/Cart.jsx', 20), 'src/Cart.jsx#Cart') // its statics
  assert.equal(componentKeyAt(graph, 'src/Cart.jsx', 30), 'src/Cart.jsx#Total')
  assert.equal(componentKeyAt(graph, 'src/Cart.jsx', 45), 'src/Cart.jsx#Total') // a ghost is no component of the file
  assert.equal(componentKeyAt(graph, 'src/App.jsx', 9), 'src/App.jsx#App')
  assert.equal(componentKeyAt(graph, 'src/None.jsx', 9), null)
  assert.equal(componentKeyAt(null, 'src/App.jsx', 9), null)
})

test('columnFor: the first graph location on the line', () => {
  assert.equal(columnFor(graph, 'src/Cart.jsx', 16), 3)
  assert.equal(columnFor(graph, 'src/Cart.jsx', 20), 3) // modelAt before the emit at 29
  assert.equal(columnFor(graph, 'src/other.jsx', 12), 9) // a location with its own file
  assert.equal(columnFor(graph, 'src/App.jsx', 12), 1)
  assert.equal(columnFor(graph, 'src/Cart.jsx', 4), 1) // components have no column
  assert.equal(columnFor(null, 'src/Cart.jsx', 16), 1)
})

test('resolveInRoot / relativeInRoot stay inside the root', () => {
  const root = path.resolve('/w/app')
  assert.equal(resolveInRoot(root, 'src/Cart.jsx'), path.join(root, 'src/Cart.jsx'))
  assert.equal(resolveInRoot(root, '../other/x.jsx'), null)
  assert.equal(resolveInRoot(root, 'src/../../x.jsx'), null)
  assert.equal(resolveInRoot(root, path.resolve('/etc/passwd')), null)
  assert.equal(resolveInRoot(root, ''), null)
  assert.equal(relativeInRoot(root, path.join(root, 'src', 'Cart.jsx')), 'src/Cart.jsx')
  assert.equal(relativeInRoot(root, path.resolve('/w/app-2/src/x.jsx')), null)
  assert.equal(relativeInRoot(root, root), null)
})

test('readPageMessage accepts only the adapter messages', () => {
  assert.deepEqual(readPageMessage({ type: 'ready', version: 2 }), { type: 'ready', version: 2 })
  assert.deepEqual(readPageMessage({ type: 'ready' }), { type: 'ready', version: null })
  assert.deepEqual(readPageMessage({ type: 'open', file: 'src/a.jsx', line: 3 }), { type: 'open', file: 'src/a.jsx', line: 3 })
  assert.equal(readPageMessage({ type: 'open', file: 'src/a.jsx', line: 0 }), null)
  assert.equal(readPageMessage({ type: 'open', file: 7, line: 3 }), null)
  assert.deepEqual(readPageMessage({ type: 'applied', version: 3, components: 9 }), { type: 'applied', version: 3, components: 9 })
  assert.deepEqual(readPageMessage({ type: 'revealed', key: 'k', selected: 'k' }), { type: 'revealed', key: 'k', selected: 'k' })
  assert.equal(readPageMessage({ type: 'eval', code: 'x' }), null)
  assert.equal(readPageMessage('ready'), null)
  assert.equal(readPageMessage(null), null)
})

test('the page for the panel: nonce CSP, the adapter, links that come back as files of the root', () => {
  const root = path.resolve('/w/my app')
  const nonce = makeNonce()
  assert.match(nonce, /^[A-Za-z0-9+/=]{24}$/)
  assert.notEqual(nonce, makeNonce())
  const meta = pageMeta(root, 'file:///w/my%20app', 1, nonce)
  assert.equal(panelTitle(root), 'App graph: my app')
  const html: string = graphHtml(graph, meta)
  assert.ok(html.includes(`script-src 'nonce-${nonce}'`))
  assert.ok(html.includes(`<script nonce="${nonce}">`))
  assert.ok(html.includes('V.mountVscode('))
  // the page's link for a file, as page.js makes it, reads back to the file
  const abs = meta.root + '/src/Cart.jsx'
  const href = `vscode://file${abs.startsWith('/') ? '' : '/'}${encodeURI(abs)}:16`
  assert.deepEqual(linkTarget(href, meta.root), { file: 'src/Cart.jsx', line: 16 })
  assert.equal(resolveInRoot(root, 'src/Cart.jsx'), path.join(root, 'src/Cart.jsx'))
})
