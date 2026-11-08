import { describe, it, expect } from 'vitest'
import { renderToString, createElement as h } from '../dist/index.esm.js'

const render = (v) => { function App() { return v } return renderToString(App, {}) }

describe('<style> and <script> text in SSR (raw text elements)', () => {
  it('a <style> keeps its CSS as written', () => {
    expect(render(h('div', {}, [h('style', {}, ':scope > p::before { content: "x" & }')]))).toContain('<style>:scope > p::before { content: "x" & }</style>')
  })

  it('several text children stay raw', () => {
    expect(render(h('style', {}, 'a > b {}', ' c > d {}'))).toContain('a > b {} c > d {}')
  })

  it('a <script> keeps JSON as written', () => {
    expect(render(h('script', { type: 'application/ld+json' }, '{"a":"b > c"}'))).toContain('>{"a":"b > c"}</script>')
  })

  it("text can't close the element", () => {
    const style = render(h('style', {}, 'a { content: "</style><img src=x onerror=alert(1)>" }'))
    expect(style.match(/<\/style/gi)).toHaveLength(1)
    expect(style).toContain('</\\73 tyle>')
    const script = render(h('script', {}, '"</SCRIPT><script>x"'))
    expect(script.match(/<\/script/gi)).toHaveLength(1)
    expect(script).toContain('</\\u0053CRIPT><\\u0073cript>')
  })

  it('other elements still escape their text', () => {
    expect(render(h('p', {}, 'a > b'))).toContain('a &gt; b')
  })
})
