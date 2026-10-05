---
title: Toaster
description: Toast notifications sent with event('TOAST') from any component, announced to screen readers and shown above modal dialogs
---

`<Toaster>` shows short notifications ("Saved", "Upload failed") that any component sends as an event. Render it once, near the root of the app:

```jsx
import { Toaster } from 'sygnal/ui'

function App({ state }) {
  return (
    <div className="app">
      <h1>{state.title}</h1>
      <Editor />
      <Toaster />
    </div>
  )
}

App.initialState = { title: 'Notes' }
```

```js
import { run, makeTimerDriver } from 'sygnal'
import App from './App.jsx'

run(App, { TIMER: makeTimerDriver() })
```

Then send a toast from anywhere, through the `EVENTS` bus:

```jsx
import { event } from 'sygnal'

function Editor({ state }) {
  return (
    <div className="editor">
      <label>Note <textarea className="text" value={state.text} /></label>
      <button className="save">Save</button>
    </div>
  )
}

Editor.initialState = { text: '' }
Editor.isolatedState = true
Editor.intent = ({ DOM }) => ({ TEXT: DOM.input('.text').value(), SAVE: DOM.click('.save') })
Editor.model = {
  TEXT: (state, text) => ({ ...state, text }),
  SAVE: { EVENTS: event('TOAST', { text: 'Note saved', kind: 'success' }) },
}
```

The timer driver dismisses toasts after their timeout. Without it, they stay until dismissed.

## The TOAST event

| Field | Default | |
|---|---|---|
| `text` | (required) | The message. `event('TOAST', 'Saved')` is short for `{ text: 'Saved' }` |
| `kind` | `'info'` | `'info'`, `'success'`, `'warning'` or `'error'`. Errors are announced at once (`role="alert"`), the others politely (`role="status"`) |
| `timeoutMs` | `5000` | ms until it dismisses itself; `0` keeps it until the user dismisses it |
| `id` | a number | A toast sent with the `id` of a shown one replaces it in place and starts its timeout again |

`event('TOAST_DISMISS', id)` removes the toast with that `id`; `event('TOAST_DISMISS')` removes all of them. With ids, a long task can report its progress in one toast:

```jsx
Upload.model = {
  START: { EVENTS: event('TOAST', { id: 'upload', text: 'Uploading…', timeoutMs: 0 }) },
  DONE: { EVENTS: event('TOAST', { id: 'upload', text: 'Upload complete', kind: 'success' }) },
}
```

## Props

| Prop | Default | |
|---|---|---|
| `label` | `'Notifications'` | The region's accessible name |
| `dismissLabel` | `'Dismiss'` | The text of each toast's dismiss button; its accessible name is `Dismiss: <text>` |
| `pauseOnHover` | `true` | The timeouts stop while the pointer or the keyboard focus is in the region, and start over when it leaves |
| `transition` | `'toast'` | The [Transition](/advanced/transitions/) class prefix: `toast-enter-from`, `toast-leave-to`… |
| `duration` | `200` | How long a dismissed toast stays for its leave animation, in ms |
| `className` | | More classes on the region |

## Markup and styling

```html
<div class="toaster-home">
  <section class="toaster" aria-label="Notifications" popover="manual" data-paused>
    <div class="toaster-status" role="status" aria-live="polite">
      <div class="toaster-list">
        <div class="toast" data-kind="success">
          <span class="toast-text">Note saved</span>
          <button class="toast-dismiss" aria-label="Dismiss: Note saved">Dismiss</button>
        </div>
      </div>
    </div>
    <div class="toaster-alert" role="alert"><div class="toaster-list"></div></div>
  </section>
</div>
```

The region is a popover, so the browser draws it in the top layer, centred and with a border. Place it in a corner and style the toasts:

```css
.toaster { inset: auto 1rem 1rem auto; margin: 0; padding: 0; border: 0; background: none; overflow: visible; }
.toast { display: flex; gap: 0.75rem; align-items: center; margin-top: 0.5rem; padding: 0.75rem 1rem;
  border-radius: 6px; background: #1f2937; color: #fff; }
.toast[data-kind='error'] { background: #b91c1c; }
.toast-enter-active, .toast-leave-active { transition: opacity 200ms, transform 200ms; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(0.5rem); }
```

## Above modal dialogs

An open modal `<dialog>` makes the rest of the page inert: a toast outside it would be visible but couldn't be clicked or reached with Tab, and screen readers would skip it. While a modal dialog is open, the Toaster moves its region into that dialog, where it stays on top and usable, and back when the dialog closes or is removed. Toasts shown before the dialog opened move with it. Nothing is needed on your side; the region keeps its events, Collection items and timers wherever it is.

## Accessibility

- The `role="status"` and `role="alert"` regions are always rendered, even when empty, so screen readers announce a toast when it is added.
- Keep toasts short and don't put the only copy of important information in them: they go away. Use `timeoutMs: 0` for a message the user must act on.
- The timeouts pause while the user hovers or tabs into the toasts ([WCAG 2.2.1](https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable)).

## Testing

`renderComponent()` renders the Toaster with the rest of the app; the timeouts run on fake timers without a driver:

```jsx
import { it, expect, vi } from 'vitest'
import { renderComponent } from 'sygnal'
import App from './App.jsx'

it('shows a toast when a note is saved, and removes it after 5 s', async () => {
  vi.useFakeTimers()
  const t = renderComponent(App)
  await t.ready()
  t.simulateEvent('.save', 'click')
  await t.settle()
  expect(t.query('.toast-text').textContent).toBe('Note saved')
  expect(t.emitted.map((e) => e.type)).toContain('TOAST')

  await vi.advanceTimersByTimeAsync(5000)
  await t.settle()
  expect(t.queryAll('.toast')).toHaveLength(0)
  t.dispose()
  vi.useRealTimers()
})
```
