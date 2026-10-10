/**
 * PLAN-7 C-4: edits on a model object literal, for the editor-only fixes:
 *   SYG101  add a stub entry `X: (state, data) => state, // TODO`
 *   SYG102  remove an entry (its line, or the property and its comma)
 */

const IDENT = /^[A-Za-z_$][\w$]*$/
const keyText = (name) => (IDENT.test(name) ? name : `'${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`)

/** The start of `pos`'s line, its indentation, and whether only whitespace precedes `pos` on it. */
function lineOf(src, pos) {
  let start = pos
  while (start > 0 && src[start - 1] !== '\n' && src[start - 1] !== '\r') start--
  const indent = /^[ \t]*/.exec(src.slice(start, pos))[0]
  return { start, indent, alone: indent.length === pos - start }
}

/** After `node`: the offset past an optional comma, and the end of the line when only blanks or a // comment follow. */
function after(src, end) {
  let p = end
  while (src[p] === ' ' || src[p] === '\t') p++
  const comma = src[p] === ','
  if (comma) p++
  let nl = src.indexOf('\n', p)
  if (nl < 0) nl = src.length
  const lineEnd = src[nl - 1] === '\r' ? nl - 1 : nl
  const rest = src.slice(p, lineEnd)
  return { comma, past: p, lineEnd, nl, restBlank: /^[ \t]*(\/\/.*)?$/.test(rest) }
}

/**
 * Edits inserting `name: (state, data) => state` (with a TODO comment) as the last entry of
 * `obj` (an ObjectExpression in `file`): on its own line after the last entry, with that entry's
 * indentation, adding the comma it lacks; inside `{}` on a new indented line; in a one-line
 * object, inline. null when the object holds only comments.
 */
export function addEntryEdits(file, obj, name) {
  const src = file.source
  const stub = `${keyText(name)}: (state, data) => state`
  const props = obj.properties
  if (!props.length) {
    if (src.slice(obj.start + 1, obj.end - 1).trim()) return null
    const { indent } = lineOf(src, obj.start)
    const unit = indent.includes('\t') ? '\t' : '  '
    const eol = src.includes('\r\n') ? '\r\n' : '\n'
    return [{ file: file.path, start: obj.start, end: obj.end, text: `{${eol}${indent}${unit}${stub}, // TODO${eol}${indent}}` }]
  }
  const last = props[props.length - 1]
  const line = lineOf(src, last.start)
  const tail = after(src, last.end)
  if (line.alone && src.slice(obj.start, last.start).includes('\n') && tail.restBlank && tail.nl < obj.end) {
    const eol = src[tail.nl - 1] === '\r' ? '\r\n' : '\n'
    return [
      ...(tail.comma ? [] : [{ file: file.path, start: last.end, end: last.end, text: ',' }]),
      { file: file.path, start: tail.lineEnd, end: tail.lineEnd, text: `${eol}${line.indent}${stub}, // TODO` },
    ]
  }
  return [{ file: file.path, start: last.end, end: last.end, text: `, ${stub} /* TODO */` }]
}

/**
 * Edits removing the properties `remove` of `obj`: a property alone on its line(s) with its
 * whole lines (and a trailing // comment), otherwise the property and its comma; `{}` when
 * every property goes. null when the ranges would overlap (several inline entries).
 */
export function removeEntryEdits(file, obj, remove) {
  const src = file.source
  const props = obj.properties
  // every entry goes: the empty object
  if (remove.length === props.length) return [{ file: file.path, start: obj.start, end: obj.end, text: '{}' }]
  const edits = []
  for (const prop of remove) {
    const i = props.indexOf(prop)
    if (i < 0) return null
    const line = lineOf(src, prop.start)
    const tail = after(src, prop.end)
    if (line.alone && tail.restBlank && tail.nl < obj.end) edits.push({ file: file.path, start: line.start, end: tail.nl + 1, text: '' })
    else if (i < props.length - 1) edits.push({ file: file.path, start: prop.start, end: props[i + 1].start, text: '' })
    else edits.push({ file: file.path, start: props[i - 1].end, end: prop.end, text: '' })
  }
  edits.sort((a, b) => a.start - b.start)
  for (let i = 1; i < edits.length; i++) if (edits[i].start < edits[i - 1].end) return null
  return edits
}
