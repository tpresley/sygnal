// @vitest-environment jsdom
// llms-context A/B, task 30: form(schema, { request }) added `progress: 'form.PROGRESS'` to every
// submit, and a progress request goes over XMLHttpRequest, so a JSON submit never reached a
// stubbed globalThis.fetch (a test's fake server, MSW on fetch). Now only a multipart submit (or
// `progress: true` on the request) reports progress; a JSON submit stays on fetch.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { z } from 'zod'
import { run, form, makeFetchDriver } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

let app
afterEach(() => { app?.dispose(); app = null; vi.unstubAllGlobals(); document.body.innerHTML = '' })

const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms))
async function until(pred, ms = 2000) {
  const end = Date.now() + ms
  while (!pred()) { if (Date.now() > end) throw new Error('timeout'); await wait(5) }
}

const schema = z.object({ title: z.string().trim().min(1), photo: z.instanceof(File).nullable() })
function start(request) {
  const App = ({ state }) => h('form', { className: 'f' },
    h('input', { attrs: { name: 'title' }, props: { value: state.form.fields.title.value } }),
    h('button', { attrs: { type: 'submit' } }, 'Save'),
    h('p', { className: 'done' }, state.saved || ''))
  App.initialState = { saved: '' }
  App.uses = { form: form(schema, { values: { title: '', photo: null }, request }) }
  App.model = { 'form.DONE': (s, body) => ({ ...s, saved: body.id }) }
  const root = document.createElement('div'); root.id = 'root'; document.body.appendChild(root)
  app = run(App, { HTTP: makeFetchDriver() }, { mountPoint: '#root' })
  return root
}
async function fillAndSubmit(root) {
  await until(() => root.querySelector('[name="title"]'))
  const input = root.querySelector('[name="title"]')
  input.value = 'Hello'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await wait()
  root.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

/** an XMLHttpRequest class that records each send and answers 201 */
function fakeXHR(sent) {
  return class {
    constructor() { this.upload = {}; this.headers = {}; this.status = 0; this.readyState = 0 }
    open(method, url) { this.method = method; this.url = url }
    setRequestHeader(k, v) { this.headers[k] = v }
    getAllResponseHeaders() { return 'content-type: application/json\r\n' }
    abort() {}
    send(body) {
      sent.push({ method: this.method, url: this.url, body })
      setTimeout(() => {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 })
        this.status = 201; this.readyState = 4; this.responseText = this.response = '{"id":"P-1"}'
        this.onload?.()
      }, 5)
    }
  }
}

describe('form request transport', () => {
  it('a JSON submit goes through globalThis.fetch, not XMLHttpRequest', async () => {
    const fetches = []
    const xhrs = []
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      fetches.push({ url: String(url), method: init?.method, body: init?.body })
      return new Response('{"id":"A-1"}', { status: 201, headers: { 'Content-Type': 'application/json' } })
    }))
    vi.stubGlobal('XMLHttpRequest', fakeXHR(xhrs))
    const root = start({ url: '/api/items' })
    await fillAndSubmit(root)
    await until(() => root.querySelector('.done').textContent === 'A-1')
    expect(fetches).toEqual([{ url: '/api/items', method: 'POST', body: JSON.stringify({ title: 'Hello', photo: null }) }])
    expect(xhrs).toEqual([])
  })

  it('progress: true on the request still reports progress for a JSON submit', async () => {
    const xhrs = []
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fetch is not used for a progress request') }))
    vi.stubGlobal('XMLHttpRequest', fakeXHR(xhrs))
    const root = start({ url: '/api/items', progress: true })
    await fillAndSubmit(root)
    await until(() => root.querySelector('.done').textContent === 'P-1')
    expect(xhrs).toHaveLength(1)
  })
})
