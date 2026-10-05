import { renderComponent } from 'sygnal'
import { Toolbar } from './Toolbar.jsx'
import { assert, equal, pw } from '../browser-util.js'

export const tests = {
  async 'Lucide: icons render as real SVG (namespace, attributes, drawn paths); patches keep them'() {
    const t = renderComponent(Toolbar, { dom: 'real', initialState: { count: 0, online: false } })
    await t.ready()
    const svg = t.query('.add svg')
    equal(svg.namespaceURI, 'http://www.w3.org/2000/svg', 'svg namespace')
    equal(svg.querySelector('path').namespaceURI, 'http://www.w3.org/2000/svg', 'path namespace')
    equal(svg.getAttribute('viewBox'), '0 0 24 24')
    equal(svg.getAttribute('stroke-width'), '2')
    assert(svg.getBBox().width > 0 && svg.querySelector('path').getTotalLength() > 0, 'drawn')
    equal(t.query('.status svg').getAttribute('aria-label'), 'Offline')

    await pw('click', '.add')
    await pw('click', '.add')
    await t.waitForState((state) => state.count === 2)
    assert(t.query('.add svg') === svg, 'the same SVG element after re-renders')
    await pw('click', '.remove')
    await t.waitForState((state) => state.count === 1)
    t.dispose()
  },
}
