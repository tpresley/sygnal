---
title: Icons (Lucide)
description: Lucide icons in Sygnal views with a ten-line helper, tree-shaken per icon, decorative or labelled
---

[Lucide](https://lucide.dev/) has about 1,600 icons. Its framework-neutral package, `lucide`, exports each icon as plain data: a list of SVG elements and their attributes. A small helper turns that data into Sygnal SVG vnodes, so an icon is part of the view like any other markup: it is patched, server-rendered and tested in the mock DOM.

## Install

```sh
npm install lucide
```

## The helper

```jsx
// icon.jsx
// A Lucide icon (an array of [tag, attributes, children?]) as Sygnal SVG vnodes
const parts = (node) => node.map(([Tag, attrs, children]) => <Tag {...attrs}>{children && parts(children)}</Tag>)

export function icon(node, { label, size = 24 } = {}) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'}>
      {parts(node)}
    </svg>
  )
}
```

`icon` is a plain function that returns vnodes, not a component: call it in the view (`{icon(Plus)}`), don't render it as a tag. A component per icon would cost an instance, a state and a stream for each one, for markup that never changes.

The `<svg>` gets Lucide's default attributes (a 24 × 24 view box, a 2-pixel round stroke in `currentColor`, so the icon takes the text colour). Inside an `<svg>`, Sygnal's JSX sets every prop as an attribute in the SVG namespace, so the data's `d`, `cx` or `points` work as written.

## Using it

```jsx
// Toolbar.jsx
import { Plus, Trash2, CloudCheck, CloudOff } from 'lucide'
import { icon } from './icon.jsx'

export function Toolbar({ state }) {
  return (
    <div role="toolbar" aria-label="Items">
      <button className="add">{icon(Plus)} Add</button>
      <button className="remove" aria-label="Remove the last item">{icon(Trash2)}</button>
      <span className="status">
        {state.online ? icon(CloudCheck, { label: 'Saved' }) : icon(CloudOff, { label: 'Offline' })}
      </span>
      <span className="count">{state.count} items</span>
    </div>
  )
}

Toolbar.initialState = { count: 0, online: true }

Toolbar.intent = ({ DOM }) => ({
  ADD: DOM.click('.add'),
  REMOVE: DOM.click('.remove'),
})

Toolbar.model = {
  ADD: (state) => ({ ...state, count: state.count + 1 }),
  REMOVE: (state) => ({ ...state, count: Math.max(0, state.count - 1) }),
}
```

Three cases, three ways to make the icon accessible:

| Icon | Example | How |
|---|---|---|
| Next to text that says the same | **Add** | Decorative: no label, so the helper sets `aria-hidden="true"`. |
| The only content of a button or link | **Remove** | The button carries the name (`aria-label`); the icon stays hidden. |
| Meaning on its own, no text | **Saved / Offline** | Pass `label`: the icon gets `role="img"` and an `aria-label`. |

sygnal-check reports a button with no accessible name ([SYG705](/reference/errors/#syg705)) when the `<svg>` is written inside it, but it doesn't look into `icon(...)`: a function call could return text, so `<button>{icon(Trash2)}</button>` passes the check. Give every icon-only button its `aria-label` yourself, and assert it in a test as below.

```css
.icon { vertical-align: -0.125em; width: 1.25em; height: 1.25em; }
```

## Testing

```jsx
// Toolbar.test.jsx
import { test, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { Toolbar } from './Toolbar.jsx'

test('decorative icons are hidden, a meaningful icon has a name', async () => {
  const t = renderComponent(Toolbar)
  await t.ready()
  expect(t.query('.add svg').getAttribute('aria-hidden')).toBe('true')
  expect(t.query('.remove svg').getAttribute('aria-hidden')).toBe('true')
  expect(t.query('.remove').getAttribute('aria-label')).toBe('Remove the last item')
  expect(t.query('.status svg').getAttribute('role')).toBe('img')
  expect(t.query('.status svg').getAttribute('aria-label')).toBe('Saved')
  expect(t.queryAll('.add svg path').length).toBe(2)

  t.simulateEvent('.add', 'click')
  await t.next((state) => state.count === 1)
  expect(t.query('.count').textContent).toBe('1 items')
  t.dispose()
})
```

## Size

Each icon is a few hundred bytes. Measured with Vite, minified and gzipped, Sygnal not included: the four icons and the helper above add **0.9 KB**. Import icons by name (`import { Plus } from 'lucide'`) so the bundler drops the rest.

## Pitfalls

- **Don't look icons up by name at runtime.** `import { icons } from 'lucide'` and `icons[name]` keep every icon in the bundle: 94 KB instead of 0.9. Map the names you need yourself: `const STATUS = { saved: CloudCheck, offline: CloudOff }`.
- **Don't use `createIcons()`.** It replaces `<i data-lucide="...">` elements in the page with SVG after the fact; Sygnal owns those elements and puts its own back on the next render. `createElement(Plus)` from `lucide` returns a DOM element, which is useful inside a [widget](/guide/widgets/)'s `mount`, not in a view.
- **Icon-only buttons need a name.** The icon is hidden from screen readers, so the button must say what it does.
- **Not `lucide-react`.** The React package returns React elements; use `lucide`, whose icons are plain data.
