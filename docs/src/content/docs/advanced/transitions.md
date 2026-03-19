---
title: "Transitions"
description: "CSS enter and leave animations"
---

CSS-based enter/leave animations using snabbdom hooks. Sygnal uses a Vue-style transition system where a single `name` prop generates six CSS classes for fine-grained control over enter and leave animations.

```jsx
import { Transition } from 'sygnal'

function AnimatedList({ state }) {
  return (
    <div>
      <Transition name="fade">
        {state.visible && <div className="content">Animated!</div>}
      </Transition>
    </div>
  )
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

```css
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

## Explicit Duration

If your animation doesn't use CSS transitions (or you want a fixed timeout), pass `duration`:

```jsx
<Transition name="fade" duration={500}>
  {state.visible && <div>Uses setTimeout instead of transitionend</div>}
</Transition>
```
