// compose.llm() edits that reach containers (dev-plans/research/ai-compose/container-edits.md): the
// `wrap` / `unwrap` operations and `into <key>` places, on for a catalog with containers other than
// a row (`containers: false` turns them off). Keys of the parts an edit moves stay theirs.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { llm, editPrompt, opsSchema, applyOps, preorder } from '../src/extra/ai/compose/llm.ts'
import { finish, fromTree } from '../src/extra/ai/compose/layout.ts'
import { configureDiagnostics, _resetDiagnostics } from '../src/extra/diagnostics/index.ts'
import { catalog, tree, str, names } from './p9-llm-helpers.js'

beforeEach(() => { _resetDiagnostics(); configureDiagnostics({ mode: 'collect' }) })
afterEach(() => _resetDiagnostics())

const anywhere = ['page', 'section']
const cat = catalog({
  parts: Object.fromEntries(['dates', 'amount', 'approver', 'contact', 'details'].map((p) => [p, { description: p, in: anywhere }])),
  containers: { section: { description: 'Section', maxUses: 3, params: { title: { type: 'text', required: true, maxLength: 40 } } } },
  limits: { maxParts: 10, maxDepth: 2 },
})
const page = (s) => finish(cat, fromTree(cat, tree(s)), {})
const run = (prev, ops) => {
  const a = applyOps(cat, {}, prev, preorder(prev), ops, { containers: true })
  return { ...a, layout: finish(cat, a.layout, {}) }
}
const titles = (l) => Object.values(l.nodes).filter((n) => n.part === 'section').map((n) => n.params.title)

describe('wrap, unwrap and into (the default for a catalog with containers)', () => {
  it('the prompt lists wrap and unwrap and the into place; the schema has them, `into` only for containers on the page', () => {
    const prev = page('section{title=Trip}(dates,amount) details')
    const p = editPrompt(cat, {})
    expect(p).toContain('{"op":"wrap","nodes":["<key>", ...],"part":"<container id>","params":{...}}')
    expect(p).toContain('"into <key>" (at the end of that container)')
    const s = opsSchema(cat, {}, prev)
    const where = s.properties.ops.items.anyOf[0].properties.where.enum
    expect(where).toContain('into n1')
    expect(where).not.toContain('into n2')
    const wrap = s.properties.ops.items.anyOf.find((o) => o.properties.op.const === 'wrap')
    expect(wrap.required).toEqual(['op', 'nodes', 'part', 'params'])
    expect(wrap.properties.params.required).toEqual(['title'])
    expect(s.properties.ops.items.anyOf.find((o) => o.properties.op.const === 'unwrap').properties.node.enum).toEqual(['n1'])
    // containers: false, or a catalog with rows only: the research's ops2
    expect(editPrompt(cat, {}, { containers: false })).not.toContain('"op":"wrap"')
    expect(opsSchema(cat, {}, prev, undefined, undefined, { containers: false }).properties.ops.items.anyOf.some((o) => o.properties.op.const === 'wrap')).toBe(false)
    const rows = catalog({ parts: { a: { description: 'A' }, b: { description: 'B' } } })
    expect(editPrompt(rows, {})).not.toContain('"op":"wrap"')
  })

  it('wrap: a new container where the first node was, the nodes in order, keys kept', () => {
    const prev = page('contact dates amount approver details')
    const r = run(prev, [
      { op: 'wrap', nodes: ['n2', 'n3'], part: 'section', params: { title: 'Trip' } },
      { op: 'wrap', nodes: ['n4', 'n1'], part: 'section', params: { title: 'Approval' } },
    ])
    expect(str(cat, r.layout)).toBe('section(dates,amount) section(approver,contact) details')
    expect(titles(r.layout)).toEqual(['Trip', 'Approval'])
    for (const k of ['contact', 'dates', 'amount', 'approver', 'details']) expect(r.layout.nodes[k].part).toBe(k)
    expect(r.ops[0]).toMatchObject({ op: 'wrap', nodes: ['dates', 'amount'], part: 'section' })
  })

  it('into: a move or an add at the end of a container; above / below stay inside it', () => {
    const prev = page('section{title=Trip}(dates,amount) details')
    expect(str(cat, run(prev, [{ op: 'move', node: 'n4', where: 'into n1' }]).layout)).toBe('section(dates,amount,details)')
    expect(str(cat, run(prev, [{ op: 'add', part: 'approver', where: 'into n1' }]).layout)).toBe('section(dates,amount,approver) details')
    expect(str(cat, run(prev, [{ op: 'add', part: 'approver', where: 'above n3' }]).layout)).toBe('section(dates,approver,amount) details')
    // out of the container: a place on the page
    expect(str(cat, run(prev, [{ op: 'move', node: 'n3', where: 'below n1' }]).layout)).toBe('section(dates) amount details')
    // into a node that is not a container, or into itself: not applied
    expect(run(prev, [{ op: 'move', node: 'n1', where: 'into n1' }]).applied).toBe(0)
    expect(run(prev, [{ op: 'move', node: 'n4', where: 'into n2' }]).applied).toBe(0)
  })

  it('unwrap: the parts take the container\'s place; maxUses holds for wrap', () => {
    const prev = page('section{title=Trip}(dates,amount) section{title=Approval}(approver,contact) details')
    expect(str(cat, run(prev, [{ op: 'unwrap', node: 'n1' }, { op: 'unwrap', node: 'n4' }]).layout)).toBe('dates amount approver contact details')
    expect(run(prev, [{ op: 'unwrap', node: 'n2' }]).applied).toBe(0)
    const full = page('section{title=A}(dates) section{title=B}(amount) section{title=C}(approver) details')
    const r = run(full, [{ op: 'wrap', nodes: ['n7'], part: 'section', params: { title: 'D' } }])
    expect(r.applied).toBe(0)
  })

  it('end to end: start(), reply() with the model\'s operations, keyed', () => {
    const prev = page('contact dates amount approver details')
    const b = llm()
    const { pending } = b.start({ catalog: cat, state: {}, prompt: 'Trip section', previous: prev, names })
    const r = b.reply({ catalog: cat, state: {}, pending, reply: { text: JSON.stringify({ ops: [{ op: 'wrap', nodes: ['n2', 'n3'], part: 'section', params: { title: 'Trip' } }] }) } })
    expect(r.keyed).toBe(true)
    expect(str(cat, r.layout)).toBe('contact section(dates,amount) approver details')
  })
})
