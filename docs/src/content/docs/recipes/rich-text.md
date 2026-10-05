---
title: Rich Text (Tiptap)
description: A Tiptap editor as a Sygnal widget tag, with its HTML in state and toolbar buttons as element commands
---

[Tiptap](https://tiptap.dev/) is a rich-text editor built on ProseMirror. Its core doesn't depend on a framework, so [`defineWidget`](/guide/widgets/) turns it into a JSX tag: the document is HTML in your state, each edit comes back as an event, and toolbar buttons run the editor's commands through [element commands](/guide/element-commands/).

## Install

```sh
npm install @tiptap/core @tiptap/pm @tiptap/starter-kit
```

## The widget

```js
// RichText.js
import { defineWidget } from 'sygnal'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'

export const RichText = defineWidget({
  name: 'RichText',
  mount: (el, props, dispatch) => new Editor({
    element: el,
    extensions: [StarterKit],
    content: props.html,
    editorProps: { attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': props.label } },
    onUpdate: ({ editor }) => dispatch('edit', editor.getHTML()),
  }),
  update: (editor, props) => {
    if (props.html !== editor.getHTML()) editor.commands.setContent(props.html, { emitUpdate: false })
  },
  unmount: (editor) => editor.destroy(),
  events: ['edit'],
  commands: {
    bold: (editor) => editor.chain().focus().toggleBold().run(),
    italic: (editor) => editor.chain().focus().toggleItalic().run(),
  },
})
```

- `mount` creates the editor inside the host `<div>`. Tiptap adds its own editable element there; `editorProps.attributes` labels it.
- `onUpdate` runs after each change the user makes and sends the new HTML as the `edit` event.
- `update` gets the HTML from state. When the user typed it, it is what the editor already holds and nothing happens. When the state changed it some other way (a reset, a loaded draft), `setContent` replaces the document, with `emitUpdate: false` so the change isn't sent back as an edit.
- The `bold` and `italic` commands run Tiptap commands on the instance. `focus()` comes first because clicking a toolbar button moves the focus to the button.

## Using it

```jsx
// Notes.jsx
import { RichText } from './RichText.js'

export function Notes({ state }) {
  return (
    <section>
      <div role="toolbar" aria-label="Formatting">
        <button type="button" className="make-bold">Bold</button>
        <button type="button" className="make-italic">Italic</button>
        <button type="button" className="clear">Clear</button>
      </div>
      <RichText className="body" label="Notes" html={state.html} />
      <p className="saved">{state.html.length} characters saved</p>
    </section>
  )
}

Notes.initialState = { html: '<p>Hello</p>' }

Notes.intent = ({ DOM }) => ({
  EDIT: DOM.select('.body').events('edit').detail(),
  BOLD: DOM.click('.make-bold'),
  ITALIC: DOM.click('.make-italic'),
  CLEAR: DOM.click('.clear'),
})

Notes.model = {
  EDIT: (state, html) => ({ ...state, html }),
  BOLD: { ELEMENT: { bold: '.body' } },
  ITALIC: { ELEMENT: { italic: '.body' } },
  CLEAR: (state) => ({ ...state, html: '<p></p>' }),
}
```

The label is a prop of its own (`label`), not `aria-label`: an `aria-label` prop would go on the host `<div>`, and the element a screen reader lands on is Tiptap's editable element inside it.

To save the notes across reloads, add [`persist()`](/guide/persistence/) to the root and pick `html`.

## Testing

In the mock DOM, `t.widget('.body')` sends the editor's events, and `t.commands()` lists the element commands the toolbar sent:

```jsx
// Notes.test.jsx
import { test, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { Notes } from './Notes.jsx'

test('edits reach the state, and the toolbar sends commands to the editor', async () => {
  const t = renderComponent(Notes)
  await t.ready()
  t.widget('.body').dispatch('edit', '<p>Hello <strong>you</strong></p>')
  await t.next((state) => state.html === '<p>Hello <strong>you</strong></p>')

  t.simulateEvent('.make-bold', 'click')
  t.simulateEvent('.make-italic', 'click')
  await t.settle()
  expect(t.commands()).toEqual([{ bold: '.body' }, { italic: '.body' }])

  t.simulateEvent('.clear', 'click')
  await t.next((state) => state.html === '<p></p>')
  expect(t.widget('.body').props.html).toBe('<p></p>')
  t.dispose()
})
```

Tiptap also starts in jsdom: with `renderComponent(Notes, { dom: 'real' })`, `t.widget('.body').instance` is the editor, and `t.dispose()` destroys it (`editor.isDestroyed`). Typing and selecting text need a real browser (Playwright); there, select a word, click **Bold**, and the state's HTML gets a `<strong>`.

## Size

Measured with Vite, minified and gzipped, Sygnal not included: Tiptap with `StarterKit` (paragraphs, headings, lists, code, quotes, marks, history) adds **128 KB**. Pass only the extensions you need instead of `StarterKit` to make it smaller. `defineWidget` adds 1.1 KB for the first widget in an app.

## Pitfalls

- **Compare before `setContent`.** Without the `props.html !== editor.getHTML()` check, every keystroke would set the content again and move the cursor to the end.
- **Tiptap normalises HTML.** `getHTML()` returns the editor's own serialisation (`<p>Hello</p>`, an empty document is `<p></p>`), which may differ from the HTML you started with. Store what `getHTML()` returns; then the comparison in `update` holds.
- **Keep `emitUpdate: false`.** Without it, a reset from state comes back as an `edit` event: harmless here (the same HTML), but a second action for every external change.
- **Toolbar state.** To show which marks are active (`aria-pressed` on the Bold button), add an `onSelectionUpdate` / `onTransaction` callback that dispatches `editor.isActive('bold')` as an event of its own, and keep it in state.
- **Untrusted HTML.** Tiptap only keeps what its extensions know, but HTML you save and show elsewhere (`innerHTML`) still needs sanitising there.
