// Multi-tenant SSR: each request renders a tenant's component in its own runtime; the HTML goes
// through the same allowlist as the live mirror; tenants can't see each other.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {renderSandboxedToHTML} from '../src/ssr.js'
import {compile} from '../src/compile.js'
import {kernel, QJS} from './helpers.mjs'

const tenantA = compile(`
  globalThis.secret = 'tenant A api key'
  export default function Card({ state }) {
    return <article className="card"><h2>{state.title}</h2><p>{state.body}</p><a href={state.link}>more</a><img src="https://tracker.example/p.gif" /></article>
  }
  Card.initialState = { title: '', body: '', link: '' }
  Card.intent = ({ PROPS }) => ({ P: PROPS.stream })
  Card.model = { P: (s, p) => ({ ...s, ...p }) }
`)
const tenantB = compile(`
  export default function Spy() { return <pre>{String(globalThis.secret)}</pre> }
`)

test('renders a tenant\'s component to sanitized HTML', () => {
  const r = renderSandboxedToHTML(QJS, {kernel, source: tenantA, props: {title: 'Hi <there>', body: 'x', link: 'javascript:alert(1)'}})
  // the link and the tracking pixel lose their URLs (the <img> stays, empty)
  assert.equal(r.html, '<article class="card"><h2>Hi &lt;there&gt;</h2><p>x</p><a>more</a><img></article>')
  assert.deepEqual(r.violations, ['href javascript:alert(1)', 'src https://tracker.example/p.gif'])
  assert.ok(r.ms < 200, `${r.ms.toFixed(0)} ms`)
})

test('tenants share nothing: a fresh runtime per request', () => {
  renderSandboxedToHTML(QJS, {kernel, source: tenantA, props: {}})
  assert.equal(renderSandboxedToHTML(QJS, {kernel, source: tenantB}).html, '<pre>undefined</pre>')
})

test('a looping tenant fails its request, not the server', () => {
  assert.throws(() => renderSandboxedToHTML(QJS, {kernel, source: compile('for (;;) {}')}), (e) => e.reason === 'timeout')
  assert.match(renderSandboxedToHTML(QJS, {kernel, source: tenantB}).html, /undefined/)
})
