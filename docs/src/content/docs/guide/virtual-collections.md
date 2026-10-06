---
title: Virtual Collections
description: VirtualCollection renders only the rows in view of a long list, with the same props as Collection, measured row heights and scrollToIndex / scrollToId element commands
---

A `<Collection>` makes a component for every item. With thousands of rows that is slow to create and heavy to keep. `<VirtualCollection>` takes the same props and makes components only for the rows that are in view, plus a few beyond each edge. Scrolling moves that window: rows that leave it are disposed, rows that enter it are made.

`<VirtualCollection>` is itself the scroll container: it renders a `div` (`role="list"` by default) that scrolls. Put the class with the bounded height, `role` and `aria-label` on it (`<VirtualCollection className="people" aria-label="People" … />`), and don't wrap it in a scrolling `<ul>` or `<div>` of your own: it would grow with its rows, only a viewport's height of them would render, and [SYG430](/reference/errors/#syg430) reports it. SYG430 means: fix the height of the VirtualCollection's own class.

```jsx
// Row.jsx
export function Row({ state }) {
  return (
    <div className="row">
      <span className="name">{state.name}</span>
      <button className="star">{state.starred ? 'Unstar' : 'Star'}</button>
    </div>
  )
}

Row.intent = ({ DOM }) => ({ STAR: DOM.click('.star') })

Row.model = {
  STAR: (state) => ({ ...state, starred: !state.starred }),
}
```

```jsx
// People.jsx
import { VirtualCollection } from 'sygnal'
import { Row } from './Row.jsx'

export function People({ state }) {
  return (
    <section>
      <button className="jump">Jump to row 9,000</button>
      <VirtualCollection of={Row} from="people" className="people" estimateSize={32} aria-label="People" />
    </section>
  )
}

People.initialState = { people: [] }

People.intent = ({ DOM }) => ({
  JUMP: DOM.click('.jump').mapTo(8999),
})

People.model = {
  JUMP: { ELEMENT: (state, index) => ({ scrollToIndex: '.people', index, align: 'start' }) },
}
```

```css
.people { height: 480px; }
```

The element is its own scroll container (`overflow-y: auto`), so **give its class a bounded height**: `height`, `max-height`, or `flex: 1` with `min-height: 0` in a flex column. Without one it grows with its rows and would render all of them; Sygnal then renders only a viewport's height of rows and reports [SYG430](/reference/errors/#syg430). A `max-height` taller than its rows is fine: the container fits them, and they all render. A percentage `height` or `max-height` bounds it only when its parent has a height itself (`max-height: 100%` of a parent that grows doesn't); Sygnal measures this rather than reading the CSS.

That measurement only happens for a container as tall as all its rows and taller than the viewport. It makes the list's spacer much taller for one forced layout and turns scroll anchoring off (`overflow-anchor: none`) on every ancestor meanwhile, so the page doesn't move. It puts each ancestor's inline style back through the CSSOM (`element.style`), not by rewriting the `style` attribute, because a [Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP) whose `style-src` has no `'unsafe-inline'` blocks attribute writes. The browser then writes those ancestors' `style` attributes again from the declarations it parsed: the text is normalised (`PADDING-TOP:1px` becomes `padding-top: 1px;`), and a declaration it doesn't understand (another engine's vendor prefix) is dropped. Styles you set with JSX `style={{ ... }}` are unaffected. An ancestor without a `style` attribute keeps none.

The viewport-high window is in the rows' own pixels under an ancestor's CSS `zoom` (`zoom: 0.5` renders twice the rows); a CSS `transform` such as `scale()` doesn't change it.

## Props

`of`, `from`, `filter` and `sort` work as on a [Collection](/guide/collections/): the same keys (an item's `id`, or its index without one), the same duplicate and missing-`from` handling, and an item writes back to its own array element. Any other prop goes to every item, as with a Collection. These are the container's:

| Prop | Default | Description |
|------|---------|-------------|
| `className` | | The scroll container's class. Give it a bounded height |
| `estimateSize` | `32` | A row's height in px until it is measured: a number, or `(item, index) => px` |
| `overscan` | `5` | Rows rendered beyond each edge of the view |
| `role` | `'list'` | The container's role. With `list`, rows without a role of their own get `role="listitem"`. `null` sets none |
| `tabIndex` | `0` | Focusable, so the keyboard scrolls it |
| `aria-label`, `aria-labelledby`, `aria-describedby`, `id`, `style` | | Set on the container (`style` after the defaults) |
| `viewTransitionName` | | As on [Collection](/guide/view-transitions/#collection-items): each row with an `id` gets `view-transition-name: <prefix>-<id>`, so a sort in a `viewTransitions` action animates the rows in view |

## Row state lives in the array

A row scrolled out of the window is disposed, like a removed Collection item, and made again when it comes back. Its state is its element of the array, as for every Collection item, so nothing in state is lost: the starred flag above is still there when you scroll back.

What lives only in the DOM or in the row's instance is lost:

- the text of an input whose value isn't in state (bind `value` to state for anything the user types);
- work in flight: a row's pending request, timer or `EFFECT` ends with its instance.

So keep everything a row needs in its array element, which is the canonical Collection item anyway. Work that must outlive scrolling belongs in the parent.

The focus is the exception: the row that holds it stays rendered while it is scrolled out of view (at its own position, outside the window), so the focus and the keyboard user's place are kept. Once the focus leaves the list, the row goes like any other.

## Jumping to a row

The target row is usually not rendered, so you can't scroll it into view. The container has two methods for [element commands](/guide/element-commands/) instead:

```jsx
Results.model = {
  SHOW_MATCH: { ELEMENT: (state, id) => ({ scrollToId: '.results', id, align: 'center' }) },
  TO_TOP:     { ELEMENT: { scrollToIndex: '.results', index: 0 } },
}
```

| Command | Options |
|---|---|
| `{ scrollToIndex: target, index }` | `index`: a position among the shown rows (after `filter` and `sort`), from 0 |
| `{ scrollToId: target, id }` | `id`: the `id` of an item the filter keeps |
| both | `align`: `'auto'` (default: scrolls only when the row isn't in view), `'start'`, `'center'`, `'end'`; `behavior`: `'auto'` or `'smooth'` |

The virtualizer scrolls to the row's estimated offset and keeps correcting it while the rows around it are measured, so it lands on the row even when heights vary. An index or id that isn't in the list doesn't scroll ([SYG433](/reference/errors/#syg433) in development).

## Row heights

Rows can have any height, and each can differ. Until a row has been rendered, its height is `estimateSize`; once rendered, it is measured, and a `ResizeObserver` follows later changes (an expanded row, a loaded image). A good estimate keeps the scrollbar steady: use your typical row height, or a function when rows differ predictably:

```jsx
<VirtualCollection of={Message} from="messages" className="thread" estimateSize={(message) => (message.image ? 240 : 56)} />
```

An inline function like this one is a new function at every render; that's fine, it is taken as the same estimate and the measured heights are kept. A numeric `estimateSize` that changes, or a switch between a number and a function, measures the rows again.

A row must render one element, which is what is measured ([SYG432](/reference/errors/#syg432) for a fragment).

## Accessibility

- The container is a `list` named by `aria-label` (or `aria-labelledby`), and its rows are `listitem`s with `aria-setsize` (the number of shown rows) and `aria-posinset` (the row's position, from 1), so a screen reader can announce "item 4,201 of 10,000" although only a few rows exist.
- For another pattern, set the container's `role` and give the rows theirs: `role="listbox"` with rows rendering `role="option"` (their `aria-setsize` and `aria-posinset` are set too).
- The container is focusable (`tabIndex={0}`), so arrow keys, Page Up/Down, Home and End scroll it.
- A focused row that scrolls out of the window keeps the focus: it stays rendered until the focus leaves the list. For keyboard navigation between rows, keep the active row in state and send `scrollToIndex` with it before focusing.

## Tests and server rendering

Without layout (the default mock DOM of [`renderComponent`](/integration/testing/), jsdom, `renderToString`), the window is the first 10 rows' estimate plus `overscan`: the first 15 rows by default. Test row behaviour on those rows, and check jumps as commands:

```jsx
import { renderComponent } from 'sygnal'
import { People } from './People.jsx'

it('jumps to row 9,000', async () => {
  const t = renderComponent(People, { initialState: { people: Array.from({ length: 10000 }, (_, i) => ({ id: i + 1, name: 'P' + i })) } })
  await t.ready()
  t.simulateEvent('.jump', 'click')
  await t.settle()
  expect(t.commands('ELEMENT')).toEqual([{ scrollToIndex: '.people', index: 8999, align: 'start' }])
})
```

Scrolling, measured heights and real jumps need a browser: Sygnal's own tests for them run in Chromium, Firefox and WebKit. `renderToString` renders the container and the first rows, numbered and named as the client numbers and names them; the client measures and moves the window once the page has layout. The client's first render makes the rows again (as it does every element of the server markup with a class or an id, and what is inside it), so a focus or text typed in a row before the app started is not kept.

## When to use it

Measured in Chromium 153 with Sygnal's benchmark harness (a 640 px container of 32 px rows; `benchmarks/RESULTS.md` in the repository). Each cell is the time from the click or scroll to the next painted frame, and in brackets the main thread's CPU time, in ms (medians):

| | VirtualCollection | Collection | React + TanStack Virtual | React, every row |
|---|---:|---:|---:|---:|
| Create 10,000 rows | 18 (10) | 159 (161) | 17 (7) | 234 (236) |
| Scroll by a page, 10,000 | 18 (4) | 17 (32) | 18 (3) | 17 (24) |
| Jump to row 9,000, 10,000 | 19 (4) | 22 (37) | 18 (4) | 17 (27) |
| Create 100,000 rows | 41 (48) | 1,600 (1,603) | 16 (23) | 11,900 (11,903) |
| Scroll by a page, 100,000 | 22 (12) | 17 (370) | 18 (8) | 17 (166) |
| Jump to row 9,000, 100,000 | 22 (13) | 55 (381) | 19 (8) | 33 (177) |

A plain Collection costs about 14 ms per 1,000 rows to create, every row stays in the DOM, and every scroll costs the main thread more as the list grows. `VirtualCollection` costs about the same at any length. **Use it from about 1,000 rows**, or earlier when rows are expensive to render. Below a few hundred rows a plain Collection is simpler: find-in-page, printing and scroll anchoring work on every row, and no height is needed.

It doesn't do (yet): horizontal lists, grids, sticky group headers, or scrolling with the page instead of its own container.

## Without a bundler

`VirtualCollection` uses `@tanstack/virtual-core`, a dependency of Sygnal that bundlers resolve and tree-shake. Loaded as native ES modules straight in the browser (an import map or a CDN, no build step), it needs two things a bundler would otherwise provide:

- an import map entry for `@tanstack/virtual-core` (Sygnal imports it by name), next to the ones for `sygnal`, `snabbdom` and `xstream`;
- `process.env.NODE_ENV`, which the virtualizer reads when it is created. Define it before the app loads:

```html
<script>globalThis.process ??= { env: { NODE_ENV: 'production' } }</script>
```

## Diagnostics

| Code | When |
|---|---|
| [SYG430](/reference/errors/#syg430) | The container has no bounded height (0 px, or it grows with its rows) |
| [SYG431](/reference/errors/#syg431) | Items without `id` (index keys: measured heights and instances follow positions) |
| [SYG432](/reference/errors/#syg432) | An item renders a fragment or text, not one element |
| [SYG433](/reference/errors/#syg433) | `scrollToIndex` / `scrollToId` for a row not in the list |
| [SYG434](/reference/errors/#syg434) | `estimateSize` or `overscan` isn't a valid number |
