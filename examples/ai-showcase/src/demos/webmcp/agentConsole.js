// The agent console's plumbing (no Sygnal in here): a WebMCP context that records what the app
// registers and passes it on to the browser's own, and the two drivers the console reads.
//
// - `recordingModelContext()` is what `experimentalExposeWebMcp(app, { modelContext })` registers
//   with. It keeps each tool until its signal aborts, and forwards every call to the real
//   `document.modelContext` when the browser has one, so the browser's agent sees the same tools.
// - `WEBMCP.select()` emits `{ native, tools, log }` whenever the registrations change, with the
//   declarative form tools (`<form toolname>`) found in the widget.
// - `AGENT_CALL` calls a tool the way an agent does: `execute(args)` for a registered tool; for a
//   form tool, what the browser does: fill the named fields, then answer with the form's own
//   answer to the next submit (`agentInvoked` + `respondWith`, which `formTool` handles).

import { driverFromAsync, xs } from 'sygnal'

export const nativeModelContext = () => globalThis.document?.modelContext ?? globalThis.navigator?.modelContext

export function recordingModelContext(native = nativeModelContext()) {
  const tools = new Map()
  const log = []
  const listeners = new Set()
  const changed = () => listeners.forEach((f) => f())
  const note = (op, name) => {
    // unregistered and registered again in one go (its description or schema changed): updated
    const i = log.findIndex((e) => e.name === name)
    if (op === 'registered' && log[i]?.op === 'unregistered' && Date.now() - log[i].at < 100) {
      log.splice(i, 1)
      op = 'updated'
    }
    log.unshift({ op, name, at: Date.now() })
    log.length = Math.min(log.length, 8)
  }
  return {
    native: !!native,
    tools,
    log,
    subscribe(f) { listeners.add(f); return () => listeners.delete(f) },
    registerTool(tool, options = {}) {
      tools.set(tool.name, tool)
      note('registered', tool.name)
      options.signal?.addEventListener('abort', () => {
        if (tools.get(tool.name) === tool) tools.delete(tool.name)
        note('unregistered', tool.name)
        changed()
      })
      changed()
      return native ? native.registerTool(tool, options) : Promise.resolve()
    },
  }
}

/** a declarative form tool, as an agent sees it: its parameters from the named fields */
function formTools(root) {
  return [...(root?.querySelectorAll('form[toolname]') ?? [])].map((form) => {
    const fields = [...form.elements].filter((f) => f.name && f.type !== 'submit')
    return {
      name: form.getAttribute('toolname'),
      description: form.getAttribute('tooldescription'),
      form: true,
      autosubmit: form.hasAttribute('toolautosubmit'),
      inputSchema: {
        type: 'object',
        properties: Object.fromEntries(fields.map((f) => [f.name, {
          type: 'string',
          ...(f.tagName === 'SELECT' && { enum: [...f.options].map((o) => o.value) }),
          ...(f.getAttribute('toolparamdescription') && { description: f.getAttribute('toolparamdescription') }),
        }])),
        required: fields.filter((f) => f.required).map((f) => f.name),
      },
    }
  })
}

/** what the console lists, without the functions */
const listOf = (mc, root) => ({
  native: mc.native,
  tools: [
    ...[...mc.tools.values()].map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations: annotations ?? {} })),
    ...formTools(root),
  ],
  log: [...mc.log],
})

/** WEBMCP: the registrations, as they change (and the form tools, as the widget's DOM changes) */
export function makeWebMcpDriver(mc, root) {
  let stopExposing = null
  const driver = () => {
    let last = ''
    let observer = null, unsubscribe = null
    const tools$ = xs.create({
      start(listener) {
        const emit = () => {
          const view = listOf(mc, root)
          const json = JSON.stringify(view)
          if (json !== last) { last = json; listener.next(view) }
        }
        unsubscribe = mc.subscribe(emit)
        observer = new MutationObserver(emit)
        observer.observe(root, { subtree: true, childList: true, attributeFilter: ['toolname', 'tooldescription', 'toolparamdescription'] })
        emit()
      },
      stop() { unsubscribe?.(); observer?.disconnect() },
    })
    return { select: () => tools$, dispose: () => stopExposing?.() }
  }
  /** the handle experimentalExposeWebMcp() returned: called when the app is disposed */
  driver.exposing = (stop) => { stopExposing = stop }
  return driver
}

/** fill a form's named fields as an agent would, and resolve with the form's answer to the next submit */
function callForm(form, args) {
  for (const [name, value] of Object.entries(args ?? {})) {
    const field = form.elements.namedItem(name)
    if (!field) continue
    field.value = String(value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
  }
  return new Promise((resolve) => {
    form.addEventListener('submit', (e) => {
      Object.defineProperty(e, 'agentInvoked', { value: true })
      e.respondWith = (answer) => { Promise.resolve(answer).then(resolve) }
    }, { capture: true, once: true })
    if (form.hasAttribute('toolautosubmit')) form.requestSubmit()
  })
}

/** AGENT_CALL: `{ value: { id, name, args }, ok, error }` calls the tool as an agent; `ok` gets `{ id, result }` */
export const makeAgentCallDriver = (mc, root) => driverFromAsync(async ({ id, name, args }) => {
  const tool = mc.tools.get(name)
  const form = !tool && [...root.querySelectorAll('form[toolname]')].find((f) => f.getAttribute('toolname') === name)
  if (!tool && !form) throw new Error(`no tool named ${name} is registered now`)
  return { id, result: await (tool ? tool.execute(args) : callForm(form, args)) }
})

const SAMPLE_TEXT = { title: 'The Hobbit', author: 'J. R. R. Tolkien' }

/** arguments to start from, built from a tool's input schema: the first enum value, a number in range, ... */
export function exampleArgs(schema) {
  const sample = (name, s) => {
    if (s.enum) return s.enum[0]
    if (s.type === 'number' || s.type === 'integer') return Math.min(Math.max(12, s.minimum ?? 12), s.maximum ?? 12)
    if (s.type === 'boolean') return true
    return SAMPLE_TEXT[name] ?? ''
  }
  return Object.fromEntries(Object.entries(schema?.properties ?? {}).map(([name, s]) => [name, sample(name, s)]))
}
