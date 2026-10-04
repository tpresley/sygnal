---
title: View Transitions
description: Animate the change an action makes to the page with the browser's View Transition API, using the viewTransitions static and makeViewTransitionDOMDriver()
---

A component lists the actions whose change to the page should animate, and the browser does the animation with its [View Transition API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API): it takes a snapshot of the page, Sygnal applies the new render, and the browser animates each named element from its old place and size to its new one.

```jsx
Board.viewTransitions = ['MOVE']
```

This suits discrete changes: a card that moves to another list, a row that is removed, a page that replaces another. Each element keeps its identity through a `view-transition-name`, so a card that leaves one [Collection](/guide/collections/) and appears in another flies across, even though Sygnal renders a new element for it.

## Setup

The transitions are run by the DOM driver from `makeViewTransitionDOMDriver()`. Give it to `run()` in place of the default DOM driver, with the same mount point:

```javascript
import { run, makeViewTransitionDOMDriver } from 'sygnal'
import { Board } from './Board.jsx'

run(Board, { DOM: makeViewTransitionDOMDriver('#root') })
```

It is the DOM driver that `run()` creates by default (it also takes the same options as `makeDOMDriver`), plus the code that holds a render and applies it inside a View Transition. It is a separate export so that apps without View Transitions don't ship that code. A component that declares `viewTransitions` in an app without it gets [SYG645](/reference/errors/#syg645) in development, and its actions update the page at once.

## The viewTransitions static

`viewTransitions` is a list of the component's action names. When one of those actions changes the state, the render it causes is applied inside `document.startViewTransition()`. Other actions update the page as usual, at once.

- Only actions with a `STATE` change ask for a transition. An action that returns `ABORT`, or only has non-STATE sinks, renders nothing new.
- The transition covers the whole render, including the changes in child components and Collections that the new state causes.
- Any component of the app can declare it, not only the root: a list item can list its own `REMOVE`.
- It must be an array, even for one action. A value that isn't (`true`, `'MOVE'`) lists no action, and development reports [SYG645](/reference/errors/#syg645).

## Recipe: moving cards between lanes

Each card is an item of one of two Collections. Its `Move` button sends its id to the board, which moves the card to the other lane:

```jsx
// Card.jsx
export function Card({ state }) {
  return (
    <li className="card" style={{ viewTransitionName: `card-${state.id}`, viewTransitionClass: 'card' }}>
      <span>{state.title}</span>
      <button type="button" className="move">Move</button>
    </li>
  )
}

Card.intent = ({ DOM }) => ({ MOVE: DOM.click('.move') })

Card.model = {
  MOVE: { PARENT: (state) => ({ id: state.id }) },
}
```

```jsx
// Board.jsx
import { Collection } from 'sygnal'
import { Card } from './Card.jsx'

export function Board({ state }) {
  return (
    <div className="board">
      <section className="lane" style={{ viewTransitionName: 'lane-todo', viewTransitionClass: 'lane' }}>
        <h2>To do</h2>
        <ul><Collection of={Card} from="todo" /></ul>
      </section>
      <section className="lane" style={{ viewTransitionName: 'lane-done', viewTransitionClass: 'lane' }}>
        <h2>Done</h2>
        <ul><Collection of={Card} from="done" /></ul>
      </section>
    </div>
  )
}

Board.initialState = {
  todo: [{ id: 1, title: 'Write the docs' }, { id: 2, title: 'Ship it' }],
  done: [],
}

Board.intent = ({ CHILD }) => ({ MOVE: CHILD.select(Card) })

Board.model = {
  MOVE: (state, { id }) => {
    const from = state.todo.some((card) => card.id === id) ? 'todo' : 'done'
    const to = from === 'todo' ? 'done' : 'todo'
    const card = state[from].find((c) => c.id === id)
    return { ...state, [from]: state[from].filter((c) => c.id !== id), [to]: [...state[to], card] }
  },
}

Board.viewTransitions = ['MOVE']
```

The names must be unique on the page at the moment of the transition: `card-${state.id}` gives each card its own. If two elements share a name, the browser skips the whole transition (Chrome logs "Unexpected duplicate view-transition-name") and the page updates at once.

The browser's default animation needs two fixes for this layout, in CSS:

```css
/* the moving card flies above the lanes, not under the lane it moves to */
::view-transition-group(*.card) {
  z-index: 1;
}

/* a lane that grows or shrinks: show its new content at its natural size, clipped to the
   lane's animating box, instead of stretching and cross-fading two snapshots */
::view-transition-old(*.lane) {
  animation: none;
  opacity: 0;
}
::view-transition-new(*.lane) {
  animation: none;
  height: 100%;
  object-fit: none;
  object-position: top;
}
```

- **Z-order.** The browser paints the transition's snapshots in the order the elements were painted before the change. A card that moves from the first lane to the second would pass under the second lane's snapshot. The `card` class (`view-transition-class`) lets one rule raise every card.
- **Lanes that change size.** By default the old and new snapshots of a lane cross-fade while its box animates between the two heights, so the old lane's content shows through as a ghost, stretched to the new size. Hiding the old snapshot and showing the new one unscaled, from the top, gives a lane that grows or shrinks smoothly around the cards.

`view-transition-class` is newer than the API itself (Chrome and Edge 125, Safari 18.2). Where it is missing, the rules with `*.card` and `*.lane` don't apply and the default animation runs, with the card passing under the second lane.

## Route changes

The [router](/guide/router/)'s reply action is an action like any other. To animate every route change, list it on the component that declares the route:

```jsx
App.route = 'ROUTE'
App.viewTransitions = ['ROUTE']
```

With no names on the pages' elements, the browser cross-fades the whole page. Name the parts that stay (a header, a sidebar) to keep them still, and the parts that should move from one page to the other (a thumbnail that becomes the page's hero image) to animate them. The first render of the app is never animated: there is no page to animate from.

## How the render is applied

One action can update the page several times: a card that moves between Collections is removed from one lane, and appears in the other a few milliseconds later, when its new component has rendered. The driver therefore:

1. holds the first render after the action, and calls `document.startViewTransition()`;
2. when the browser has taken its snapshot, applies the held render and every render that follows, until 20 ms pass with no new render (at most 200 ms, so a page that renders continuously, with a timer or a stream of messages, can't freeze it);
3. lets the browser animate from the snapshot to the final page.

The page shows the old snapshot during step 2, so the in-between states never appear.

The first render after the action is the one held, however long the render takes. If the action's new state renders nothing new (it is equal to the old one), there is no render to hold: the request lapses once the page has been idle for 100 ms, so a later, unrelated update isn't animated.

If an action asks for a new transition while one is still animating, the browser skips the running one: its elements jump to their end positions, and the new one starts from there.

## Limits

- **The page doesn't respond during a transition.** While the browser animates (250 ms by default, plus the 20 ms wait), the transition's overlay is on top of the page: clicks and hovers go to it, not to the elements, and a click in that time is lost. That is fine for a discrete change the user just asked for, and wrong for an interaction that continues.
- **Not for drag-sort or typing-driven lists.** Reordering a list while the user drags an item, or filtering it on every keystroke, starts a transition per change: the page stops responding, and each new transition skips the last one, so items jump instead of gliding. For those, animate the moved items with FLIP: measure their positions before and after the render and animate `transform`, which leaves the page interactive.
- **Rapid actions jump.** Several listed actions in quick succession end with the right page, but each skips the previous transition, so the motion jumps.
- **Names are your job.** The browser matches old and new elements only by `view-transition-name`. Elements without one are part of the page's snapshot, which cross-fades as a whole.

## Reduced motion and browser support

Under `prefers-reduced-motion: reduce`, the driver applies every render at once, without a transition.

`document.startViewTransition()` (same-document transitions) is supported in Chrome and Edge 111, Safari 18 and Firefox 144. In browsers without it, the driver applies every render at once, with no error. So `viewTransitions` is safe to declare everywhere: it only adds animation where the browser can do it.

## Testing

`renderComponent()` never animates: its mock DOM, and its real DOM (`dom: 'real'`), apply every render at once, and it doesn't report SYG645. Test the state change as usual:

```jsx
import { renderComponent } from 'sygnal'
import { Board } from './Board.jsx'

const t = renderComponent(Board)
await t.ready()
t.simulateAction('MOVE', { id: 1 })
await t.next((state) => state.done.length === 1)
```

To check the transition itself, run the app in a real browser (Playwright, the browser's devtools Animations panel) or replace `document.startViewTransition` with a spy.
