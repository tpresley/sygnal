---
title: "Portals"
description: "Rendering outside the component tree"
---

Render children into a DOM container outside the component's own tree. Essential for modals, tooltips, and dropdown menus that need to escape `overflow: hidden` or z-index stacking contexts.

:::tip[Dialogs, popovers and tooltips]
A native `<dialog>` opened with `showModal()` and an element with the `popover` attribute are drawn in the browser's top layer, above every `overflow: hidden` and z-index, so they rarely need a portal. The [`sygnal/ui`](/ui/overview/) parts work inside one all the same: `dialog()`, `popover()` and `tooltip()` find their elements, events and commands in the content of the portals the component renders.
:::

```jsx
import { Portal } from 'sygnal'

function ModalExample({ state }) {
  return (
    <div>
      <button className="open-btn">Open Modal</button>
      {state.showModal && (
        <Portal target="#modal-root">
          <div className="modal-overlay">
            <div className="modal-content">
              <h2>Modal Title</h2>
              <button className="close-btn">Close</button>
            </div>
          </div>
        </Portal>
      )}
    </div>
  )
}
```

The `target` prop is a CSS selector for the destination container. Add a `<div id="modal-root"></div>` to your HTML.

## Event Handling in Portals

Events from a portal's content belong to the component that renders the `<Portal>`, as in React: they bubble from the content to the portal's place in the view, then through the elements and components around it. So the intent selects portal content as it selects the rest of its view:

```jsx
ModalExample.intent = ({ DOM }) => ({
  OPEN: DOM.select('.open-btn').events('click'),
  // the close button is inside the portal, rendered into #modal-root
  CLOSE: DOM.select('.close-btn').events('click'),
})
```

This holds wherever the target is (`body`, `#modal-root`, an element of the app). Events that don't bubble (`focus`, `toggle`, `close` on a `<dialog>`) work the same way, and `DOM.select('.close-btn').elements()` finds the content's elements too. A click in the portal reaches a listener on an element around the `<Portal>` in the view (`DOM.select('.card').events('click')`), not the listeners on the target's ancestors in the app.

## Components inside a Portal

A component in a portal's content is a child of the component that renders the `<Portal>`, as anywhere else in its view: it gets its state (`<Picker state="picker" />`), renders into the target, sends `PARENT` and `EVENTS`, and is disposed when the portal goes. A `Collection` inside a portal follows its array. It keeps its own scope: its intent hears its elements (`DOM.select('.ok')`), and the owner's selectors don't match them.

[`ELEMENT` commands](/guide/element-commands/) (`{ focus: '.title' }`, `{ showModal: '.dialog' }`) reach the portal's content: a target that isn't in the component's own DOM is looked for in the content of the `<Portal>`s it renders.

## Moving an element with a hook

A `Portal` mounts separate content. Sometimes a component's own element has to move instead, for example a notification region that goes into the topmost open modal `<dialog>` so it stays clickable above it, and back when the dialog closes. A snabbdom `insert` hook can move the element; Sygnal keeps patching it wherever it is. Set `__sygnalHome` on the moved element to the element it came from, so its events still belong to the component:

```jsx
const intoTopModal = {
  insert: (vnode) => {
    const el = vnode.elm
    el.__sygnalHome = el.parentNode
    const modal = [...document.querySelectorAll('dialog')].find((d) => d.matches(':modal'))
    if (modal) modal.appendChild(el)
  },
}

function Notices({ state }) {
  return (
    <div className="notices-home">
      <section className="notices" hook={intoTopModal}>
        <button className="clear">Clear</button>
      </section>
    </div>
  )
}
```

With `__sygnalHome`, `DOM.click('.clear')` hears the moved button, and the event bubbles through the home to the component's parents (not to the dialog's listeners). Without it, child components inside the moved element (Collection items) still hear their own events, but the component's listeners on its own moved elements don't fire, and an element moved out of the app's root is outside the app. `DOM.select(…).elements()` and `ELEMENT` commands look inside the component's own DOM, so they don't find moved elements; give the moved element a child component for those. (An `ELEMENT` command whose target isn't in the component's own DOM is also looked for in the content of the `<Portal>`s it renders.)

## Page-wide listeners

To hear an event wherever it happens on the page, inside the portal or not, listen on the document, filtered with `.select()`:

```jsx
ModalExample.intent = ({ DOM }) => ({
  CLOSE: DOM.select('document').select('.close-btn').events('click'),
})
```

This matches the event target (or an ancestor of it) against the selector, anywhere on the page.
