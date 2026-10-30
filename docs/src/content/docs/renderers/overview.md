---
title: Beyond the Browser
description: Run the same Sygnal components on React Native, in a terminal or for an LLM agent. Renderer targets, the host tree they share, and the rules that keep an app portable
---

A Sygnal component never touches the DOM. Its view returns vnodes, and its intent asks the DOM driver for events by selector. Its model is pure. Everything platform-specific lives in the driver named `DOM`. Swap that driver, and the same components render somewhere else.

Sygnal ships four **renderer targets**:

| Target | Renders to | Input | Use it for |
|---|---|---|---|
| the DOM driver (default) | the browser's DOM | the user's mouse and keyboard | web apps |
| [`sygnal/react-native`](/renderers/react-native/) | React Native components (iOS, Android) | taps, typing, switches | native apps |
| [`sygnal/terminal`](/renderers/terminal/) | text in a terminal | key presses | CLI tools, dashboards, agent consoles |
| [`sygnal/agent-ui`](/renderers/agent-ui/) | an accessibility snapshot an LLM reads | tool calls (MCP, or your own loop) | letting an agent operate your app's UI |

You can write more with [`sygnal/host`](/renderers/custom-targets/), the kit the other three are built on. To write one component file for all of them, use the neutral primitives: see [Write Once](/renderers/write-once/).

```jsx
// main.js
import { run } from 'sygnal'
import App from './App.jsx'

run(App)                                   // the browser
```

```jsx
// terminal.jsx
import { runTerminal } from 'sygnal/terminal'
import App from './App.jsx'

runTerminal(App)                           // a terminal (Node)
```

```jsx
// mcp.jsx
import { runAgentUI, serveMcp } from 'sygnal/agent-ui'
import App from './App.jsx'

const { ui } = runAgentUI(App)
serveMcp(ui, { name: 'my-app' })           // an MCP server an agent drives (Node)
```

The [renderer-targets example](https://github.com/tpresley/sygnal/tree/main/examples/renderer-targets) is one grocery-list app running on all three, with one test file covering them.

## How it works

The core hands one vnode tree per update to the `DOM` driver and asks it for events with `select(selector).events(type)`. The new targets render into a **host tree**: a small, browser-free copy of the DOM API that snabbdom patches exactly as it patches the real DOM. Keyed lists, refs, `autoFocus`, `<Transition>` and Sygnal's own element modules all work unchanged. A target then does two things:

- **paint** the host tree its own way (text for a terminal, a snapshot for an agent);
- **turn its input into DOM events** on host elements (`click`, `input`, `change`, `keydown`, `submit`, …), with the default actions a browser would run: a checkbox toggles, Enter in a field submits its form, a label clicks its control.

Your intents receive the same events whichever target produced them.

## Writing portable apps

Most web apps run on the new targets unchanged. [examples/todomvc](https://github.com/tpresley/sygnal/tree/main/examples/todomvc) runs in a terminal and under an agent without edits. To make sure yours does:

**Select controls in intents, not page structure.** `DOM.click('.todo label')` only fires where an element matches that CSS, so a target with a different layout (say, a terminal view with no `<label>` inside `.todo`) silently never fires it. A [control](/guide/controls/) is an identity, not a structure. It matches wherever it's rendered:

```jsx
// Item.jsx
import { controls, toggle } from 'sygnal'

const { Done, Remove } = controls({ Done: 'input', Remove: 'button' })

export function Item({ state }) {
  return (
    <li>
      <label><Done type="checkbox" checked={state.done} /> {state.name}</label>
      <Remove aria-label={`Remove ${state.name}`}>×</Remove>
    </li>
  )
}

Item.intent = ({ DOM }) => ({
  TOGGLE: DOM.change(Done),
  REMOVE: DOM.click(Remove),
})

Item.model = {
  TOGGLE: toggle('done'),
  REMOVE: () => undefined,
}
```

**Use the DOM's event names.** Every target produces `click`, `input`, `change`, `keydown`, `submit` and the rest, with `e.target.value`, `e.target.checked` and `e.key`. So `.value()`, `.checked()`, `.key()` and `processForm` work everywhere. A target never invents its own names such as `press`.

**Keep host access in effects small.** An EFFECT that writes `ref.current.value = ''` works on the host tree (its elements have a `value`), but it's still a host detail. Prefer state (`value={state.draft}`) where you can.

**Give each target its own stylesheet.** CSS doesn't reach a terminal or an agent. Each target takes a list of `[selector, style]` rules for the parts of your CSS that change *what is shown* (`['.todo .edit', { display: 'none' }]`), plus its own presentation keys (colors in a terminal).

**Test the logic once.** [`renderComponent`](/integration/testing/) runs intents and models with a mock DOM and no renderer, so those tests cover every target. Add a few tests per target for what's specific to it (see each target's page).

## Platform-specific views

When a target needs a different layout, give the same logic a second view. A component is a function plus statics, so the statics can be shared:

```jsx
// GroceriesTerminal.jsx
import Groceries, { AddForm, Name, ClearDone } from './Groceries.jsx'

// a compact layout: the count first, no aisle picker, no filter
export default function GroceriesTerminal({ state }) {
  return (
    <main>
      <p>{state.open} to buy</p>
      <AddForm>
        <label>Add <Name name="name" value={state.draft} /></label>
      </AddForm>
      <ClearDone>Clear the cart</ClearDone>
    </main>
  )
}

GroceriesTerminal.initialState = Groceries.initialState
GroceriesTerminal.calculated = Groceries.calculated
GroceriesTerminal.intent = Groceries.intent
GroceriesTerminal.model = Groceries.model
```

The shared intent keeps working because it selects controls: the second view renders the ones it needs, and a control it leaves out (the aisle picker here) simply never fires.
