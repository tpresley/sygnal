// enrichEventStream .data() must work where there is no DOM (no global Element),
// e.g. vitest's node environment with mock DOM events.
import { describe, it, expect } from 'vitest'
import xs from 'xstream'
import { enrichEventStream } from '../src/cycle/dom/enrichEventStream.js'

describe('enrichEventStream .data() without a DOM', () => {
  it('reads target.dataset when Element is not defined', async () => {
    expect(typeof Element).toBe('undefined')
    const event = { target: { dataset: { id: '7' } } }
    const values = []
    enrichEventStream(xs.of(event, { target: null }, undefined))
      .data('id', v => (v === undefined ? v : Number(v)))
      .addListener({ next: v => values.push(v) })
    expect(values).toEqual([7, undefined, undefined])
  })
})
