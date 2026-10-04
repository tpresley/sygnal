---
title: Accessibility
description: The SYG7xx accessibility checks in sygnal-check and the Vite dev checker
---

`sygnal-check` has an accessibility lane, SYG701 to SYG708. It finds the markup mistakes that lock keyboard and screen-reader users out without any visible sign: a clickable `<div>`, a field without a label, an icon button with no name. Like the other checks, it reads your source, so it works the same in the editor, in CI and in the dev server.

## Severity

- **Warning** by default: `npx --no-install sygnal-check` prints the findings and exits with code 1, like any other warning.
- **Still a warning under `--strict`.** Strict mode checks the canonical forms; it doesn't turn markup that already shipped into errors when you upgrade.
- **Error** when you ask for it: `sygnal-check --a11y=error`, `check(paths, { a11y: 'error' })`, or `check: { a11y: 'error' }` in the [Vite plugin](/integration/bundler-config/#plugin-options), where errors also open Vite's error overlay. Use it in CI once an app is clean.
- **On in the dev server**: the Vite plugin runs `sygnal-check` when it is installed, so the findings appear in the terminal and the browser console as you edit.

The checks are static only: markup that is built at runtime (spread props, a dynamic `type` or `role`) is skipped rather than guessed at.

To keep one finding on purpose, put `// sygnal-ignore SYG70x` on the line above it, or at the end of the line (see [Suppressing a finding](#suppressing-a-finding)).

## The rules

Each example shows the flagged form as a comment, then the fix.

### SYG701: click listener on a non-interactive element

The intent listens for clicks on a `<div>`, `<span>`, `<li>`, `<p>`, `<img>` or similar without a `role` and `tabIndex`. Mouse users can click it; keyboard users can't reach it, and screen readers don't announce it as something to activate. Render a button instead:

```jsx
// Flagged:
// function Card({ state }) { return <div className="card">{state.title}</div> }

function Card({ state }) {
  return <button type="button" className="card">{state.title}</button>
}

Card.intent = ({ DOM }) => ({ OPEN: DOM.click('.card') })
Card.model = { OPEN: (state) => ({ ...state, open: true }) }
```

If the element must stay a `<div>`, give it `role="button"` and `tabIndex={0}`, and handle Enter and Space too:

```jsx
import { xs } from 'sygnal'

function Card({ state }) {
  return <div className="card" role="button" tabIndex={0}>{state.title}</div>
}

Card.intent = ({ DOM }) => ({
  OPEN: xs.merge(
    DOM.click('.card'),
    DOM.keydown('.card').filter(e => e.key === 'Enter' || e.key === ' '),
  ),
})
Card.model = { OPEN: (state) => ({ ...state, open: true }) }
```

The rule applies to a [control](/guide/controls/)'s element too (`controls({ Card: 'div' })` listened to for clicks: declare it as `'button'`). An element that contains a button, link or form field isn't flagged, since a click on those bubbles up to the listener.

### SYG702: form field without a label

An `<input>`, `<select>` or `<textarea>` has no accessible name, so a screen reader announces only "edit text". Wrap it in a `<label>`, link a `<label for>` to its `id` (with [`uid()`](#ids-with-uid), below), or, for a field with no visible label, add `aria-label`:

```jsx
// Flagged: <input className="search" type="search" value={state.query} />

function Search({ state }) {
  return <input className="search" type="search" aria-label="Search tasks" value={state.query} />
}

Search.initialState = { query: '' }
Search.intent = ({ DOM }) => ({ QUERY: DOM.input('.search').value() })
Search.model = { QUERY: (state, query) => ({ ...state, query }) }
```

A `placeholder` counts as a last-resort name, but it disappears as soon as the user types; prefer a visible label.

### SYG703: image without alt text

Every `<img>` needs `alt`. Describe what the image shows, or use `alt=""` for a decorative image, which screen readers then skip:

```jsx
// Flagged: <img src={state.avatarUrl} />

function Profile({ state }) {
  return (
    <div>
      <img src={state.avatarUrl} alt={state.name} />
      <img src="/divider.svg" alt="" />
    </div>
  )
}
```

### SYG704: link without href used as a button

An `<a>` without `href` is not focusable and is announced as plain text. Use a button for an action, and keep `<a href>` for navigation:

```jsx
// Flagged: <a className="more">Show more</a> with DOM.click('.more')

function Comments({ state }) {
  return (
    <div>
      <p>{state.shown} of {state.total} comments</p>
      <button type="button" className="more">Show more</button>
    </div>
  )
}

Comments.intent = ({ DOM }) => ({ MORE: DOM.click('.more') })
Comments.model = { MORE: (state) => ({ ...state, shown: Math.min(state.total, state.shown + 10) }) }
```

### SYG705: button without an accessible name

A button whose only content is an icon is announced as just "button". Add `aria-label`, and hide the icon from screen readers:

```jsx
// Flagged: <button type="button" className="close"><span>×</span></button>, no name for "×"...
// ...and an icon with no text: <button type="button" className="close"><i className="icon-x" /></button>

function Banner({ state }) {
  return (
    <div role="status">
      {state.message}
      <button type="button" className="close" aria-label="Dismiss">
        <i className="icon-x" aria-hidden="true" />
      </button>
    </div>
  )
}

Banner.intent = ({ DOM }) => ({ DISMISS: DOM.click('.close') })
Banner.model = { DISMISS: (state) => ({ ...state, message: '' }) }
```

Only literal content is checked: a button whose children include an expression (`{state.label}`) or a component isn't flagged.

### SYG706: positive tabIndex

`tabIndex={1}` and higher move the element ahead of everything else in the Tab order. Use `tabIndex={0}` (focusable in document order) or `tabIndex={-1}` (focusable only from code), and change the markup order to change the Tab order:

```jsx
// Flagged: <div className="preview" tabIndex={1}>…</div>

function Preview({ state }) {
  return <div className="preview" tabIndex={0} aria-label="Preview">{state.html}</div>
}
```

### SYG707: unknown ARIA attribute or invalid role

A misspelled `aria-*` attribute, or a `role` that isn't a WAI-ARIA role (including abstract roles such as `widget`), is ignored by assistive technology. The message suggests the closest valid name:

```jsx
// Flagged: aria-labeledby (a typo), role="widget" (abstract)

function Tabs({ state }) {
  return (
    <div>
      <h2 id="tabs-title">Settings</h2>
      <div role="tablist" aria-labelledby="tabs-title">
        {state.tabs.map(tab => <button type="button" role="tab" aria-selected={String(tab === state.current)}>{tab}</button>)}
      </div>
    </div>
  )
}
```

### SYG708: label or ARIA reference to an id that isn't rendered

A `<label for>`, `aria-describedby` or `aria-labelledby` names an id that no element has, so the label is attached to nothing. This usually comes from an id renamed on one side only. Inside a component, use `uid()` on both sides:

```jsx
// Flagged: <input id="email" … /> with <label for="e-mail">

function EmailField({ state, uid }) {
  return (
    <p>
      <label for={uid('email')}>Email</label>
      <input id={uid('email')} type="email" className="email" value={state.email} aria-describedby={uid('email-error')} />
      {state.error && <span id={uid('email-error')}>{state.error}</span>}
    </p>
  )
}

EmailField.initialState = { email: '', error: '' }
EmailField.intent = ({ DOM }) => ({ EMAIL: DOM.input('.email').value() })
EmailField.model = { EMAIL: (state, email) => ({ ...state, email, error: email.includes('@') ? '' : 'Enter an email address' }) }
```

A `uid('x')` reference needs an element in the same component with `id={uid('x')}`; a literal id may be anywhere in the checked files.

## Ids with uid()

Labels and ARIA references need ids, and ids must be unique on the page, which a literal id isn't once the component is rendered twice. Every view gets a `uid` prop: `uid()` is an id for this component instance, and `uid('email')` an id derived from it. They are stable across renders and the same on the server and the client, so they are safe with [SSR](/integration/ssr/#stable-ids-uid). See [Forms](/guide/forms/#labels-and-ids-uid) for a full example. The checks understand `uid()`: SYG702 and SYG708 match `for={uid('email')}` with `id={uid('email')}`.

## Suppressing a finding

A comment on the line above (or at the end of the line) suppresses one finding:

```jsx
import { xs } from 'sygnal'

function Dialog({ state }) {
  return (
    <div>
      <div className="backdrop" />
      <div role="dialog" aria-modal="true" aria-label="Settings">{state.body}</div>
    </div>
  )
}

Dialog.intent = ({ DOM }) => ({
  CLOSE: xs.merge(
    // a mouse shortcut: keyboard users close the dialog with Escape
    // sygnal-ignore SYG701
    DOM.click('.backdrop'),
    DOM.keydown('document').key().filter(key => key === 'Escape'),
  ),
})
Dialog.model = { CLOSE: { PARENT: () => 'closed' } }
```

A backdrop that closes a dialog on click is a common case: the dialog itself is reachable, and keyboard users close it with Escape. Without codes, `// sygnal-ignore` suppresses every code on that line. To turn a rule off for the dev server, add it to the Vite plugin's ignore list: `sygnal({ check: { ignore: ['SYG705'] } })`.

## Related

- [Error Reference](/reference/errors/#syg701): every SYG7xx code, its cause and its fix
- [Diagnostics](/guide/diagnostics/#the-static-checker): running `sygnal-check`
- [Forms](/guide/forms/): labels, controlled inputs and focus
