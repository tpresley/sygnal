// The exact requests (system prompt, messages, schema) for a case; shared by the runner and the frontier pack.
import { opsSchemaV2, opsSystemPromptV2, applyOpsV2, systemPrompt, layoutSchema, layoutToReply, stringToLayout, describeLayout, opsSchema, opsSystemPrompt, normalizeCatalog, readLayout, applyOps, reconcileKeys, layoutToTree, readReply, repairTree, treeToLayout } from '../llm-composer.mjs'

export function shotMessages(catalog, encoding, shots) {
  const enc = encoding === 'two' ? 'blocks' : encoding
  return shots.flatMap(([prompt, want, asked]) => [
    { role: 'user', content: prompt },
    { role: 'assistant', content: JSON.stringify({ ...(enc.endsWith('+plan') && { asked_for: asked }), ...layoutToReply(stringToLayout(want, normalizeCatalog(catalog).root), enc, catalog) }) },
  ])
}

/** a fresh composition: { system, messages, schema } (encoding 'two' gives the select step; see secondStep) */
export function composeRequest(catalog, encoding, prompt, { shots = [] } = {}) {
  const enc = encoding === 'two' ? 'select' : encoding
  return {
    system: systemPrompt(catalog, enc),
    messages: [...(enc === 'select' ? [] : shotMessages(catalog, enc, shots)), { role: 'user', content: prompt }],
    schema: layoutSchema(catalog, enc),
  }
}

export function secondStep(catalog, prompt, ids) {
  return {
    system: systemPrompt(catalog, 'blocks', { only: ids }),
    messages: [{ role: 'user', content: prompt }],
    schema: layoutSchema(catalog, 'blocks', { only: ids }),
  }
}

/** an edit: mode 'whole' (the encoding's own shape back) or 'ops' */
export function editRequest(catalog, encoding, prevString, prompt, mode) {
  const prev = stringToLayout(prevString, normalizeCatalog(catalog).root)
  // defaults filled, like a layout the app would hold
  const prevL = treeToLayout(repairTree(catalog, layoutToTree(prev), []).tree)
  if (mode === 'ops2') {
    return { prev: prevL, system: opsSystemPromptV2(catalog), messages: [{ role: 'user', content: `Current page:\n${describeLayout(prevL)}\n\nChange: ${prompt}` }], schema: opsSchemaV2(catalog, prevL) }
  }
  if (mode === 'ops') {
    return { prev: prevL, system: opsSystemPrompt(catalog), messages: [{ role: 'user', content: `Current page:\n${describeLayout(prevL)}\n\nChange: ${prompt}` }], schema: opsSchema(catalog, prevL) }
  }
  return {
    prev: prevL,
    system: systemPrompt(catalog, encoding, { edit: 'whole' }),
    messages: [{ role: 'user', content: `Current page:\n${JSON.stringify(layoutToReply(prevL, encoding, catalog))}\n\nChange: ${prompt}` }],
    schema: layoutSchema(catalog, encoding),
  }
}

/** raw model text → parsed value (tolerates code fences and prose around the JSON) */
export function parseReply(text) {
  if (typeof text !== 'string') return { value: text }
  try { return { value: JSON.parse(text) } } catch {}
  const m = /\{[\s\S]*\}/.exec(text.replace(/<think>[\s\S]*?<\/think>/g, ''))
  if (m) try { return { value: JSON.parse(m[0]) } } catch {}
  return { error: 'unparseable' }
}

/** a reply to a whole-layout or composition request → { layout, issues, invalid } */
export function readComposition(catalog, encoding, text, { prev } = {}) {
  const { value, error } = parseReply(text)
  if (error) return { invalid: 1, layout: { root: 'n0', nodes: { n0: { part: normalizeCatalog(catalog).root, slots: { default: [] } } } }, issues: [{ kind: 'invalid', detail: error }] }
  if (!prev) return { ...readLayout(catalog, encoding, value), invalid: 0 }
  const { tree, issues } = readReply(catalog, encoding, value)
  const fixed = repairTree(catalog, tree, issues)
  return { layout: treeToLayout(reconcileKeys(prev, fixed.tree)), issues, invalid: 0 }
}

export function readOps(catalog, prev, text, mode = 'ops') {
  const { value, error } = parseReply(text)
  if (error || !Array.isArray(value?.ops)) return { invalid: 1, layout: prev, issues: [{ kind: 'invalid', detail: error || 'no ops' }] }
  return { ...(mode === 'ops2' ? applyOpsV2 : applyOps)(catalog, prev, value.ops), invalid: 0 }
}
