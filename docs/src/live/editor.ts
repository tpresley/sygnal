// The CodeMirror setup shared by the Try It page (src/pages/try-it.astro) and the live
// examples (src/live/runtime.ts): the extensions, the always-dark theme and the syntax colors.
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, highlightSpecialChars, drawSelection, highlightActiveLine, lineNumbers, highlightActiveLineGutter, type KeyBinding } from '@codemirror/view'
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { syntaxHighlighting, HighlightStyle, indentOnInput, bracketMatching } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { tags as t } from '@lezer/highlight'

// Theme — always dark, hardcoded colors to avoid Starlight variable changes
export const sygnalTheme = EditorView.theme({
  '&': {
    backgroundColor: '#0d1117',
    color: '#c9d1d9',
  },
  '.cm-content': {
    padding: '12px 0',
    caretColor: '#c9d1d9',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#c9d1d9' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: '#264f78',
  },
  '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.04)' },
  '.cm-gutters': {
    backgroundColor: '#0d1117',
    color: 'rgba(255,255,255,0.25)',
    border: 'none',
    paddingLeft: '4px',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgba(255,255,255,0.04)',
    color: 'rgba(255,255,255,0.5)',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'transparent',
    border: 'none',
    color: '#666',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'rgba(255,255,255,0.1)',
    outline: '1px solid rgba(255,255,255,0.25)',
  },
}, { dark: true })

// Syntax colors (VS Code Dark+ inspired)
export const sygnalHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#c586c0' },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: '#9cdcfe' },
  { tag: [t.function(t.variableName), t.labelName], color: '#dcdcaa' },
  { tag: [t.propertyName], color: '#9cdcfe' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: '#4fc1ff' },
  { tag: [t.definition(t.name), t.separator], color: '#c9d1d9' },
  { tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: '#4ec9b0' },
  { tag: [t.number], color: '#b5cea8' },
  { tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.special(t.string)], color: '#d4d4d4' },
  { tag: [t.meta, t.comment], color: '#6a9955', fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: '#9cdcfe', textDecoration: 'underline' },
  { tag: t.heading, fontWeight: 'bold', color: '#4fc1ff' },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: '#569cd6' },
  { tag: [t.processingInstruction, t.string, t.inserted], color: '#ce9178' },
  { tag: t.invalid, color: '#f44747' },
  // JSX-specific
  { tag: t.angleBracket, color: '#808080' },
  { tag: t.tagName, color: '#4ec9b0' },
  { tag: t.attributeName, color: '#9cdcfe' },
  { tag: t.attributeValue, color: '#ce9178' },
])

// Always use dark theme for the code editor
export const themeExtensions = [sygnalTheme, syntaxHighlighting(sygnalHighlightStyle)]

export interface EditorOptions {
  /** TypeScript syntax (ts/tsx blocks); JSX is always on */
  typescript?: boolean
  /** runs on each change of the document */
  onChange?: () => void
  /** key bindings that take precedence over the default keymap (e.g. Mod-Enter) */
  keys?: KeyBinding[]
  /** more extensions (e.g. attributes for the content element) */
  extra?: Extension[]
}

/** the editor's extensions: the same list for Try It and the live examples */
export function editorExtensions({ typescript = false, onChange, keys = [], extra = [] }: EditorOptions = {}): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    javascript({ jsx: true, typescript }),
    ...themeExtensions,
    keymap.of([
      ...keys,
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange?.()
    }),
    ...extra,
  ]
}

export function createEditor(parent: Element, doc: string, options: EditorOptions = {}): EditorView {
  return new EditorView({
    state: EditorState.create({ doc, extensions: editorExtensions(options) }),
    parent,
  })
}

export { EditorView }
