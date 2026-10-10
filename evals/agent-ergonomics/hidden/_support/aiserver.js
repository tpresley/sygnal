// A fake app server for the PLAN-6 tasks (44-47), shared by both arms' hidden tests:
// hidden/_support/aiserver.js and react/hidden/_support/aiserver.js must stay byte-identical
// (verify.mjs checks). No network: `fetch` is replaced (vi.stubGlobal) by a function whose
// requests stay pending until the test answers them.
//
// - POST /api/chat is an AI SDK 7 route: the test answers with the UI message stream protocol v1
//   (SSE `data: {json}` chunks, header `x-vercel-ai-ui-message-stream: v1`, `data: [DONE]`),
//   chunk by chunk, so a test sees the reply while it streams. An aborted request rejects (and its
//   stream errors) with an AbortError, like a browser's.
// - POST /api/decide is a decision route (the dictionary form of `/v1/systemone`): the test
//   answers with JSON (`answersFor()` builds a reply).
// - fakeModelContext() is a WebMCP `document.modelContext` (registerTool(tool, { signal }),
//   unregisterTool(name)) whose tools the test calls like an agent.
import { vi } from 'vitest'
import { sleep, waitFor, textOf } from './queries.js'

/** The accessible name: aria-labelledby, else aria-label, else the associated <label>s. */
export function accessibleName(el) {
  const by = el.getAttribute('aria-labelledby')
  if (by) return by.trim().split(/\s+/).map((id) => textOf(document.getElementById(id) ?? document.createElement('i'))).join(' ').trim()
  const label = el.getAttribute('aria-label')
  if (label && label.trim()) return label.trim()
  return [...(el.labels ?? [])].map((l) => textOf(l)).join(' ').trim()
}

/** The one input/select/textarea inside `root` whose accessible name starts with `label`. */
export function fieldNamed(label, root = document.body) {
  const re = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
  const found = [...root.querySelectorAll('input, select, textarea')].filter((el) => re.test(accessibleName(el)))
  if (found.length !== 1) throw new Error(`expected one field named "${label}", found ${found.length}`)
  return found[0]
}

/** An element is shown: in the document, and neither it nor an ancestor is `hidden` */
export function shown(el) {
  return !!el && el.isConnected && !el.closest('[hidden]')
}

const urlOf = (arg) => String(arg && typeof arg === 'object' && 'url' in arg ? arg.url : arg)
const pathOf = (arg) => new URL(urlOf(arg), 'http://localhost').pathname
const enc = new TextEncoder()

/** A UI message's text: its text parts joined (or its `content`) */
export function messageText(m) {
  if (!m) return ''
  if (typeof m.content === 'string') return m.content
  return (m.parts || []).filter((p) => p && p.type === 'text').map((p) => p.text).join('')
}

let ids = 0

/** Start a fake server: replaces fetch until the test ends (vi.unstubAllGlobals). */
export function aiServer() {
  const requests = []
  const fn = vi.fn((input, init = {}) => new Promise((resolve, reject) => {
    const fromInput = input && typeof input === 'object' ? input : {}
    const method = String(init.method ?? fromInput.method ?? 'GET').toUpperCase()
    const signal = init.signal ?? fromInput.signal
    const raw = init.body
    let body = null
    try { body = typeof raw === 'string' ? JSON.parse(raw) : raw ?? null } catch { body = raw }
    const req = makeRequest({ method, path: pathOf(input), body, raw, resolve, reject, signal })
    requests.push(req)
  }))
  vi.stubGlobal('fetch', fn)
  return {
    fn,
    requests,
    /** requests to `path` (all, in the order sent) */
    all: (path) => requests.filter((r) => r.path === path),
    count: (path) => requests.filter((r) => r.path === path).length,
    /** the next request to `path` not yet taken by next(): waits for it */
    async next(path, { timeout = 1500 } = {}) {
      const req = await waitFor(() => {
        const r = requests.find((x) => x.path === path && !x.taken)
        if (!r) throw new Error(`no new request to ${path}; sent: ${requests.map((x) => `${x.method} ${x.path}`).join(', ') || 'none'}`)
        return r
      }, { timeout })
      req.taken = true
      return req
    },
    /** true if no request to `path` is waiting to be taken by next() after `ms` */
    async noneWithin(path, ms = 300) {
      await sleep(ms)
      return !requests.some((x) => x.path === path && !x.taken)
    },
  }
}

function makeRequest({ method, path, body, raw, resolve, reject, signal }) {
  let controller = null
  let settled = false
  const req = {
    method, path, body, raw, taken: false, aborted: false,
    /** the conversation the client sent (UI messages) */
    get messages() { return Array.isArray(body?.messages) ? body.messages : [] },
    /** the texts of the user messages, in order */
    userTexts() { return req.messages.filter((m) => m.role === 'user').map(messageText) },
    lastUserText() { const u = req.messages.filter((m) => m.role === 'user'); return messageText(u[u.length - 1]) },
    /** the tool part (any message) for a tool call id, or undefined */
    toolPart(toolCallId) {
      for (const m of req.messages) for (const p of m.parts || []) if (p && p.toolCallId === toolCallId) return p
      return undefined
    },
    /** answer with JSON */
    async json(data, status = 200) {
      if (settled) return
      settled = true
      resolve(new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } }))
      await sleep(60)
    },
    /** answer with an HTTP error */
    async fail(status = 500, data = { error: 'Internal Server Error' }) { return req.json(data, status) },
    async networkError() {
      if (settled) return
      settled = true
      reject(new TypeError('Failed to fetch'))
      await sleep(60)
    },
    /** open the UI message stream (the response headers arrive); later writes stream chunks */
    async open() {
      if (settled) return
      settled = true
      const stream = new ReadableStream({ start(c) { controller = c } })
      resolve(new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-vercel-ai-ui-message-stream': 'v1' } }))
      req.write({ type: 'start', messageId: `msg-${++ids}` })
      req.write({ type: 'start-step' })
      await sleep(30)
    },
    /** one SSE chunk (an object) or `[DONE]` */
    write(chunk) {
      if (!controller || req.aborted) return
      try { controller.enqueue(enc.encode(`data: ${typeof chunk === 'string' ? chunk : JSON.stringify(chunk)}\n\n`)) } catch {}
    },
    /** stream text, one delta per piece, pausing `gap` ms between pieces */
    async text(pieces, { gap = 40 } = {}) {
      if (!controller) await req.open()
      const id = `txt-${++ids}`
      req.write({ type: 'text-start', id })
      for (const delta of [].concat(pieces)) {
        req.write({ type: 'text-delta', id, delta })
        await sleep(gap)
      }
      req.write({ type: 'text-end', id })
      await sleep(20)
    },
    /** a client tool call (the server declares the tool without `execute`); returns its id */
    async toolCall(toolName, input, toolCallId = `call-${++ids}`) {
      if (!controller) await req.open()
      req.write({ type: 'tool-input-start', toolCallId, toolName })
      req.write({ type: 'tool-input-available', toolCallId, toolName, input })
      await sleep(20)
      return toolCallId
    },
    /** end the step and the stream */
    async finish(finishReason = 'stop') {
      if (!controller) await req.open()
      req.write({ type: 'finish-step' })
      req.write({ type: 'finish', finishReason })
      req.write('[DONE]')
      try { controller.close() } catch {}
      await sleep(80)
    },
    /** a whole text reply */
    async reply(pieces, opts) {
      await req.text(pieces, opts)
      await req.finish('stop')
    },
    /** an `error` chunk, then the stream ends */
    async streamError(errorText = 'The model is overloaded.') {
      if (!controller) await req.open()
      req.write({ type: 'error', errorText })
      try { controller.close() } catch {}
      await sleep(80)
    },
  }
  const abort = () => {
    if (req.aborted) return
    req.aborted = true
    const err = new DOMException('The operation was aborted.', 'AbortError')
    if (!settled) { settled = true; reject(err) } else if (controller) { try { controller.error(err) } catch {} }
  }
  if (signal?.aborted) abort()
  else signal?.addEventListener?.('abort', abort)
  return req
}

/**
 * A decision reply in the dictionary form: `answersFor({ topic: ['billing', 0.92], urgent: 0.8 })`
 * gives `{ model, answers: { topic: { type: 'choice', choice, probabilities, confidence },
 * urgent: { type: 'noul', noul } }, usage }`. A choice's other options share the rest.
 */
export function answersFor(picks, options = ['billing', 'bug', 'account']) {
  const answers = {}
  for (const [name, pick] of Object.entries(picks)) {
    if (Array.isArray(pick)) {
      const [choice, confidence] = pick
      const rest = options.filter((o) => o !== choice)
      const top = Math.min(0.98, 0.34 + confidence * 0.64)
      const probabilities = Object.fromEntries([[choice, top], ...rest.map((o) => [o, (1 - top) / rest.length])])
      answers[name] = { type: 'choice', choice, probabilities, confidence }
    } else {
      answers[name] = { type: 'noul', noul: pick }
    }
  }
  return { model: 'jev-latest', answers, usage: { input_tokens: 120, output_tokens: 6 } }
}

/**
 * A WebMCP model context, as Chrome's `document.modelContext`: registerTool(tool, { signal })
 * (aborting the signal unregisters it) and unregisterTool(name). `tool(name)` is the tool
 * registered now under that name; `call(name, input)` runs its execute() like an agent.
 */
export function fakeModelContext() {
  const tools = new Map()
  const mc = {
    registerTool(tool, opts = {}) {
      if (!tool || typeof tool.name !== 'string') throw new TypeError('registerTool: a tool needs a name')
      if (tools.has(tool.name)) throw new DOMException(`a tool named ${tool.name} is already registered`, 'InvalidStateError')
      tools.set(tool.name, tool)
      opts.signal?.addEventListener?.('abort', () => { if (tools.get(tool.name) === tool) tools.delete(tool.name) })
      return Promise.resolve()
    },
    unregisterTool(name) { tools.delete(name) },
    provideContext() {},
    clearContext() { tools.clear() },
    names: () => [...tools.keys()].sort(),
    tool: (name) => tools.get(name),
    async call(name, input = {}) {
      const tool = tools.get(name)
      if (!tool) throw new Error(`no tool ${name}; registered: ${[...tools.keys()].join(', ') || 'none'}`)
      let result = tool.execute(input, { requestUserInteraction: async (cb) => cb() })
      result = await result
      await sleep(60)
      return typeof result === 'string' ? safeJson(result) : result
    },
  }
  return mc
}

function safeJson(s) {
  try { return JSON.parse(s) } catch { return s }
}

/** jsdom has no showModal()/close(): a minimal version, as a browser does it */
export function installDialogPolyfill() {
  const proto = globalThis.HTMLDialogElement?.prototype
  if (!proto) return
  if (!proto.showModal || proto.showModal.__fake !== true) {
    proto.showModal = function () { this.setAttribute('open', ''); this.__modal = true }
    proto.showModal.__fake = true
    proto.show = function () { this.setAttribute('open', '') }
    proto.close = function (v) {
      if (!this.hasAttribute('open')) return
      this.removeAttribute('open')
      if (v !== undefined) this.returnValue = v
      setTimeout(() => this.dispatchEvent(new Event('close')), 0)
    }
  }
}
