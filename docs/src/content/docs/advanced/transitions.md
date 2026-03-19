---
title: "Transitions"
description: "CSS enter and leave animations"
---

CSS-based enter/leave animations using snabbdom hooks:

```jsx
import { Transition } from 'sygnal'

function AnimatedList({ state }) {
  return (
    <div>
      <Transition enter="fade-in" leave="fade-out" duration={300}>
        {state.visible && <div className="content">Animated!</div>}
      </Transition>
    </div>
  )
}
```

The `enter` class is added when the element is inserted, and `leave` class is added before removal. The element is kept in the DOM for `duration` milliseconds during the leave transition.
