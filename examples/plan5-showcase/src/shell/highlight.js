// Syntax highlighting for the code panels: highlight.js core with the languages the demos use.
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import css from 'highlight.js/lib/languages/css'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('css', css)

export function highlight(code, file) {
  const language = file.endsWith('.css') ? 'css' : 'javascript'
  return hljs.highlight(code, { language }).value
}
