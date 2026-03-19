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

Portal content is rendered outside the component's DOM tree, so `DOM.select('.close-btn').events('click')` won't work for elements inside the portal. Use document-level event delegation:

```jsx
ModalExample.intent = ({ DOM }) => ({
  OPEN: DOM.select('.open-btn').events('click'),
  CLOSE: DOM.select('document').events('click')
    .filter(e => e.target && e.target.closest && !!e.target.closest('.close-btn')),
})
```
