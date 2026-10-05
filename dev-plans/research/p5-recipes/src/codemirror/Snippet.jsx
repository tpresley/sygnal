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
