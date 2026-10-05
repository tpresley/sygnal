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
