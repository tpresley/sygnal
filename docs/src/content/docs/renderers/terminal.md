---
title: Terminal Apps
description: Run Sygnal components in a terminal with sygnal/terminal. runTerminal, keys, focus, the terminal stylesheet, and testing with createTerminal
---

`sygnal/terminal` runs a Sygnal app in a terminal. Your components, intents and models stay the same. The view's HTML is painted as text, and key presses become the DOM events your intents already listen for.

```jsx
// terminal.jsx
import { runTerminal } from 'sygnal/terminal'
import Groceries from './Groceries.jsx'

runTerminal(Groceries, {
  styles: [
    ['h1', { color: 'green', upper: true }],
    ['.item.done label', { dim: true, after: ' ✓' }],
  ],
})
```

```
GROCERIES
Item [Milk, bread, …] Aisle [produce ▾] [Add]
  • [ ] Apples (produce) [×]
  • [x] Milk ✓ (dairy) [×]
— 1 to buy · Show [all ▾] [Clear the cart]

Tab move · Enter/Space activate · F2 double click · Ctrl+C quit
```

`runTerminal` takes over the TTY: it switches to the alternate screen, reads raw keys, redraws after every change, keeps the focused line in view, and follows resizes. Ctrl+C disposes the app and restores the terminal. It runs in Node. Bundle your JSX first (the [example](https://github.com/tpresley/sygnal/tree/main/examples/renderer-targets) uses a Vite SSR build), or use any runner that compiles JSX with `jsxImportSource: 'sygnal'`.

| Option | |
|---|---|
| `styles` | the terminal stylesheet (below) |
| `drivers` | the app's other drivers (`DOM` is the terminal's) |
| `runOptions` | [`run()`](/reference/api/) options: `onError`, `diagnostics`, … |
| `onNavigate(href, el)` | a link's default action: route with your router driver |
| `footer` | the help line under the app (`false`: none) |
| `color`, `alternateScreen` | default: on when stdout is a TTY |
| `stdin`, `stdout` | default `process.stdin` / `process.stdout` |
| `onExit()` | after Ctrl+C or `stop()` |

It returns `{ app, terminal, stop }`.

## Keys

| Key | What it does |
|---|---|
| Tab / Shift+Tab, ↓ / ↑ | move focus: form fields, buttons, links, `[tabindex]`, and **any element your intents listen to clicks on** |
| typing, Backspace | edit the focused text field (`input` events) |
| Enter | in a field: submit its form; on a button, link, or a clicked element: click it |
| Space | toggle a checkbox, click a button |
| ← / → | change a `<select>`'s option (`change`) |
| F2 | a double click (a terminal has none) |
| any key | `keydown` / `keyup` on the focused element, or on the app's root |

Two consequences matter for app code. First, an element like todomvc's `<label>`, which only has a `DOM.dblclick('.todo label')` intent, is still reachable: the terminal knows your intents' selectors, so it adds that label to the focus order. Second, app-wide shortcuts work as on the web, through `DOM.select('document').events('keydown')`.

## The terminal stylesheet

CSS doesn't reach a terminal, so each app gives the terminal a short list of `[selector, style]` rules. They're applied in order after a default sheet (bold headings, underlined links), and an inline `style={{ display: 'none' }}` or `hidden` attribute wins, as in a browser.

| Key | |
|---|---|
| `display` | `'none'` hides; `'block'` / `'inline'` override the tag's default |
| `before`, `after` | text around the element's content |
| `bold`, `dim`, `italic`, `underline`, `inverse` | text attributes |
| `color` | `black red green yellow blue magenta cyan white gray`, or `brightRed`, … |
| `upper` | the element's text in upper case |

Use it for the parts of your CSS that change **what is shown**. todomvc hides the edit field unless its item is being edited:

```js
// terminal-styles.js
export const todoStyles = [
  ['.todo .edit', { display: 'none' }],
  ['.todo.editing .edit', { display: 'inline' }],
  ['.todo.editing .view', { display: 'none' }],
  ['.todo.completed label', { dim: true, after: ' ✓' }],
  ['.filters li', { display: 'inline' }],
]
```

Selectors support what intents use: tag, `#id`, `.class`, `[attr]`, `[attr="v"]` (and `^=` `$=` `*=` `~=`), `:focus`, `:not(…)`, descendant and `>` combinators, and `a, b` lists.

The layout is a line flow. Block elements start lines, inline content flows and wraps at the terminal's width, lists indent with bullets or numbers, `<pre>` keeps its spaces, and form controls are drawn as `[text_]`, `[x]`, `(•)`, `[option ▾]` and `[Button]`. The focused element shows inverse (or with `▸` in plain text).

## Testing

`createTerminal()` is the same target without a TTY. Run the app on its driver, press keys, and compare frames as plain text:

```js
// Groceries.terminal.test.js
import { it, expect } from 'vitest'
import { run } from 'sygnal'
import { createTerminal } from 'sygnal/terminal'
import Groceries, { Name } from './Groceries.jsx'

const tick = () => new Promise((resolve) => setTimeout(resolve))

it('adds an item from the keyboard', async () => {
  const term = createTerminal({ width: 60 })
  const app = run(Groceries, { DOM: term.driver })
  await tick()
  term.focus(Name)
  term.type('Eggs')
  term.press('Enter')
  await tick()
  expect(term.frame()).toContain('[ ] Eggs')
  app.dispose()
})
```

`term.press(key, { shiftKey })` takes DOM key names (`'Enter'`, `'Tab'`, `'ArrowDown'`, `'Escape'`, `'F2'`, `' '`, `'a'`). `term.render()` returns `{ plain, ansi, focusLine }`, and `term.focusables()` lists the Tab order. Test the logic itself once with [`renderComponent`](/integration/testing/): it covers every target.

## Lower-level pieces

`createTerminal({ onFrame })` calls you with each new frame, if you want to draw it yourself (in a pane of a larger TUI, or over a socket). `paint(doc, { rules, width })` paints any [host document](/renderers/custom-targets/). `parseKeys(chunk)` turns raw TTY input into key names.
