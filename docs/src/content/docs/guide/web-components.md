---
title: Web components
description: Using custom elements (Web Awesome, Shoelace, Material Web) in Sygnal views, and publishing a Sygnal component as a custom element
---

A web component is an element: once its library has defined the tag, the browser treats `<wa-rating>` like `<input>`. Sygnal renders it, patches its properties and listens to its events the same way, so using a component library such as [Web Awesome](https://webawesome.com) needs no adapter. This page covers [using](#using-web-components) them and [publishing](#publishing-a-component-as-a-custom-element) a Sygnal component as one.

## Using web components

Load the library's elements once, at startup, then render the tags and select them by class like any element:

```jsx
// main.js
import '@awesome.me/webawesome/dist/styles/themes/default.css'
import '@awesome.me/webawesome/dist/components/rating/rating.js'
import '@awesome.me/webawesome/dist/components/input/input.js'
```

```jsx
// Review.jsx
export function Review({ state }) {
  return (
    <div>
      <wa-rating className="food" label="Food" value={state.food} />
      <wa-input className="comment" label="Comment" value={state.comment} />
      <p>{state.food} stars</p>
    </div>
  )
}

Review.initialState = { food: 3, comment: '' }

Review.intent = ({ DOM }) => ({
  FOOD: DOM.select('.food').events('change').value(Number),
  COMMENT: DOM.select('.comment').events('input').value(),
})

Review.model = {
  FOOD: (state, food) => ({ ...state, food }),
  COMMENT: (state, comment) => ({ ...state, comment }),
}
```

Web Awesome's inputs fire the standard `change` and `input` events and keep their value in a `value` property, so `.value()` reads them as it reads an `<input>`. Pointer, touch and keyboard input all arrive this way; the element handles them inside its shadow root.

### Properties and attributes

A JSX prop sets the element's **property** of that name: `value={state.food}` sets `rating.value` to the number, `readonly={state.locked}` sets a boolean property. That is what Lit-based libraries expect, and it keeps numbers, booleans, arrays and objects intact.

- **camelCase properties.** A library's `with-clear` attribute is its `withClear` property: write `withClear` (`<wa-input withClear />`). A dashed JSX prop (`with-clear`) sets a property literally named `with-clear`, which the element ignores.
- **Attributes.** For the few things that must be attributes (a `size` the library styles by, an attribute selector in your CSS, the [`name` of some form fields](#forms)), use `attrs`: `<wa-rating attrs={{ size: 'l' }} />`.
- **Load order.** A tag rendered before its library has defined it keeps the props Sygnal set, and the element takes them over when it upgrades. Defining the elements at startup, before `run()`, is still simplest.

### Events

Library events cross the shadow boundary and bubble to the host (they are `composed`), so the intent selects them on the element with any name, and `.detail()` reads their payload:

```jsx
Review.intent = ({ DOM }) => ({
  HOVER: DOM.select('.food').events('wa-hover').detail((hover) => hover.value),
  ACTION: DOM.select('.actions').events('wa-select').detail((selected) => selected.item.value),
})
```

`.detail(fn?)` maps each event to `event.detail` (or `fn(event.detail)`), next to `.value()`, `.checked()` and `.data()`. A custom event name type-checks in TypeScript (`events()` takes any string). The shorthand form `DOM['wa-hover']('.food')` works too, but `DOM.select(…).events(…)` is the one to prefer for custom names.

Events reach only the component that renders the element, as for any element: a `<wa-rating>` in each [Collection](/guide/collections/) item reports to its own item.

### Forms

Web Awesome's fields are form-associated: inside a `<form>`, they submit their value under their `name`, and [`processForm`](/reference/api/#processform) on `submit` sees them as it sees an `<input>`.

```jsx
export function Signup({ state }) {
  return (
    <form className="signup">
      <wa-input name="email" label="Email" value={state.email} />
      <wa-rating attrs={{ name: 'stars' }} label="Stars" value={state.stars} />
      <button type="submit">Sign up</button>
    </form>
  )
}

Signup.initialState = { email: '', stars: 3 }

Signup.intent = ({ DOM }) => ({
  SUBMIT: processForm(DOM.select('.signup'), { events: 'submit' }),
})

Signup.model = {
  SUBMIT: (state, { email, stars }) => ({ ...state, email, stars: Number(stars) }),
}
```

- **`name` as an attribute.** The form reads a custom element's `name` attribute. Some elements don't reflect the `name` property to the attribute (`wa-rating` doesn't, `wa-input` does), so pass it with `attrs={{ name: 'stars' }}` when in doubt.
- **Read live values from the element.** A form-associated element updates its form value asynchronously. On every keystroke, `.value()` on its `input` event is current in every browser, while the form's own data can be one keystroke behind (Firefox). Use `processForm` on `submit`, and `.value()` for live input.

### TypeScript

Web Awesome, like most Lit libraries, adds its elements to `HTMLElementTagNameMap` (`'wa-rating': WaRating`). One augmentation types every tag of a library's prefix in JSX, with the element's own property types:

```tsx
// web-awesome.d.ts
import type { IntrinsicControlProps } from 'sygnal'

type WaTags = {
  [K in keyof HTMLElementTagNameMap as K extends `wa-${string}` ? K : never]: IntrinsicControlProps<K>
}

declare global {
  namespace JSX {
    interface IntrinsicElements extends WaTags {}
  }
}
```

Then `<wa-rating value="3" />` is an error (the property is a number), and so are unknown props, methods and read-only properties. Function-valued properties are left out of the JSX props: set them with `props={{ getSymbol }}`. Event payloads are typed where you read them: `.detail<{ value: number }>()`.

### Server rendering

`renderToString` writes a custom element's props as attributes, the form its library reads when the element upgrades in the browser: `true` as a bare attribute, `false` and `null` left out. A camelCase HTML property gets its attribute (`tabIndex` → `tabindex`, `readOnly` → `readonly`, `ariaLabel` → `aria-label`); any other camelCase name is written both in kebab-case and in lowercase (`withClear` → `with-clear withclear`), since libraries differ: Web Awesome, Shoelace, Stencil and `defineElement` read `with-clear`, Lit's and FAST's default is `withclear`. The element reads the one it knows. To write one exact attribute, pass it in `attrs`. Function and object props have no attribute form and are left out; they are set on the client, when `run()` renders. Sygnal doesn't render the element's shadow DOM on the server (no declarative shadow DOM): the element renders itself once its library loads.

### As controls

Custom-element tags also work as [controls](/guide/controls/), the alternative form that names elements by identifier: `const { Rating } = controls({ Rating: 'wa-rating' })`, then `<Rating label="Service" value={state.service} />` and `DOM.select(Rating).events('wa-hover').detail()`. With the [TypeScript augmentation](#typescript), a control made from a tag is typed from the element without anything more.

## Publishing a component as a custom element

`defineElement` from `sygnal/element` goes the other way: it publishes a Sygnal component as a custom element, for plain HTML pages, other frameworks, or another Sygnal app.

```jsx
// score-card.js
import { defineElement } from 'sygnal/element'

function ScoreCard({ state }) {
  return (
    <div className="card">
      <strong>{state.title}</strong>
      <wa-rating className="score" label={state.title} value={state.score} />
    </div>
  )
}

ScoreCard.initialState = { title: 'Untitled', score: 0 }
ScoreCard.intent = ({ DOM }) => ({ SCORE: DOM.select('.score').events('change').value(Number) })
ScoreCard.model = {
  SCORE: {
    STATE: (state, score) => ({ ...state, score }),
    PARENT: (state, score) => ({ score }),
  },
}

defineElement('score-card', ScoreCard, {
  props: { title: String, score: Number },
  events: { PARENT: 'score-change' },
})
```

```html
<score-card title="Pasta" score="3"></score-card>
<script>
  document.querySelector('score-card').addEventListener('score-change', (e) => console.log(e.detail.score))
</script>
```

- **`props`** feed the component's state. Each prop is a property (`card.score = 4`) and a kebab-case attribute (`score="4"`, `due-date` for `dueDate`); attributes are parsed to the declared type.
- **`events`** map a sink to a DOM event: a value the component sends on `PARENT` is dispatched as a bubbling, composed `CustomEvent` named `score-change`, with the value as its `detail`.
- **`shadow`** (`true`, `'open'` or `'closed'`) renders into a shadow root, and **`styles`** are adopted into it.

Each element runs the component as its own app. In another Sygnal app it is a web component like any other: `<score-card className="pasta" title="Pasta" score={state.pasta} />`, and `DOM.select('.pasta').events('score-change').detail((d) => d.score)`.

## defineWidget or defineElement?

| | [`defineWidget`](/guide/widgets/) | `defineElement` (`sygnal/element`) |
|---|---|---|
| Direction | A third-party widget **into** a Sygnal view | A Sygnal component **out**, as a custom element |
| Wraps | A framework-agnostic library (flatpickr, Chart.js, Tiptap) | A Sygnal component (view, intent, model) |
| Result | A JSX tag rendering a host element, selected by class | A custom element tag, usable from any HTML |
| State | None: props in, `dispatch` out | The component's own state, fed by props |
| Events | `dispatch(name, detail)` → `CustomEvent` on the host | A sink value → `CustomEvent` on the element |
| Methods | `commands`, sent with `ELEMENT` | The element's props as properties |
| Used by | One app's views | Any page or framework |

A web component library you only use (Web Awesome) needs neither: render its tags.
