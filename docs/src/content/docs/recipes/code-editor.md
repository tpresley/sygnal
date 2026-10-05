---
title: Code Editor (CodeMirror)
description: A CodeMirror 6 editor as a Sygnal widget tag, with its document in state and a focus command
---

[CodeMirror 6](https://codemirror.net/) is a code editor made of an `EditorView` and extensions. [`defineWidget`](/guide/widgets/) turns it into a JSX tag: the code is a string in your state, each change comes back as an event, and a `focus` command focuses the editor from the model.

## Install

```sh
npm install codemirror @codemirror/lang-javascript
```

## The widget

```js
// CodeEditor.js
import { defineWidget } from 'sygnal'
import { EditorView, basicSetup } from 'codemirror'
import { javascript } from '@codemirror/lang-javascript'

export const CodeEditor = defineWidget({
  name: 'CodeEditor',
  mount: (el, props, dispatch) => new EditorView({
    parent: el,
    doc: props.code,
    extensions: [
      basicSetup,
      javascript(),
      EditorView.contentAttributes.of({ 'aria-label': props.label }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) dispatch('edit', update.state.doc.toString())
      }),
    ],
  }),
  update: (view, props) => {
    const code = view.state.doc.toString()
    if (props.code !== code) view.dispatch({ changes: { from: 0, to: code.length, insert: props.code } })
  },
  unmount: (view) => view.destroy(),
  events: ['edit'],
  commands: { focus: (view) => view.focus() },
})
```

- `mount` creates the view inside the host `<div>` (`parent: el`). `basicSetup` brings line numbers, history, bracket matching, search and autocompletion.
- The update listener sends the whole document as the `edit` event after each change.
- `update` gets the code from state. When the user typed it, it equals the editor's document and nothing happens; otherwise one transaction replaces the document.
- `view.dispatch` is CodeMirror's own method for applying a transaction. It has nothing to do with the widget's `dispatch`, the third parameter of `mount`, which sends events to the intent.
- The `focus` command focuses the editable area. A command the widget declares wins over the host element's method of the same name, so `{ focus: '.code' }` runs this one, not the `<div>`'s.

## Using it

```jsx
// Snippet.jsx
import { CodeEditor } from './CodeEditor.js'

const START = 'const answer = 42\n'

export function Snippet({ state }) {
  return (
    <section>
      <CodeEditor className="code" label="Snippet" code={state.code} />
      <p className="lines">{state.code.split('\n').length} lines</p>
      <button type="button" className="edit-code">Edit</button>
      <button type="button" className="reset">Reset</button>
    </section>
  )
}

Snippet.initialState = { code: START }

Snippet.intent = ({ DOM }) => ({
  EDIT: DOM.select('.code').events('edit').detail(),
  FOCUS_CODE: DOM.click('.edit-code'),
  RESET: DOM.click('.reset'),
})

Snippet.model = {
  EDIT: (state, code) => ({ ...state, code }),
  FOCUS_CODE: { ELEMENT: { focus: '.code' } },
  RESET: (state) => ({ ...state, code: START }),
}
```

## Testing

```jsx
// Snippet.test.jsx
import { test, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { Snippet } from './Snippet.jsx'

test('edits reach the state, Reset puts the start code back', async () => {
  const t = renderComponent(Snippet)
  await t.ready()
  t.widget('.code').dispatch('edit', 'const answer = 42\nconsole.log(answer)\n')
  await t.next((state) => state.code.includes('console.log'))
  expect(t.query('.lines').textContent).toBe('3 lines')

  t.simulateEvent('.reset', 'click')
  await t.next((state) => state.code === 'const answer = 42\n')
  expect(t.widget('.code').props.code).toBe('const answer = 42\n')

  t.simulateEvent('.edit-code', 'click')
  await t.settle()
  expect(t.commands()).toEqual([{ focus: '.code' }])
  t.dispose()
})
```

CodeMirror measures text positions with layout APIs jsdom doesn't have, so test typing in a real browser: with `renderComponent(Snippet, { dom: 'real' })` under Playwright, click **Edit**, type, and `t.waitForState((state) => ...)` sees the new code; `t.widget('.code').instance` is the `EditorView`.

## Size

Measured with Vite, minified and gzipped, Sygnal not included: `basicSetup` with the JavaScript language adds **177 KB**. For a smaller editor, replace `basicSetup` with `minimalSetup` (history, default keymap, special characters) and the extensions you want from `@codemirror/view`, `@codemirror/commands` and the language packages. `defineWidget` adds 1.1 KB for the first widget in an app.

## Pitfalls

- **Keep the comparison in `update`.** Replacing the document on every render would reset the cursor and the undo history while the user types.
- **A reset is also an edit.** The transaction `update` dispatches changes the document, so the listener sends it back as an `edit` with the same code. That costs one extra action and changes nothing. To skip it, add an annotation to the transaction (`annotations: Transaction.remote.of(true)` from `@codemirror/state`) and ignore updates that carry it.
- **Change configuration with compartments.** `mount` builds the extensions once. To switch the language, the theme or `readOnly` from props, wrap that extension in a `Compartment` and reconfigure it in `update` (`view.dispatch({ effects: compartment.reconfigure(...) })`).
- **Label the editable element.** The host `<div>` is not what receives the keyboard. `EditorView.contentAttributes` puts `aria-label` on CodeMirror's `.cm-content`, the element a screen reader announces.
- **Tab.** CodeMirror doesn't trap Tab by default, so keyboard users can leave the editor. Adding `indentWithTab` changes that; if you do, tell users that Escape then Tab leaves the editor.
