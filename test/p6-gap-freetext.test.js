// PLAN-6 G-634: commandBar's free-text heuristic on realistic commands for an "add a todo" action
// (description 'Add a new todo'). The expected texts were written before the heuristic was
// changed (but one, added after a held-out check); `old` is the 3-M heuristic (a quoted part, else the command minus its first word),
// kept here to report before / after. undefined: "can't tell" (the command escalates).
import { describe, it, expect } from 'vitest'
import { freeText } from '../src/extra/ai/commandBar.ts'

const DESC = 'Add a new todo'
const old = (command) => {
  const q = /"([^"]+)"|“([^”]+)”|'([^']+)'/.exec(command)
  const t = q ? q[1] ?? q[2] ?? q[3] : command.trim().replace(/^\S+\s*/, '')
  return t.trim() || undefined
}

export const CASES = [
  ['add walk the dog', 'walk the dog'],
  ['remind me to call mom', 'call mom'],
  ['add buy milk to the list', 'buy milk'],
  ['please add "renew passport"', 'renew passport'],
  ['put renew passport on the list', 'renew passport'],
  ['add a todo to water the plants', 'water the plants'],
  ['new todo: pay rent', 'pay rent'],
  ['I need to pick up the dry cleaning', 'pick up the dry cleaning'],
  ['remember to book the dentist', 'book the dentist'],
  ["don't forget to email Sam", 'email Sam'],
  ['create a task to file the tax return', 'file the tax return'],
  ['add an item: buy stamps', 'buy stamps'],
  ['can you add feed the cat', 'feed the cat'],
  ['buy eggs', 'buy eggs'],
  ['add milk to my shopping list', 'milk'],
  ['remind me to call the bank tomorrow', 'call the bank tomorrow'],
  ['jot down call the plumber', 'call the plumber'],
  ['add "call mom" please', 'call mom'],
  ['please add pick up kids', 'pick up kids'],
  ['add a reminder to renew the car insurance', 'renew the car insurance'],
  ['todo: clean the garage', 'clean the garage'],
  ['add to my list: buy bread', 'buy bread'],
  ['I want to add wash the car', 'wash the car'],
  ['make a note to call the vet', 'call the vet'],
  ['add Call Grandma', 'Call Grandma'],
  ['track renewing my passport', 'renewing my passport'],
  ['remind me about the parent-teacher meeting', 'parent-teacher meeting'],
  ['Add pay the electricity bill.', 'pay the electricity bill'],
  // added after a held-out check (16 more commands: before 2/16, after 14/16)
  ['note: call the insurance company', 'call the insurance company'],
  ['what have I finished?', undefined],
  ['add', undefined],
]

describe('G-634: the free-text heuristic', () => {
  it('realistic commands: before / after', () => {
    const before = CASES.filter(([c, want]) => old(c) === want).length
    const misses = CASES.filter(([c, want]) => freeText(c, DESC) !== want).map(([c, want]) => [c, want, freeText(c, DESC)])
    const after = CASES.length - misses.length
    console.log(`G-634 free text: before ${before}/${CASES.length}, after ${after}/${CASES.length}`, misses)
    expect(misses).toEqual([])
  })

  it('a quoted part wins; the action description adds its own words', () => {
    expect(freeText('please put “call the bank” somewhere')).toBe('call the bank')
    // a description's first word is a verb to strip, its last a noun (an "errand")
    expect(freeText('log an errand: post office', 'Log an errand')).toBe('post office')
    expect(freeText('log post office')).toBe('log post office')
  })
})
