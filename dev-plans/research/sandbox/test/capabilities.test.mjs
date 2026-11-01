// What the guest is granted: HTTP through an allowlist (credentials omitted, no redirects, GET
// unless the page allows more), EVENTS to the page (JSON only), PROPS from it. Nothing else.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mount, settle} from './helpers.mjs'

test('fetch: allowlisted prefix only; lookalike hosts, other methods and userinfo are denied', async () => {
  const calls = []
  const impl = async (url, init) => { calls.push({url, credentials: init.credentials, redirect: init.redirect, method: init.method}); return new Response('{"n":1}', {headers: {'content-type': 'application/json'}}) }
  const t = mount(`
    export default function F({ state }) { return <pre className="out">{state.log.join('\\n')}</pre> }
    F.initialState = { log: [] }
    F.model = {
      BOOTSTRAP: { HTTP: () => ({ url: 'https://api.example.com/v1/a', ok: 'OK', error: 'NO' }) },
      OK: { STATE: (s, d) => ({ log: [...s.log, 'ok ' + d.n] }), HTTP: () => ({ url: 'https://api.example.com.evil.example/v1/a', error: 'NO' }) },
      NO: (s, e) => ({ log: [...s.log, e.error.message] }),
    }
  `, {capabilities: {fetch: {allow: ['https://api.example.com/v1/'], impl}}})
  await settle(30)
  // a guest can also call the capability directly, bypassing the kernel: the host's check is the one that counts
  const direct = mount(`
    const out = []
    for (const [u, m] of [['https://api.example.com/v1/x', 'DELETE'], ['https://user:pw@api.example.com/v1/x', 'GET'], ['http://api.example.com/v1/x', 'GET'], ['https://api.example.com/v1/../admin', 'GET']])
      __host.fetch(100 + out.length, u, JSON.stringify({ method: m })), out.push(u)
    export default function D() { return <p>x</p> }
  `, {capabilities: {fetch: {allow: ['https://api.example.com/v1/'], impl}}})
  await settle(30)
  assert.deepEqual(calls, [{url: 'https://api.example.com/v1/a', credentials: 'omit', redirect: 'error', method: 'GET'}])
  const log = t.$('.out').textContent
  assert.match(log, /^ok 1\nsandbox fetch denied: https:\/\/api.example.com.evil.example\/v1\/a is not allowed$/)
  assert.deepEqual(direct.errors, [])
})

test('EVENTS: JSON only, delivered after the guest call returns', () => {
  const t = mount(`
    export default function E() { return <button className="b">b</button> }
    E.intent = ({ DOM }) => ({ GO: DOM.select('.b').events('click') })
    E.model = { GO: { EVENTS: () => ({ type: 'FN', data: { f: () => 1, d: new Date(0), n: NaN } }) } }
  `)
  t.fire('.b', 'click')
  assert.deepEqual(t.emits, [{type: 'FN', data: {d: '1970-01-01T00:00:00.000Z', n: null}}])
})
