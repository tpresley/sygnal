---
title: Adapters
description: fromZag runs a Zag.js machine as a widget tag; fromReact renders a React (or Preact) component as one. An escape hatch, with its limits
---

An adapter turns code written for another model into a Sygnal [widget](/guide/widgets/) tag: you render it with a class, read its events in the intent with `.detail()`, and send it [element commands](/guide/element-commands/), as with any widget.

- **`fromZag`** (`sygnal/zag`) runs a [Zag.js](https://zagjs.com) state machine and renders its parts with Sygnal JSX. It is what [Menu](/ui/menu/), [Select](/ui/select/) and [Combobox](/ui/combobox/) are built on.
- **`fromReact`** (`sygnal/react`) renders a React component, or a Preact one through `preact/compat`.

**Adapters are an escape hatch.** Reach for one for the component you can't replace, not as a way to build the app. First look for a native answer (`<dialog>`, the Popover API, [`sygnal/ui`](/ui/overview/)), a [web component](/guide/web-components/), or a framework-agnostic library through [`defineWidget`](/guide/widgets/). A React component in a Sygnal app:

- **brings its runtime**: React and react-dom add about 68 KB gzipped (Preact through `preact/compat` about 8 KB);
- **doesn't see your context or providers**: React context, a theme provider, a router or a query client from a React tree don't cross the boundary, and Sygnal's `.context` doesn't reach the component. Pass what it needs as props;
- **can render outside its host**: a React portal (a modal, a tooltip) goes where React puts it, so Sygnal's `DOM.select` doesn't see events from it; use the component's callbacks instead;
- **doesn't run in the mock DOM**: test it with `renderComponent(App, { dom: 'real' })` (jsdom or a browser).

The libraries are optional peer dependencies of `sygnal`: an app that doesn't import an adapter never installs or ships them. When one is missing, `sygnal/vite` names it ([SYG666](/reference/errors/#syg666)).

## React components: fromReact

```bash
npm install react react-dom
```

```jsx
// Stars.js
import { fromReact } from 'sygnal/react'
import { Rating } from 'some-react-rating'

export const Stars = fromReact(Rating, { events: { rate: 'onChange' } })
```

```jsx
// Review.jsx
import { Stars } from './Stars.js'

export function Review({ state }) {
  return (
    <div>
      <Stars className="rating" value={state.rating} max={5} />
      <p>{state.rating} of 5</p>
    </div>
  )
}

Review.initialState = { rating: 0 }
Review.intent = ({ DOM }) => ({
  RATE: DOM.select('.rating').events('rate').detail(),
})
Review.model = {
  RATE: (state, rating) => ({ ...state, rating }),
}
```

The tag renders a host `<div class="rating">` and a React root inside it. Every render passes the newest props to the component (`value`, `max`); the props are routed between the host and the component:

| Props | Go to |
|---|---|
| `className`, `class`, `id`, `style`, `attrs`, `tabIndex`, `hidden` | the host only (one tab stop) |
| `aria-*`, `role`, `title` | the component only: a React control names itself, so `<IconButton aria-label="Delete" />` labels the component's `<button>`, not the generic host `<div>` |
| `data-*` | both |
| everything else | the component (`name`, `placeholder`, `lang` and `dir` also go on the host, as for any widget) |

List a host prop in `ownProps` to send it to the component instead, or a component-only one in `hostProps` to put it on the host too. When the component calls `onChange(4)`, the adapter dispatches a `rate` event on the host with `4` as its detail. When the host leaves the page (also inside a shadow root, as with `sygnal/element`'s `shadow: true`), the React root unmounts; a host that is destroyed but stays in the page is unmounted after 10 seconds.

| Option | |
|---|---|
| `events` | `{ eventName: 'onCallback' }`: each callback prop becomes a DOM event with that name. An array (`['onChange']`) uses the callback's own name as the event name. The detail is the callback's argument, or an array of them when it gets several. A callback you pass as a prop still runs, first |
| `props` | `(props) => componentProps`, when the component's props differ from the tag's |
| `commands` | Element commands, called with `{ root, el, props }` |
| `tag`, `name`, `fallback`, `hostProps`, `ownProps` | As in [`defineWidget`](/guide/widgets/#the-definition) |

Prefer event names of your own (`'rate'`) to the browser's (`'change'`): the component's own `<input>`s fire native `change` events that bubble out of the host too.

### Preact

The adapter uses only `createElement` (from `react`), `createRoot` (from `react-dom/client`) and `flushSync` (from `react-dom`), which `preact/compat` provides. Alias the React packages in the bundler, and the same adapter and the same component code run on Preact:

```js
// vite.config.js
import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'

export default defineConfig({
  plugins: [sygnal()],
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom/client': 'preact/compat/client',
      'react-dom': 'preact/compat',
    },
  },
})
```

```bash
npm install preact
```

## Zag machines: fromZag

[Zag.js](https://zagjs.com) implements UI patterns (menus, comboboxes, date pickers, sliders) as framework-agnostic state machines, with the keyboard and ARIA work done. `fromZag(zag, render, options)` runs one on a widget host:

```bash
npm install @zag-js/vanilla@~1.45.0 @zag-js/menu@~1.45.0
```

```jsx
// Actions.jsx
import { fromZag } from 'sygnal/zag'
import * as menu from '@zag-js/menu'

export const Actions = fromZag(menu, (api, props) => (
  <div>
    <button {...api.getTriggerProps()}>{props.label}</button>
    <div {...api.getPositionerProps()}>
      <ul {...api.getContentProps()}>
        {props.items.map((item) => <li {...api.getItemProps({ value: item })}>{item}</li>)}
      </ul>
    </div>
  </div>
), {
  name: 'Actions',
  events: { pick: ['onSelect', (details) => details.value] },
  commands: { open: (api) => api.setOpen(true) },
})
```

```jsx
// Toolbar.jsx
import { Actions } from './Actions.jsx'

export function Toolbar({ state }) {
  return <div><Actions className="actions" label="Edit" items={['cut', 'copy', 'paste']} /><p>{state.last}</p></div>
}

Toolbar.initialState = { last: '' }
Toolbar.intent = ({ DOM }) => ({
  PICK: DOM.select('.actions').events('pick').detail(),
})
Toolbar.model = {
  PICK: (state, last) => ({ ...state, last }),
}
```

- **`zag`** is the machine package as a namespace (`import * as menu from '@zag-js/menu'`): its `machine` and `connect`.
- **`render(api, props, instance)`** returns one element. `api` is the machine's connected API: spread its prop getters on your elements (`{...api.getTriggerProps()}`); they carry the ARIA attributes, the ids and the event handlers. It runs again whenever the machine's state changes and when the tag gets new props, and the result is patched into the host. Render **plain elements only**: the adapter patches the result itself, outside the component tree, so a Sygnal component, a widget tag or special JSX (`<Transition>`, `<Portal>`, `<Collection>`…) inside it doesn't run. Pass data in through the tag's props, and keep components and widgets around the tag in the view ([SYG669](/reference/errors/#syg669) in dev).
- **Props** go to the machine as they are (`open`, `value`, `positioning`...), always the newest ones: a controlled prop such as `open={state.menuOpen}` drives the machine. `options.props(props, instance)` maps them when they differ (Select turns `value: 'm'` into Zag's `['m']`).
- **`events`**: `{ eventName: 'onCallback' }` dispatches the callback's details object; `{ eventName: ['onCallback', (details) => detail] }` dispatches what the function returns.
- **`commands`**: `{ name: (api, options, instance) => … }` for `ELEMENT`.

Pin Zag's version (`~1.45.0`, all packages the same): the adapter uses `@zag-js/vanilla`'s machine runtime, whose API changes in Zag 2.0.

## Testing

In the default mock DOM, an adapter's tag renders its host and nothing runs inside it. `t.widget(selector)` gives the props the view passed and dispatches the adapter's events, so the component's logic can be tested without React or Zag:

```jsx
import { it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { Review } from './Review.jsx'

it('stores the rating', async () => {
  const t = renderComponent(Review)
  await t.ready()
  t.widget('.rating').dispatch('rate', 4)
  await t.next((state) => state.rating === 4)
  expect(t.widget('.rating').props.value).toBe(4)
  t.dispose()
})
```

To run the React component or the machine itself, use `renderComponent(Review, { dom: 'real' })` (in a jsdom test environment), click with `t.query(...)`, and wait for the state with `t.next`. Zag's positioning and list scrolling use `ResizeObserver`, `CSS.escape` and `Element.prototype.scrollTo`, which jsdom lacks: while a `dom: 'real'` test runs, `renderComponent` adds the missing ones (a `ResizeObserver` that observes nothing, a `scrollTo` that does nothing) and removes them when the last test instance is disposed. An implementation the environment already has is kept. Outside `renderComponent` (a test that calls `run()` itself), stub them in a setup file.

## Server rendering

`renderToString` renders an adapter's host with its `fallback` inside, like any widget; React and Zag run only in the browser. The client's first render replaces the fallback.

## Size

Gzipped, added to a small app:

| | Adds |
|---|---|
| `fromReact` with React 19 + react-dom | 68 KB (the adapter itself: 0.6 KB) |
| `fromReact` with `preact/compat` | 8 KB |
| `fromZag` with Zag's dialog machine | 20 KB (the adapter itself: 2 KB) |
| [Menu](/ui/menu/), [Select](/ui/select/), [Combobox](/ui/combobox/) | 33–34 KB each, 47 KB for the three |

## Diagnostics

| Code | When |
|---|---|
| [SYG666](/reference/errors/#syg666) | An adapter entry is imported, but a package it needs isn't installed (`sygnal/vite`) |
| [SYG667](/reference/errors/#syg667) | `fromZag` or `fromReact` got something that isn't a machine package or a component |
| [SYG669](/reference/errors/#syg669) | A `fromZag` render returned a Sygnal component, a widget tag or special JSX, which can't run there (dev) |

The widget codes ([SYG140–144](/guide/widgets/#diagnostics), [SYG660–662](/reference/errors/#syg660)) apply to adapters as to any widget.
