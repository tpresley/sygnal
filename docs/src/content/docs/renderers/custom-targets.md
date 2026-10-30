---
title: Writing a Renderer Target
description: Build your own Sygnal renderer target with sygnal/host. The host tree, the host driver, painting, input as DOM events, your own tag vocabulary, and testing
---

`sygnal/terminal` and `sygnal/agent-ui` are built on a public kit, `sygnal/host`. Use it to render Sygnal apps anywhere JavaScript runs: a native UI layer, a canvas, a JSON UI protocol, a renderer in another thread or process, or a test harness.

## The model

```
 components ──vnodes──▶ host driver ──patches──▶ host tree ──your painter──▶ the platform
     ▲                                               │
     └──── intents ◀── DOM-shaped events ◀── your input handler ◀── the platform's input
```

- The **host tree** (`HostDocument`, `HostElement`) is a small copy of the DOM API: elements with attributes, `classList`, `style`, `dataset`, `value`, `checked`, parent and child links, `focus()` and events. It has no browser in it, so it runs in Node, a worker or a native JS engine.
- **`makeHostDriver(doc)`** is a `DOM` driver for it. The core's output is patched in by snabbdom with Sygnal's own modules (the same code as the browser driver). Keyed lists, refs, `autoFocus`, `<Transition>` and controlled inputs all work, and intents select with CSS and controls, isolated per component as on the web.
- **Your target** paints the tree, and turns the platform's input into DOM events on its elements.

## A complete target

This one sends the tree as JSON to a remote screen (another thread, a socket, a native shell) and takes back events by element id: about thirty lines.

```js
// jsonTarget.js
import { HostDocument, makeHostDriver, nodeId, computeStyle, activate, fill, pressKey } from 'sygnal/host'

export function createJsonTarget(send, styles = []) {
  const doc = new HostDocument()
  const byId = new Map()

  // paint: the visible tree as plain objects
  const toJson = (node) => {
    if (node.nodeType === 3) return node.data
    if (computeStyle(node, styles).display === 'none') return null
    byId.set(nodeId(node), node)
    return {
      id: nodeId(node), tag: node.localName, className: node.className, value: node.value, checked: node.checked,
      children: node.childNodes.map(toJson).filter((c) => c !== null),
    }
  }
  const paint = () => { byId.clear(); send(toJson(doc.body)) }
  doc.onChange = paint

  // input: the screen's events, as a browser would make them
  const receive = ({ id, type, value, key }) => {
    const el = byId.get(id)
    if (!el) return
    if (type === 'click') activate(el)
    else if (type === 'input') fill(el, value)
    else if (type === 'key') pressKey(el, key)
  }

  return { driver: makeHostDriver(doc), receive }
}
```

Here the app runs in a Web Worker, so the "remote screen" is the page that started it. `self.postMessage` and `self.onmessage` are the worker's own channel to that page, not Sygnal APIs. For a socket or a native shell, pass that channel's send function and call `target.receive` from its message handler instead.

```js
// main.js: runs in a Web Worker (new Worker('./main.js', { type: 'module' }))
import { run } from 'sygnal'
import App from './App.jsx'
import { createJsonTarget } from './jsonTarget.js'

const target = createJsonTarget((tree) => self.postMessage(tree))  // tree → the page
self.onmessage = (e) => target.receive(e.data)                     // the page's events → the app
run(App, { DOM: target.driver })
```

The app itself doesn't change. That's the whole contract: the target reads `doc.body` when it changes, and it dispatches events on host elements.

## Painting

- `doc.onChange` is called once per microtask after any change: a patch, a `value` an EFFECT wrote, a class `<Transition>` added. Alternatively, `makeHostDriver(doc, { onPatch })` calls you after each patch only.
- Walk `doc.body` (`childNodes`, `nodeType` 1 for elements and 3 for text, `localName`, `getAttribute`, `classList`, `style`, `value`, `checked`, `textContent`).
- `computeStyle(el, rules)` merges your target's `[selector, style]` rules with the element's inline `style` (`display: 'none'` from `hidden` too). `isHidden(el, rules)` checks the ancestors as well. A stylesheet is how an app tells a non-CSS target what is shown. Define what other keys mean for your platform.
- `nodeId(el)` is a stable number for as long as the element lives. Use it for refs, diffs and remote ids.
- `node.revision` moves whenever the node or anything below it changes, and `el.attrRevision` when its own attributes, classes, style or dataset change. Repaint only the subtrees whose revision moved: `sygnal/react-native` memoizes each element's React component on it.
- `doc.activeElement` is the focused element. Draw focus your platform's way.

## Input

Turn every platform event into the DOM's events, never into new names. Intents, `.value()`, `.checked()`, `processForm` and the shorthand checks all rely on `click`, `input`, `change`, `keydown`, `submit` and friends, with `e.target.value`, `e.target.checked` and `e.key`. The kit's user-agent functions make those events, with a browser's default actions:

| Function | Events and default action |
|---|---|
| `activate(el, { onNavigate })` | `click`; a checkbox or radio toggles first, then `input` + `change`; a `<label>` clicks its control; a link calls `onNavigate(href)`; a submit button submits its form |
| `doubleClick(el)` | two clicks, then `dblclick` |
| `pressKey(el, key, { shiftKey, … })` | `keydown`, its default (typing into a field, Enter submits a form, Space or Enter activates, ← → on a `<select>`), `keyup` |
| `typeText(el, text)` | a key press per character |
| `fill(el, value)` | the value at once: `input`, then `change` |
| `chooseOption(select, valueOrLabel)` | `input`, then `change` |
| `focusableElements(doc, rules, { listened: true })`, `moveFocus(doc, 1)` | the focus order, including elements the app's intents listen to clicks on |

`el.dispatchEvent(new HostEvent(type, init))` sends any other event, and the `init` fields land on the event (`detail`, `pointerId`, …). `doc.listenedTypes(el)` tells you which event types the app's intents would receive from an element. `doc.globalTypes()` lists the ones `DOM.select('document')` listens for.

## Your own tags

A native target may want its own vocabulary (`<view>`, `<txt>`, `<textinput>`) instead of HTML. Any lowercase tag works. Three rules:

- Don't use `text` (the JSX pragma treats it as SVG's `<text>`) or hyphenated names (those are custom elements to the pragma).
- Register your form-field tags before the first render, so a value the state sets back is written again, as `<input>`'s is:

  ```js
  // setup.js
  import { registerFieldTags } from 'sygnal/host'

  registerFieldTags('textinput', { tag: 'toggle', kind: 'checkbox' })
  ```

  A name is a text field: typing edits it, and it's a `textbox` to the agent UI. `kind: 'checkbox'` makes a click toggle `checked` and fire `click`, `input` and `change`, as a checkbox does.

- Select them with [controls](/guide/controls/) in intents (`controls({ Name: 'textinput' })`), so the same intent works on a web view that renders `<input>`. Or start from the [primitives](/renderers/write-once/), which already render HTML on the web and a marker (`data-primitive`) a native target maps.

## Testing a target

Run an app on your driver and assert on what you paint. The library's own tests run [examples/todomvc](https://github.com/tpresley/sygnal/tree/main/examples/todomvc), unchanged, on the terminal and agent targets: a good conformance check for a new one. Its keyed list, isolation, `processForm`, `autoFocus` and `<Transition>` cover most of the renderer contract. Test app logic once with [`renderComponent`](/integration/testing/), which needs no target.

## What stays web-only

`Portal` (it mounts into `document`), the [UI parts](/ui/overview/) built on native `<dialog>` and popover, the [browser sources](/guide/browser-sources/), view transitions, and `VirtualCollection` (it measures elements) need the browser's DOM. On a host target, use your platform's equivalents through drivers.
