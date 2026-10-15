// The CI flake of the 6.5.0 release: a Transition's leave timer fired after the test's jsdom
// environment was torn down, so the global `Event` was Node's, and the element's jsdom window
// refused it ("Failed to execute 'dispatchEvent' on 'EventTarget': parameter 1 is not of type
// 'Event'"). pokeDOM now creates the event from the element's own window. Node environment on
// purpose: the global Event here is Node's, as after a jsdom teardown.
import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { pokeDOM } from '../src/cycle/dom/utils.ts'

describe("pokeDOM uses the element's own window", () => {
  it('dispatches on a jsdom element while the global Event is another realm\'s (Node)', () => {
    expect(typeof window).toBe('undefined') // Node, not jsdom
    const dom = new JSDOM('<div id="root"><p id="leaf"></p></div>')
    const seen = []
    dom.window.document.getElementById('root').addEventListener('sygnal-dom', (e) => seen.push(e.type))
    expect(() => pokeDOM(dom.window.document.getElementById('leaf'))).not.toThrow()
    expect(seen).toEqual(['sygnal-dom'])
    dom.window.close()
  })

  it('a detached node or no element: nothing thrown', () => {
    expect(pokeDOM(null)).toBeUndefined()
    const dom = new JSDOM('<p></p>')
    expect(() => pokeDOM(dom.window.document.createElement('p'))).not.toThrow()
    dom.window.close()
  })
})
