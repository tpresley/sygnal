---
title: Menu
description: An accessible menu button (WAI-ARIA menu) from sygnal/ui/menu, built on the Zag.js menu machine
---

`Menu` is a menu button: a trigger that opens a list of actions, following the [WAI-ARIA menu button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/). The keyboard handling, focus management and typeahead come from [Zag.js](https://zagjs.com)'s menu machine; Sygnal renders it with [`fromZag`](/guide/adapters/#zag-machines-fromzag). It is a [widget](/guide/widgets/) tag: render it with a class, and read its events in the intent like any element's.

```jsx live live-height=230
import { Menu } from 'sygnal/ui/menu'

const ACTIONS = [
  { value: 'rename', label: 'Rename' },
  { value: 'duplicate', label: 'Duplicate' },
  { separator: true },
  { value: 'delete', label: 'Delete' },
]

function Card({ state }) {
  return (
    <div className="card">
      <h3>{state.title}</h3>
      <Menu className="card-actions" label="Actions" items={ACTIONS} />
      <p>{state.last ? `Last action: ${state.last}` : ''}</p>
    </div>
  )
}

Card.initialState = { title: 'Groceries', last: '' }
Card.intent = ({ DOM }) => ({
  ACTION: DOM.select('.card-actions').events('select').detail(),
})
Card.model = {
  ACTION: (state, last) => ({ ...state, last }),
}
```

`DOM.select('.card-actions').events('select').detail()` gives the value of the item the user picked (`'rename'`). The menu closes and the focus goes back to the trigger.

## Install

Each Zag-based part has a subpath of its own (`sygnal/ui/menu`, `sygnal/ui/select`, `sygnal/ui/combobox`), so `sygnal/ui` (Dialog, Popover, Tabs…) never needs Zag, and a part needs only Zag's runtime and its own machine. They are optional peer dependencies of `sygnal`; install them in one version:

```bash
npm install @zag-js/vanilla@~1.45.0 @zag-js/menu@~1.45.0       # Menu (sygnal/ui/menu)
npm install @zag-js/vanilla@~1.45.0 @zag-js/select@~1.45.0     # Select (sygnal/ui/select)
npm install @zag-js/vanilla@~1.45.0 @zag-js/combobox@~1.45.0   # Combobox (sygnal/ui/combobox)
```

Without them, `sygnal/vite` stops with [SYG666](/reference/errors/#syg666), which names the missing packages.

## Props

| Prop | | |
|---|---|---|
| `label` | (required) | The trigger's text: its accessible name |
| `aria-label`, `aria-labelledby`, `aria-describedby` | | Name or describe the trigger when there is no visible `label` (or in addition to it); they go on the trigger, not the host |
| `items` | (required) | Strings, or `{ value, label, disabled }` objects; `{ separator: true }` draws a separator |
| `open` | | Controlled open state; follow the `open-change` event |
| `defaultOpen` | `false` | |
| `closeOnSelect` | `true` | `false` keeps the menu open after a pick |
| `loopFocus` | `false` | The arrow keys wrap from the last item to the first |
| `typeahead` | `true` | Typing a letter moves to the next item starting with it |
| `positioning` | | Zag's positioning options: `{ placement: 'bottom-end', gutter: 4 }` |
| `dir` | `'ltr'` | |

`className`, `id`, `style` and `aria-*` / `data-*` props go on the host `<div>`.

## Events and commands

| Event | Detail |
|---|---|
| `select` | The value of the item picked |
| `open-change` | `true` when it opens, `false` when it closes |

Open or close it from the model with an [element command](/guide/element-commands/) on its class: `OPEN_ACTIONS: { ELEMENT: { open: '.card-actions' } }`, or `{ close: '.card-actions' }`.

## Keyboard

| Key | |
|---|---|
| Enter, Space, Down | On the trigger: open the menu on the first item (Up: on the last) |
| Down / Up | The next / previous item; disabled items are skipped |
| Home / End | The first / last item |
| A letter | The next item that starts with it |
| Enter, Space | Pick the highlighted item and close |
| Escape, Tab | Close; Escape returns the focus to the trigger |

A click outside closes it too.

## Styling

The parts carry Zag's data attributes: `[data-scope="menu"]` with `[data-part="trigger"]`, `"positioner"`, `"content"`, `"item"` and `"separator"`; the content and trigger have `data-state="open" | "closed"`, an item `data-highlighted` and `data-disabled`. The content is `hidden` while closed, and the positioner places it with `position` and CSS variables (`--x`, `--y`).

```css live
.card-actions [data-part='content'] { background: Canvas; border: 1px solid #ddd; border-radius: 6px; padding: 4px; }
.card-actions [data-part='item'] { padding: 4px 8px; border-radius: 4px; cursor: default; }
.card-actions [data-part='item'][data-highlighted] { background: rgb(99 102 241 / 0.25); }
.card-actions [data-part='item'][data-disabled] { opacity: 0.5; }
```

## Positioning

The menu renders inside the widget's host, next to the trigger, and Zag positions it with `position: absolute` (the `--x` / `--y` variables on the positioner). Inside a container that clips its content (`overflow: hidden` or `auto`: a card, a scrolling panel, a table cell), the open menu is cut off at the container's edge. Pass `positioning={{ strategy: 'fixed' }}` there: the positioner is then placed relative to the viewport and escapes the clipping (it still follows the trigger when the page scrolls; an ancestor with a `transform`, `filter` or `contain` still clips it). Other options go in the same object: `positioning={{ placement: 'bottom-end', gutter: 4, strategy: 'fixed' }}`.

## Testing

In the default mock DOM the menu renders its host only; `t.widget('.card-actions')` gives its props and dispatches its events:

```jsx
import { it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import Card from './Card.jsx'

it('records the picked action', async () => {
  const t = renderComponent(Card)
  await t.ready()
  t.widget('.card-actions').dispatch('select', 'rename')
  await t.next((state) => state.last === 'rename')
  t.dispose()
})
```

To test the keyboard and focus, render it with `dom: 'real'` in jsdom (`renderComponent` adds the `ResizeObserver`, `CSS.escape` and `Element.prototype.scrollTo` that Zag needs and jsdom lacks, for the test's lifetime) or in a real browser. Sygnal's browser suite runs all three Zag parts in Chromium, Firefox and WebKit.

## Size

Gzipped, in a small app: Menu adds **33 KB** (Zag's menu machine, its positioning and `@zag-js/vanilla` make up almost all of it; `fromZag` is about 2 KB). Menu, Select and Combobox together add 47 KB, because they share most of Zag. For a simple list of links or buttons, a [Popover](/ui/popover/) costs a fraction of that.
