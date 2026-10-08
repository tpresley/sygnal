---
title: "Transitions"
description: "CSS enter and leave animations"
---

CSS-based enter/leave animations using snabbdom hooks. Sygnal uses a Vue-style transition system where a single `name` prop generates six CSS classes for fine-grained control over enter and leave animations.

```jsx live
import { Transition } from 'sygnal'

function AnimatedList({ state }) {
  return (
    <div>
      <button className="toggle">Toggle</button>
      <Transition name="fade">
        {state.visible && <div className="content">Animated!</div>}
      </Transition>
    </div>
  )
}

AnimatedList.initialState = { visible: true }
AnimatedList.intent = ({ DOM }) => ({ TOGGLE: DOM.click('.toggle') })
AnimatedList.model = {
  TOGGLE: (state) => ({ ...state, visible: !state.visible }),
}
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `name` | `string` | `'v'` | Base name for generated CSS classes |
| `duration` | `number` | — | Explicit timeout in ms. If omitted, listens for `transitionend` event |

## CSS Class Lifecycle

Given `name="fade"`, the following classes are applied automatically:

**On enter (element inserted):**
1. `fade-enter-from` + `fade-enter-active` added simultaneously
2. Next frame: `fade-enter-from` removed, `fade-enter-to` added
3. On transition end: `fade-enter-active` and `fade-enter-to` removed

**On leave (element removed):**
1. `fade-leave-from` + `fade-leave-active` added simultaneously
2. Next frame: `fade-leave-from` removed, `fade-leave-to` added
3. On transition end: `fade-leave-active` and `fade-leave-to` removed, then element is removed from DOM

## CSS Example

The demo above uses this stylesheet:

```css live
/* Active classes define the transition properties */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

/* "from" classes define the starting state */
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
```

## Slide Example

```css
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.3s ease;
}

.slide-enter-from {
  transform: translateX(-100%);
}

.slide-leave-to {
  transform: translateX(100%);
}
```

```jsx
<Transition name="slide">
  {state.showPanel && <div className="panel">Slides in and out</div>}
</Transition>
```

## Around a Collection

A [Collection](/guide/collections/) has no element of its own: its items are its parent's children. A `<Transition>` around it applies to **each item**: an item that is added enters, an item that is removed leaves (it keeps its place until its leave ends), and the items already there when the Collection first renders all enter. Items that don't change are left alone.

```jsx
<ul>
  <Transition name="fade">
    <Collection of={TodoItem} from="todos" />
  </Transition>
</ul>
```

This is the same as putting the `<Transition>` around the root element in the item's own view, which also works.

Two cases behave differently:

- **An item whose view returns a fragment (`<>…</>`) or text** has no element of its own to animate: its elements appear and go at once, with no enter or leave classes. Give the item one root element (`<li>`), or put a `<Transition>` around each element inside the item's view.
- **On a server-rendered page**, the client's first render [adopts the server's elements](/integration/ssr/#what-the-first-client-render-keeps), except the ones under a `<Transition>`: those are made again so their enter can run. Around a Collection, that is every item: the server's items are replaced by the client's, and each plays its enter transition when the page starts (focus or text typed into an item before start-up is lost). This is by design: the alternative is an enter that never runs.

## Explicit Duration

If your animation doesn't use CSS transitions (or you want a fixed timeout), pass `duration`:

```jsx
<Transition name="fade" duration={500}>
  {state.visible && <div>Uses setTimeout instead of transitionend</div>}
</Transition>
```
