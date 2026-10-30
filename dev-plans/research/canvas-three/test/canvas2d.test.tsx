// @vitest-environment jsdom
import {describe, it, expect} from 'vitest'
import {renderComponent} from 'sygnal'
import {Chart} from '../app/Chart'
import {islandOf} from '../lib/island'

const chart = (t: any) => islandOf(t.container.querySelector('.chart'))

describe('<Canvas2D>: a retained 2D scene with hit testing (jsdom, no canvas context)', () => {
  it('the display list follows the children; hits become the bar\'s own events', async () => {
    const t = renderComponent(Chart, {dom: 'real'})
    await t.ready()
    const c = chart(t)
    // the axis line + 6 × (rect, text)
    expect(c.list.map((i: any) => i.tag).join(' ')).toBe('line ' + 'rect text '.repeat(6).trim())
    // the hidden children are real SVG elements: the bars are selectable, with their accessible names
    const bars = [...t.container.querySelectorAll('rect.bar')]
    expect(bars.map((b: any) => b.getAttribute('aria-label'))[4]).toBe('Fri: 22')
    // the middle of Thu's bar (index 3)
    const thu = c.list.filter((i: any) => i.tag == 'rect')[3]
    const x = thu.ox + thu.a.width / 2, y = thu.oy - 5
    c.pointer('move', x, y)
    await t.waitForState((s: any) => s.hover == 'Thu')
    c.pointer('down', x, y); c.pointer('up', x, y)
    await t.waitForState((s: any) => s.bars[3].on)
    await t.settle()
    expect(t.container.querySelector('.tip').textContent).toBe('Thu · selected total 15')
    expect(chart(t).list.filter((i: any) => i.tag == 'rect')[3].a.fill).toBe('#ffb547')
    // the label has pointer-events none, the gap between bars is empty: nothing there
    expect(c.pointer('down', thu.ox + thu.a.width / 2, thu.oy + 10)).toBe(null)
    c.pointer('leave', 0, 0)
    await t.waitForState((s: any) => s.hover == null)
    t.dispose()
  })
})
