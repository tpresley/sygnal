/**
 * False-positive guard: the maintained examples must stay warning-free,
 * and the kanban example must check in well under 2 s.
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { check } from '../src/index.js'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// Known true positives left in place in the examples (none since 2D-A fixed
// kanban's SYG111 lane title input).
const KNOWN = new Set()
const key = d => `${d.code} ${d.file} ${d.component}`

describe('repo examples', () => {
  for (const ex of ['examples/kanban/src', 'examples/todomvc', 'examples/ts-example-2048/src', 'examples/getting-started/src']) {
    it(`${ex} has no warnings`, () => {
      const diags = check([ex], { cwd: repo })
      expect(diags.filter(d => d.severity !== 'info' && !KNOWN.has(key(d)))).toEqual([])
    })
  }

  it('kanban no longer has the SYG111 controlled lane-title input (fixed in 2D-A with titleDraft)', () => {
    const hits = check(['examples/kanban/src'], { cwd: repo }).filter(d => d.code === 'SYG111')
    expect(hits).toEqual([])
  })

  it('checks examples/kanban in under 2 s', () => {
    const t0 = performance.now()
    check(['examples/kanban/src'], { cwd: repo })
    expect(performance.now() - t0).toBeLessThan(2000)
  })

  it('finds the real bugs in the eval starters (tasks 06 and 07)', () => {
    const t06 = check(['evals/agent-ergonomics/tasks/06-fix-add-button/starter/src'], { cwd: repo })
    expect(t06.map(d => d.code)).toEqual(['SYG110'])
    const t07 = check(['evals/agent-ergonomics/tasks/07-fix-remove-button/starter/src'], { cwd: repo })
    expect(t07.map(d => d.code)).toEqual(['SYG104'])
  })
})
