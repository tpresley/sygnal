---
title: WebMCP (experimental)
description: Offer your app's agent tools, and its forms, to the browser's own agent through WebMCP — experimentalExposeWebMcp, formTool, budgets, hints, confirmation and the polyfill
---

:::caution[Experimental]
WebMCP is a draft (W3C Web Machine Learning Community Group), in a Chrome origin trial until Chrome 156. `experimentalExposeWebMcp` and `formTool` follow the draft as it changes, so they are **outside semver**: a minor Sygnal release may change them. The rest of [`sygnal/ai`](/guide/agent/) is stable.
:::

Browser agents (the agent built into the browser, or an extension) usually operate a page the way a person does: they read the accessibility tree, then click and type. WebMCP lets a page offer them **tools** instead: named functions with a description and an input schema, registered with `document.modelContext.registerTool()`. A tool call is faster and far more reliable than a sequence of clicks, and the page decides what an agent may do.

A Sygnal app already says what agents may do: its components' [`agent` statics](/guide/agent/). One call offers those tools through WebMCP.

## Exposing the app's tools

```js
// main.js
import { run } from 'sygnal'
import { experimentalExposeWebMcp } from 'sygnal/ai'
import TodoApp from './TodoApp.jsx'

const app = run(TodoApp)
const webMcp = experimentalExposeWebMcp(app)

// webMcp.available: false where the browser has no WebMCP (the call did nothing)
// webMcp(): unregister every tool
```

Every tool the [agent layer](/guide/agent/#what-agents-see) offers is registered: one per declared action of a component on the page (`todos_add`, `todo_toggle` with its `id` parameter, ...), plus a read tool per declaration with a `read` (`todos_read`). The registrations follow the app: a tool whose `when` turns false is unregistered, a component that leaves the page takes its tools with it, and a tool whose description or schema changed (a new Collection key, a new state summary) is registered again. Each call goes through the [call rules](/guide/agent/#the-call-rules): validation, confirmation, `cause: 'agent'`, no-op detection.

Where there is no WebMCP, `experimentalExposeWebMcp` does nothing and returns a handle with `available: false`. It is safe to call in every browser.

Options:

| Option | Default | What it does |
|---|---|---|
| `confirm` | a dialog | Consequential calls: `true` runs them, `false` declines them, a function `(info) => boolean \| Promise<boolean>` asks your own UI. See [Confirmation](#confirmation) |
| `exposedTo` | | Other origins the tools are exposed to (passed to `registerTool` where the browser supports it). Leave it out unless a partner's embedding page needs them |
| `prefix` | | Prepended to every tool name: `shop_` gives `shop_todos_add` |
| `modelContext` | `document.modelContext` | The WebMCP object to register with (a test double, a polyfill instance) |

## Trying it in Chrome

Chrome 153 has WebMCP behind a flag: enable **WebMCP for testing** at `chrome://flags/#enable-webmcp-testing` (the same as launching with `--enable-features=WebMCP`), or join the origin trial for your site. The API is `document.modelContext`; the older `navigator.modelContext` is deprecated, and Sygnal uses it only when the document one is missing.

**Other browsers: the polyfill.** [`@mcp-b/webmcp-polyfill`](https://www.npmjs.com/package/@mcp-b/webmcp-polyfill) installs a `document.modelContext` in any browser, so an agent extension that speaks it can call your tools. Load it before `experimentalExposeWebMcp`, in development only:

```js
// main.js (development)
import { run } from 'sygnal'
import { experimentalExposeWebMcp } from 'sygnal/ai'
import TodoApp from './TodoApp.jsx'

if (import.meta.env.DEV && !document.modelContext) {
  const { installWebMCP } = await import('@mcp-b/webmcp-polyfill')
  installWebMCP()
}
experimentalExposeWebMcp(run(TodoApp))
```

Sygnal never depends on the polyfill; you install it yourself (`npm install -D @mcp-b/webmcp-polyfill`). Sygnal's own browser tests run the same app against Chrome's native WebMCP and against the polyfill in Chromium, Firefox and WebKit.

## What the agent sees

**Context.** An agent works much better when it knows the current state ([why](/guide/agent/#what-agents-see)). WebMCP has no channel for it other than tools, so Sygnal offers it two ways: the read tool (`todos_read`), and a short summary of the declaration's `read` projection at the end of each of its tool descriptions ("Current state: ..."), registered again when the projection changes. The agent sees the state without having to call anything first.

For a declaration with user-entered text (`untrusted: true`, or [inferred](/guide/agent/#security)), the summary in the descriptions is the **structure only**: counts, numeric ids, numbers and booleans, every string replaced by `<text>`. Its Collection key parameters list the ids without their `label`s. Agents read descriptions as instructions, so text a user typed never goes there; the contents come only from the read tool, whose results are marked untrusted.

### Hints

Each tool carries WebMCP annotations:

| Annotation | On |
|---|---|
| `readOnlyHint` | the read tools |
| `consequentialHint` | actions with `consequential: true` |
| `untrustedContentHint` | the tools of a declaration whose projection holds user-entered text: `untrusted: true`, or inferred from its strings ([SYG244](/reference/errors/#syg244) in development, until you declare it either way) |

Hints are advice to the agent. Chrome 153 drops `consequentialHint`, so it is not a safeguard: [confirmation](#confirmation) is.

### Budgets

Chrome's guidance sets size limits that neither Chrome 153 nor the polyfill enforce, so Sygnal does: a tool name at most 30 characters (letters, digits, `_`, `-`, `.`), a description at most 500, a parameter description at most 150, a result at most 1,500 characters of JSON. Going over is [SYG242](/reference/errors/#syg242) in development, then the part is cut safely: a long name keeps a hash of the whole so names stay unique, and a long result keeps `ok` and `error` and shortens `state`. Short `name`s on your declarations (`todos`, not `todoListManager`) leave room for the action names; `prefix` counts too.

Results are always objects, and a tool never throws: an error is `{ ok: false, error }`, which the agent can read and act on.

## Confirmation

A consequential call is confirmed in the page before it runs. By default Sygnal shows a native modal `<dialog>`, added to `document.body` outside your app's tree: "Allow the AI agent to do this?", the action's description and the item's label, and **Deny** (focused) and **Allow**. The rest of the page is inert while it is open, and Escape denies.

Your own UI instead: pass `confirm`, a function that resolves `true` to run the call.

```js
experimentalExposeWebMcp(app, {
  confirm: (info) => window.confirm(`Allow the AI agent to: ${info.description}${info.label ? ` (${info.label})` : ''}?`),
})
```

`info` is `{ tool, component, action, description, input, key?, label? }`: `input` is the validated input, `key` and `label` name a Collection item. A declined call answers `{ ok: false, error: 'the user declined' }`.

## Forms as tools: `formTool`

WebMCP also has a declarative form: a `<form>` with `toolname` and `tooldescription` attributes is a tool, and its fields are the parameters. The agent fills the fields and submits. The [`form` behavior](/guide/forms/) already knows the schema and the labels, so it can write those attributes for you:

```jsx
import { form } from 'sygnal'
import { formTool } from 'sygnal/ai'
import { z } from 'zod'

const schema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  plan: z.enum(['free', 'pro']),
})

function Signup({ state }) {
  const f = state.form.fields
  return (
    <form className="signup">
      <label>Email address <input name="email" type="email" value={f.email.value} /></label>
      <label>Plan
        <select name="plan" value={f.plan.value}>
          <option value="free">Free</option>
          <option value="pro">Pro</option>
        </select>
      </label>
      <p role="alert">{state.form.error}</p>
      <button type="submit">Sign up</button>
    </form>
  )
}

Signup.uses = {
  form: form(schema, {
    values: { email: '', plan: 'free' },
    submit: 'SIGN_UP',
    tool: formTool({ name: 'sign_up', description: 'Create an account' }),
  }),
}

Signup.model = {
  SIGN_UP: { HTTP: (state, values) => ({ url: '/api/signup', method: 'POST', json: values, ok: 'form.DONE', error: 'form.ERRORS' }) },
}
```

- The `<form>` gets `toolname="sign_up"` and `tooldescription`, and each named field a `toolparamdescription` from its label: a wrapping `<label>`, a `<label for>`, then its `aria-label`. Attributes you write yourself win (`attrs-toolparamdescription="..."`; written plainly in JSX, `toolname` would become a DOM property the browser ignores, which `sygnal-check` points out).
- An agent's submit is the form's usual submit: the same validation, the same `SIGN_UP`. The agent gets `{ ok: true, values }` (the schema's output; for a submit that sends a request, after `form.DONE`), or `{ ok: false, errors }` with the field errors by name (schema, check and server errors), or `{ ok: false, error }` when a submit was already running or the form went away.
- **The user submits.** By default (`autosubmit: false`) the agent's call fills the fields and waits: the user reviews the form and presses the button, and then the agent gets its answer. `formTool({ ..., autosubmit: true })` lets the agent submit by itself; use it only for forms whose submit is harmless.
- A user's own submit is unchanged.

`formTool` comes from `sygnal/ai`, so a form without it carries none of this. A plain object as `tool` is [SYG245](/reference/errors/#syg245).

## Agents that read the page

Most browser agents today don't use WebMCP at all: they read the accessibility tree, the same structure screen readers use, and act on roles, names and states. An app that is accessible is most of the way to an app that agents can operate, and Lighthouse's Agentic Browsing audits check the same things (accessible names, stable layout, registered WebMCP tools, forms without declarative tools).

[`sygnal-check`](/integration/agents/#sygnal-check)'s accessibility rules ([Accessibility](/guide/accessibility/)) cover the common gaps, with two aimed at agents:

- [SYG730](/reference/errors/#syg730): an action reachable only by hovering (`mouseenter` / `mouseover`). Agents, keyboards and touch screens can't reach it.
- [SYG731](/reference/errors/#syg731): a toggle whose on/off state shows only as a class (`className={{ done: state.done }}`). Add `aria-pressed`, `aria-checked` or `aria-expanded`, so the state is in the tree.

## Testing

The tools WebMCP registers are the agent layer's, so the [`t.tools()` / `t.callTool()` tests](/guide/agent/#testing) cover them. To test the registration itself, pass a stand-in `modelContext`:

```js
import { it, expect } from 'vitest'
import { run } from 'sygnal'
import { experimentalExposeWebMcp } from 'sygnal/ai'
import TodoApp from './TodoApp.jsx'

it('registers the todo tools', async () => {
  const tools = new Map()
  const modelContext = {
    registerTool: async (tool, { signal }) => {
      tools.set(tool.name, tool)
      signal.addEventListener('abort', () => tools.delete(tool.name))
    },
  }
  const app = run(TodoApp, {}, { mountPoint: document.body })
  await app.__runtime.flushed()
  const stop = experimentalExposeWebMcp(app, { modelContext, confirm: false })
  await Promise.resolve()

  expect([...tools.keys()]).toContain('todos_add')
  expect(await tools.get('todos_add').execute({ value: 'buy milk' })).toMatchObject({ ok: true })

  stop()
  app.dispose()
})
```
