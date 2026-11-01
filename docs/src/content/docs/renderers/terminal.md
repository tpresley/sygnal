---
title: Terminal Apps
description: Run Sygnal components in a terminal with sygnal/terminal. runTerminal, keys, dropdowns and dialogs, full-screen layouts with boxes, the terminal stylesheet, mouse and paste, quitting, and testing with createTerminal
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

Tab move · Ctrl+C quit
```

`runTerminal` takes over the TTY. It switches to the alternate screen, reads raw keys, and redraws in place after every change. It keeps the focused line in view and follows resizes. Ctrl+C disposes the app and restores the terminal, and so does a crash or a `SIGTERM`. It runs in Node. Bundle your JSX first (the [examples](https://github.com/tpresley/sygnal/tree/main/examples/tui-tracker) use a Vite SSR build), or use any runner that compiles JSX with `jsxImportSource: 'sygnal'`.

| Option | |
|---|---|
| `styles` | the terminal stylesheet (below) |
| `drivers` | the app's other drivers (`DOM` and `TERMINAL` are the terminal's) |
| `runOptions` | [`run()`](/reference/api/) options: `onError`, `diagnostics`, … |
| `onNavigate(href, el)` | a link's default action: route with your router driver |
| `footer` | the line under the app. Default: what the keys do on the focused element. A string, a function of the terminal, or `false` for none |
| `mouse` | clicks, double clicks and the wheel (default `false`, so the terminal keeps its own text selection) |
| `emojiWidth` | how many cells the terminal draws an emoji in. `'auto'` (default) asks the terminal at start: xterm.js-based terminals (VS Code's) draw 🐛 in one cell, most others in two |
| `console` | `'buffer'` (default on a TTY: `console.log` output is kept, counted in the footer and written after the terminal is restored) or `'pass'` |
| `color`, `alternateScreen` | default: on when stdout is a TTY |
| `stdin`, `stdout` | default `process.stdin` / `process.stdout` |
| `onExit(code)` | after Ctrl+C, a `TERMINAL` exit or `stop()` |

It returns `{ app, terminal, stop }`.

## Keys

| Key | What it does |
|---|---|
| Tab / Shift+Tab, ↓ / ↑ | move focus: form fields, buttons, links, `[tabindex]`, and **any element your intents listen to clicks on**. A radio group is one stop, and so is a tab list with a roving `tabindex` |
| typing | edits the focused text field at its caret (`beforeinput` and `input` events) |
| ← / →, Home / End | move the caret (Shift selects; Alt or Ctrl moves by word); in a `<textarea>`, ↑ / ↓ move between lines |
| Backspace, Delete | delete (with Alt or Ctrl: a word) |
| Ctrl+A E B F D K U W, Alt+B F D | the readline keys in a text field: line start / end, back / forward, delete forward, kill to the end / start, delete a word |
| Enter | in an `<input>`: submit its form; on a button, link, or clicked element: click it |
| Space | toggle a checkbox, click a button |
| ← / → on a radio | check the next radio of its group |
| F2 | a double click (a terminal has none) |
| Escape | close the modal dialog, or the open popover |
| any key | `keydown` / `keyup` on the focused element, or on the app's root |

The footer always shows the keys for the focused element, for example `Enter open list · ←/→ change` on a `<select>`.

Two consequences matter for app code. First, an element like todomvc's `<label>`, which only has a `DOM.dblclick('.todo label')` intent, is still reachable: the terminal knows your intents' selectors, so it adds that label to the focus order. Second, app-wide shortcuts work as on the web, through [`keymap()`](/guide/inputs/) or `DOM.select('document').events('keydown')`. A shortcut that takes a key prevents its default, so the focus doesn't also move.

### Dropdowns

A native `<select>` works as in a TUI toolkit's select widget:

| Key | Closed | Open |
|---|---|---|
| Enter, Space, Alt+↓, F4 | open the option list | Enter / Space: choose the highlighted option (`input`, `change`) and close |
| ↑ / ↓, Home / End, PageUp / PageDown | move the focus | move the highlight (disabled options are skipped) |
| ← / → | the previous / next option, at once | |
| a letter | the next option starting with it | highlight it |
| Escape, Tab | | close without a change (Tab then moves on) |

The list opens under the select (or above it near the bottom), over what is there. The chosen option has a `✓`:

```
Show ▸[open ▴]
     ┌─────────┐
     │▸open   ✓│
     │ closed  │
     │ all     │
     └─────────┘
```

### Dialogs, popovers and details

`<dialog>`, `[popover]` and `<details>` behave as in a browser. A closed dialog, a hidden popover and a closed `<details>`' content aren't drawn. `showModal()` (an `ELEMENT` command) draws the dialog centered over the page, with a border and its `aria-label` as the title, and dims the page under it. The focus moves into the dialog and Tab stays there. Escape sends `cancel` and then `close` (so `DOM.close(Confirm)` hears it), and the focus goes back to what opened the dialog. A `popovertarget` button toggles its popover, which is drawn under the button. `commandfor` / `command` buttons work too.

```jsx
// Issue.jsx
import { controls } from 'sygnal'

export const { Confirm, Delete } = controls({ Confirm: 'dialog', Delete: 'button' })

export default function Issue({ state }) {
  return (
    <article>
      <h2>{state.title}</h2>
      {state.deleted ? <p>Deleted.</p> : <Delete>Delete</Delete>}
      <Confirm aria-label="Confirm">
        <p>Delete “{state.title}”?</p>
        <button className="confirm-ok">Delete</button> <button className="confirm-cancel">Cancel</button>
      </Confirm>
    </article>
  )
}

Issue.initialState = { title: 'Typo in the README', deleted: false }

Issue.intent = ({ DOM }) => ({
  ASK: DOM.click(Delete),
  DELETE: DOM.click('.confirm-ok'),
  CANCEL: DOM.click('.confirm-cancel'),
})

Issue.model = {
  ASK: { ELEMENT: { showModal: Confirm } },
  DELETE: { STATE: (state) => ({ ...state, deleted: true }), ELEMENT: { close: Confirm } },
  CANCEL: { ELEMENT: { close: Confirm } },
}
```

Escape closes the dialog without a model entry; listen with `DOM.close(Confirm)` when the app needs to know.

### Mouse and paste

With `mouse: true`, a click focuses and clicks what it lands on. It toggles a checkbox, opens a select or picks an option, and puts the caret where you clicked in a text field. A double click is a `dblclick`, and the wheel scrolls the box under the pointer. A paste (the terminal's bracketed paste) is one `paste` event and one insertion at the caret; an `<input>` gets its line breaks as spaces. Without bracketed paste, a pasted line break would submit the form.

## Quitting

Ctrl+C always quits. To quit from the app (a `q` key, a menu item), send `'exit'` to the `TERMINAL` sink, which `runTerminal` adds:

```jsx
// Tracker.jsx
Tracker.intent = ({ DOM }) => ({ ...keymap(DOM, { q: 'QUIT' }) })
Tracker.model = { QUIT: { TERMINAL: () => 'exit' } }
```

It also takes `{ exit: code }` (passed to `onExit`), `{ title: 'Tracker' }` (the window title) and `'bell'`.

## The terminal stylesheet

CSS doesn't reach a terminal, so each app gives the terminal a short list of `[selector, style]` rules. They're applied in order after a default sheet (bold headings, underlined links, a border on dialogs), and an inline `style={{ display: 'none' }}` or `hidden` attribute wins, as in a browser.

| Key | |
|---|---|
| `display` | `'none'` hides; `'block'` / `'inline'` override the tag's default; `'flex'` with `flexDirection` |
| `before`, `after` | text around the element's content |
| `bold`, `dim`, `italic`, `underline`, `inverse` | text attributes |
| `color`, `background` | `black red green yellow blue magenta cyan white gray`, or `brightRed`, … |
| `upper` | the element's text in upper case |
| `width`, `height` | a box's size in cells (columns / rows), or a percentage: `'40%'` of the space it is in, `height: '100%'` of the screen for the root |
| `flex` | in a flex row or column: its share of the space left |
| `border`, `borderColor` | `true` / `'single'`, `'round'`, `'double'`, `'heavy'`; the element's `aria-label` (or `title`) is drawn in the top border |
| `padding` | cells inside the border: `1`, or `[vertical, horizontal]` |
| `overflow` | with a height: `'auto'` / `'scroll'` scroll, with a scrollbar, keeping the focused element (and the caret) in view; `'hidden'` crops |
| `gap` | cells between a flex row's items (default 1) |

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

Selectors support what intents use: tag, `#id`, `.class`, `[attr]`, `[attr="v"]` (and `^=` `$=` `*=` `~=`), `:not(…)`, descendant and `>` combinators, and `a, b` lists. The state pseudo-classes are `:focus`, `:focus-within`, `:checked`, `:disabled`, `:open`, `:modal` and `:popover-open`.

The layout is a line flow. Block elements start lines, inline content flows and wraps at the terminal's width, lists indent with bullets or numbers, and `<pre>` keeps its spaces. Form controls are drawn as `[text_]`, `[x]`, `(•)`, `[option ▾]`, `[Button]` and `[████░░] 60%` (a `<progress>`). A `<textarea>` is a box of its `rows`. The focused element shows inverse (or with `▸` in plain text), and a focused box's border turns heavy. Widths count terminal cells: CJK text takes two, combining marks none, and an emoji what the terminal uses (`emojiWidth`).

### Full-screen layouts

An element with a `width`, `height`, `border`, `padding` or scrolling `overflow` is a **box**, laid out in a rectangle of its own. A flex row whose items have a `width`, a `flex` share or a border puts them side by side, all as tall as the row. A flex column with a height gives its `flex` items the rows its other items leave. So a list beside a detail pane, with a status bar on the last row, is:

```js
// styles.js
export const terminalStyles = [
  ['main', { display: 'flex', flexDirection: 'column', height: '100%' }],
  ['.split', { flex: 1, display: 'flex', flexDirection: 'row' }],
  ['.issues', { width: '45%', border: 'round', overflow: 'auto' }],
  ['.issues:focus-within', { borderColor: 'cyan' }],
  ['.detail', { flex: 1, border: 'round', padding: [0, 1] }],
  ['.status-bar', { inverse: true }],
]
```

```
TRACKER
[Issues] [New issue] [Help]
Filter [title, label, person] Show [open ▾]
╭─ Issues ────────────────────────╮ ╭──────────────────────────────────────────╮
│• #12 H Dark mode for the       ││ │ #14 Search ignores accents (2)           │
│  settings page (2)             █│ │ open · medium · @dara · feature          │
│• #13 L Typo in the README (2)  ││ │ [Show description]                       │
│• ▸#14 M Search ignores accents ││ │ [Close] [Delete]                         │
│  (2)                           ││ │                                          │
╰─────────────────────────────────╯ ╰──────────────────────────────────────────╯
Synced 32 shown / 40 ↑↓ issues · → detail · 3 help
```

The box keys come from the terminal stylesheet only, in cells: an inline web style (`style={{ flex: 1, padding: 8 }}`) doesn't make a box. `scrollIntoView()` (an `ELEMENT` command) scrolls an element's boxes to it.

## Isolation still applies

The terminal changes nothing about how components see the DOM. A `Collection` item's elements belong to the item, so the parent can't listen to a click on them or focus them by selector, in a terminal as in a browser. Listen in the item and send it up with `PARENT`, and focus an item's element from the parent with [`focusWithin`](/guide/element-commands/):

```jsx
// IssueRow.jsx
IssueRow.intent = ({ DOM }) => ({ PICK: DOM.focus('.issue') })
IssueRow.model = { PICK: { PARENT: (state) => state.id } }
// the parent: SELECT: CHILD.select(IssueRow); ELEMENT: { focus: focusWithin('.issue[data-id="3"]') }
```

## sygnal/ui in a terminal

Every [`sygnal/ui`](/ui/overview/) part on native HTML works in a terminal: [dialog](/ui/dialog/), [popover](/ui/popover/), [tooltip](/ui/tooltip/) (shown on focus under its trigger), [tabs](/ui/tabs/), [accordion](/ui/accordion/), [disclosure](/ui/disclosure/) and the [Toaster](/ui/toaster/). They read the document of the element they act on, so the same code runs on the terminal's tree, in a browser, and in a shadow root. The arrow keys move between tabs and between accordion triggers.

The `dialog` behavior gives the confirm above its state, its trigger's ARIA and a refusable close:

```jsx
// Item.jsx
import { dialog, dialogAttrs } from 'sygnal/ui'

export function Item({ state, uid }) {
  const a = dialogAttrs(state.ask, uid)
  return (
    <div>
      <button className="delete" {...a.trigger}>Delete</button>
      <dialog className="ask" {...a.dialog} role="alertdialog" aria-label="Confirm" aria-labelledby={undefined}>
        <p {...a.description}>Delete it? This can't be undone.</p>
        <button className="ok">Delete</button> <button className="cancel">Cancel</button>
      </dialog>
    </div>
  )
}

Item.initialState = { deleted: false }
Item.uses = { ask: dialog({ dialog: '.ask', trigger: '.delete', close: '.cancel' }) }
Item.intent = ({ DOM }) => ({ DELETE: DOM.click('.ok') })
Item.model = { DELETE: (state) => ({ ...state, deleted: true, ask: { ...state.ask, open: false } }) }
```

The box's title comes from `aria-label`, so the dialog keeps one here instead of a title element. Escape is the dialog's `CANCEL`, and the focus goes back to the trigger.

Render `<Toaster />` once and pass `makeTimerDriver()` in `drivers` (`runTerminal(App, { drivers: { TIMER: makeTimerDriver() } })`). A toast is drawn at the top right and times out. The terminal has no `MutationObserver`, so the toast region doesn't move into an open modal dialog as it does in a browser: a toast that comes while a modal is open is drawn over it and still times out, but its Dismiss button can't take the focus until the dialog closes.

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

| | |
|---|---|
| `term.press(key, { shiftKey, ctrlKey, altKey })` | a key, by DOM key name (`'Enter'`, `'Tab'`, `'ArrowDown'`, `'Escape'`, `'F2'`, `' '`, `'a'`) |
| `term.type(text)`, `term.paste(text)` | typing (a press per character), a paste |
| `term.click(line, col, { detail })`, `term.wheel(line, col, rows)` | the mouse, at a cell of the current frame |
| `term.frame()`, `term.render()` | the frame as text; `{ plain, ansi, focusLine, focus, caret, hits }` |
| `term.focusables()`, `term.keyHint()` | the Tab order; the footer's key hint |
| `run(App, { DOM: term.driver, TERMINAL: term.control })`, `term.commands` | what the app sent its `TERMINAL` sink |

`createTerminal({ width: 80, height: 24 })` gives the frame a screen's height, for full-screen layouts. Test the logic itself once with [`renderComponent`](/integration/testing/): it covers every target.

## Lower-level pieces

`createTerminal({ onFrame })` calls you with each new frame, if you want to draw it yourself (in a pane of a larger TUI, or over a socket). `paint(doc, { rules, width, height })` paints any [host document](/renderers/custom-targets/), and `hitTest(frame, line, col)` finds the element at a cell. `parseKeys(chunk)` turns raw TTY input into key names, pastes and mouse events, and `stringWidth(text)` counts terminal cells.
