---
title: "Portals"
description: "Rendering outside the component tree"
---

Render children into a DOM container outside the component's own tree. Essential for modals, tooltips, and dropdown menus that need to escape `overflow: hidden` or z-index stacking contexts.

:::tip[Dialogs, popovers and tooltips don't need a portal]
A native `<dialog>` opened with `showModal()` and an element with the `popover` attribute are drawn in the browser's top layer, above every `overflow: hidden` and z-index. Use the [`sygnal/ui`](/ui/overview/) parts for them and render their elements in place: `dialog()`, `popover()` and `tooltip()` look for their element in the component's own DOM, so inside a `<Portal>` they don't find it (the dialog never opens, and its state goes back to closed). Reach for a portal for a custom overlay that isn't one of those elements.
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

Elements in your component's own DOM tree work with `DOM.select()` as usual. However, portal content is rendered into the target container, which may be **outside** the component's isolation scope. When that's the case, `DOM.select('.close-btn').events('click')` won't match elements inside the portal.

Use document-level event delegation for portal content that renders outside the component:

```jsx
ModalExample.intent = ({ DOM }) => ({
  // Normal DOM.select works — button is in the component's own tree
  OPEN: DOM.select('.open-btn').events('click'),

  // Document-level delegation — close button is inside the portal
  CLOSE: DOM.select('document').events('click')
    .filter(e => e.target && e.target.closest && !!e.target.closest('.close-btn')),
})
```

If the portal target is a container **within** the component's own DOM subtree, normal `DOM.select()` will still work for portal content. The document-level approach is only necessary when the target is outside the component's isolation boundary (which is the typical use case for portals — rendering to `body`, `#modal-root`, etc.).

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

With `__sygnalHome`, `DOM.click('.clear')` hears the moved button, and the event bubbles through the home to the component's parents (not to the dialog's listeners). Without it, child components inside the moved element (Collection items) still hear their own events, but the component's listeners on its own moved elements don't fire, and an element moved out of the app's root is outside the app. `DOM.select(…).elements()` and `ELEMENT` commands look inside the component's own DOM, so they don't find moved elements; give the moved element a child component for those.

## Chained Document Selectors

You can also use the chained `.select()` syntax on document sources for cleaner filtering:

```jsx
ModalExample.intent = ({ DOM }) => ({
  CLOSE: DOM.select('document').select('.close-btn').events('click'),
})
```

This uses CSS selector matching on the event target internally, equivalent to the manual `.filter()` approach above.
