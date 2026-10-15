/**
 * 6.5.0 state paths: SYG401 follows a Collection / VirtualCollection from="a.b" path through the
 * literal initialState; positions index a path's first segment as the use of that state key.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles } from '../src/index.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

function check(src) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-paths-'))
  fs.writeFileSync(path.join(tmp, 'B.jsx'), src)
  return checkFiles([path.join(tmp, 'B.jsx')], { cwd: tmp }).filter(d => d.code === 'SYG401')
}

const board = (from, init = "{ board: { name: 'b', cards: [] }, boards: [{ cards: [] }], deck: makeDeck() }") => `import { Collection } from 'sygnal'
function Card() { return <li /> }
export function B() { return <ul><Collection of={Card} from="${from}" /></ul> }
B.initialState = ${init}
function makeDeck() { return { cards: [] } }
`

describe('SYG401 (static) on a from path', () => {
  it('nothing for a path to an array, through objects and array positions', () => {
    expect(check(board('board.cards'))).toEqual([])
    expect(check(board('boards.0.cards'))).toEqual([])
    expect(check(board('boards[0].cards'))).toEqual([])
  })

  it('a missing key along the path names the keys of that level', () => {
    const [d] = check(board('board.crads'))
    expect(d.message).toBe("<Collection from=\"board.crads\"> but B.initialState has no 'board.crads' (keys there: name, cards)")
    expect(check(board('bord.cards'))[0].message).toMatch(/'bord' is not a key of B\.initialState \(keys: board, boards, deck\)/)
  })

  it('a path to a literal that is not an array', () => {
    expect(check(board('board.name'))[0].message).toBe('<Collection from="board.name"> but B.initialState.board.name is not an array')
  })

  it("nothing where the value isn't a literal it can follow (a call, a spread)", () => {
    expect(check(board('deck.cards'))).toEqual([])
    expect(check(board('board.cards', '{ board: { ...base } }'))).toEqual([])
  })
})
