// PLAN-7 C-4: a static diagnostic's `fixes` (sygnal-check --json / --graph), as in
// sygnal-check/schema/inspect.schema.json
import type { InspectDiagnostic, InspectFix, InspectTextEdit } from 'sygnal'

declare const d: InspectDiagnostic
const fixes: InspectFix[] | undefined = d.fixes
const edit: InspectTextEdit | undefined = fixes?.[0].edits[0]
const range: [number, number] | undefined = edit && [edit.start, edit.end]

const fromCheck: InspectDiagnostic = {
  code: 'SYG110', severity: 'warn', message: "selector '.ad' targets .ad, but App's view never renders that class",
  file: 'App.jsx', line: 2, column: 45, endLine: 2, endColumn: 49,
  fixes: [{
    title: "Change '.ad' to '.add'", kind: 'quickfix', preferred: true,
    edits: [{ file: 'App.jsx', start: 104, end: 109, line: 2, column: 45, endLine: 2, endColumn: 49, text: "'.add'" }],
  }],
}
// @ts-expect-error a fix is a quickfix or a refactor
const badKind: InspectFix = { title: 'x', kind: 'source', edits: [] }
// @ts-expect-error an edit has both offsets and positions
const noOffsets: InspectTextEdit = { file: 'App.jsx', line: 1, column: 1, endLine: 1, endColumn: 2, text: '' }

export { range, fromCheck, badKind, noOffsets }
