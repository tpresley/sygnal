// Syntax highlighting for the code panels: Prism with its JSX grammar, so the JavaScript inside
// JSX (`data={{ id }}`, `{state.n > 0 && <b />}`) is highlighted as JavaScript, not as text.
import Prism from 'prismjs'
import 'prismjs/components/prism-jsx.js'

export const highlight = (code, file) => (file.endsWith('.css')
  ? Prism.highlight(code, Prism.languages.css, 'css')
  : Prism.highlight(code, Prism.languages.jsx, 'jsx'))
