---
title: Styling
description: Style Sygnal components with CSS files, CSS Modules or Tailwind, pass dynamic values through custom properties, and keep class names that double as event hooks working
---

Sygnal renders real DOM and has no styling system of its own, so anything that produces CSS and class names works: plain stylesheets, CSS Modules, Tailwind, a design system. This page covers the parts that are specific to Sygnal: which values `class` and `style` take, and how a class that styles an element can also be the one your intent listens to.

## Classes

`className` and `class` both take a string, an array or an object. Arrays nest, and falsy entries are skipped:

```jsx
<>
  <li className="task" />
  <li class={{ task: true, done: state.done }} />
  <li class={['task', state.done && 'done', { urgent: state.urgent }]} />
  <li class={{ 'p-4 m-2': state.roomy }} />
</>
```

Object keys can hold several names. The [`classes()`](/reference/utilities/#classes) helper does the same work and returns a string.

## A class is also an event hook

`DOM.click('.save')` finds the element by its class, so any tool that changes the class name you wrote also changes what the intent has to select. Give the element a plain hook class next to whatever styles it:

```jsx
// Save.jsx
import s from './Save.module.css'

export function Save() {
  return <button className={`save ${s.button} hover:underline`}>Save</button>
}

Save.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
```

- **A CSS Modules class is hashed.** `className={s.save}` renders something like `_save_1old6_1`, so `DOM.click('.save')` never fires. Add a hook class as above, select the real name with `` DOM.click(`.${s.save}`) ``, or use a [control](/guide/controls/).
- **A Tailwind variant isn't a selector.** In `.hover:bg-red-500` the `:` starts a pseudo-class that doesn't exist, so matching throws on every event and the component's other listeners stop too. Select a hook class instead.

[`sygnal-check`](/guide/diagnostics/) reports both: [SYG110](/reference/errors/#syg110) for the hashed class and [SYG108](/reference/errors/#syg108) for the invalid selector.

## Stylesheets

Import a stylesheet from any module, and Vite bundles it:

```js
// main.js
import './styles.css'
```

Editing it in development updates the page without touching the DOM or the state.

Classes are global, so name them with care or use one of the options below. On a server-rendered page, `renderToString` emits no `<style>` or `<link>` tags: the CSS is the job of the build and your [SSR integration](/integration/ssr/).

## CSS Modules

A file named `*.module.css` gives you locally scoped class names with no setup, and the server build produces the same names as the client:

```css title="Card.module.css"
.card { padding: 1rem; }
.card > h2 { margin: 0; }
```

```jsx
// Card.jsx
import s from './Card.module.css'

export function Card({ state }) {
  return <section className={s.card}><h2>{state.title}</h2></section>
}
```

Editing a `.module.css` file in development keeps the state, but replaces the DOM elements that use it, because the hashed names change.

CSS Modules hash class names only, so a rule for a bare element (`p { … }`) still applies everywhere. For those, nest them under a class, or use [`@scope`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@scope) inside the module:

```css title="Card.module.css"
@scope (.card) to (.inner) {
  p { color: gray; }
}
```

Make the scope's root a class. Sygnal marks no component boundaries in the DOM, so a scope reaches into child components unless you stop it with `to (…)`.

Don't render a `<style>` inside a component that appears many times. One `<style>` per row in a 1,000-row list took WebKit about 70 times longer to restyle than a shared sheet.

## Tailwind

Tailwind v4 needs no integration. Add its Vite plugin next to Sygnal's:

```bash
npm install tailwindcss @tailwindcss/vite
```

```js
// vite.config.js
import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({ plugins: [tailwindcss(), sygnal()] })
```

```css title="styles.css"
@import "tailwindcss";
```

Tailwind finds classes by scanning your source as plain text, so every class name has to appear whole. `state.on && 'bg-red-500'` is fine; `` `bg-${color}-500` `` generates nothing.

[cva](https://cva.style/docs) and [tailwind-merge](https://github.com/dcastil/tailwind-merge) work as they do anywhere, and a hook class passes through both.

Preflight gives `[hidden]` `display: none !important`, so a `flex` utility can't show a panel that has the `hidden` attribute.

## Dynamic values

Keep the rules in your CSS and pass only the changing values, as custom properties:

```css live
.swatch { padding: 1rem; border-radius: 8px; color: white; background: hsl(var(--hue) 80% 40%); }
```

```jsx live
// Swatch.jsx
function Swatch({ state }) {
  return (
    <div className="swatch" style={{ '--hue': state.hue }}>
      <label>Hue <input className="hue" type="range" min="0" max="360" value={state.hue} /></label>
    </div>
  )
}

Swatch.initialState = { hue: 200 }
Swatch.intent = ({ DOM }) => ({ HUE: DOM.input('.hue').value(Number) })
Swatch.model = { HUE: (state, hue) => ({ ...state, hue }) }
```

The `style` prop takes an object or a string:

```jsx
<>
  <div style={{ width: `${state.width}px`, opacity: 0.5, '--hue': state.hue }} />
  <div style="color: red" />
</>
```

- Values are written to the element as CSS, so a length needs its unit. `{ width: 10 }` is invalid CSS and does nothing, unlike in React ([SYG109](/reference/errors/#syg109) reports it). `0` and unitless properties such as `opacity` are fine.
- `null`, `undefined`, `''` and booleans clear the property, so `{ color: state.on && 'red' }` works.
- Property names are camelCase or kebab-case. Custom properties are written as they are, and they're case-sensitive.

## State as data attributes

For states with names, a data attribute keeps the rule in CSS and the state out of the class list:

```css live
.panel { padding: 0.5rem; border: 1px solid gray; }
.panel[data-state='open'] { background: lightyellow; }
```

```jsx live
// Panel.jsx
function Panel({ state }) {
  return (
    <div>
      <button className="toggle">Toggle</button>
      <div className="panel" data-state={state.open ? 'open' : 'closed'}>{state.open ? 'Open' : 'Closed'}</div>
    </div>
  )
}

Panel.initialState = { open: false }
Panel.intent = ({ DOM }) => ({ TOGGLE: DOM.click('.toggle') })
Panel.model = { TOGGLE: (state) => ({ ...state, open: !state.open }) }
```

Tailwind's `data-[state=open]:bg-yellow-100` targets the same attribute, and the [`sygnal/ui`](/ui/overview/#styling) parts set `data-state` for you.

## Animation

Use [`<Transition>`](/advanced/transitions/) for enter and leave animations and [View Transitions](/guide/view-transitions/) for moves. With Tailwind, put the classes `<Transition>` generates in your stylesheet:

```css title="styles.css"
.fade-enter-active, .fade-leave-active { @apply transition-opacity duration-500; }
.fade-enter-from, .fade-leave-to { @apply opacity-0; }
```

Or use arbitrary variants on the element, with a `name` of your choosing (here `tw`):

```jsx
<Transition name="tw">
  {state.show && <div className="transition-opacity duration-500 [&.tw-enter-from]:opacity-0 [&.tw-leave-to]:opacity-0">Hello</div>}
</Transition>
```

## Content Security Policy

Under a `style-src` without `'unsafe-inline'`:

| What | Allowed? |
|---|---|
| `<link rel="stylesheet">` from an allowed origin | Yes |
| `style` on the client (Sygnal writes through the CSSOM) | Yes |
| `adoptedStyleSheets` | Yes |
| `style` in server-rendered HTML | No: it's a `style` attribute. Needs `style-src-attr 'unsafe-inline'`, or move the value to a class |
| `<style>` in a view | Only with a matching nonce (`attrs={{ nonce }}`) |

## Other targets

- **Web components:** `defineElement`'s [`shadow` and `styles`](/guide/web-components/) adopt a stylesheet into the shadow root.
- **Terminal and React Native:** these take their own rules, not CSS. See the [terminal stylesheet](/renderers/terminal/#the-terminal-stylesheet) and [React Native styles](/renderers/react-native/#styles). There a number in `style` is a cell count or density-independent points.
- **[`sygnal/primitives`](/renderers/react-native/):** style objects follow React Native, so a number becomes `px` on the web.
- **[Sandboxed components](/advanced/sandboxed-components/#styling):** inline `style` is filtered and `<style>` is dropped.
