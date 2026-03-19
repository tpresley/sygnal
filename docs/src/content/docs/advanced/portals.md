---
title: "Portals"
description: "Rendering outside the component tree"
---

Render children into a DOM container outside the component's own tree. Essential for modals, tooltips, and dropdown menus that need to escape `overflow: hidden` or z-index stacking contexts.

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

## Chained Document Selectors

You can also use the chained `.select()` syntax on document sources for cleaner filtering:

```jsx
ModalExample.intent = ({ DOM }) => ({
  CLOSE: DOM.select('document').select('.close-btn').events('click'),
})
```

This uses CSS selector matching on the event target internally, equivalent to the manual `.filter()` approach above.
