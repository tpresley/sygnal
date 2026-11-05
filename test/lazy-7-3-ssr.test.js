// @vitest-environment node
// 7.3: on a server (no document) lazy() without `when` still imports at once, so a server render
// after the import has the component (the browser imports at the first render: lazy-7-3.test.js)
import { it, expect, vi } from 'vitest'
import { lazy, renderToString } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

it('imports at lazy(), and renderToString renders the loaded component', async () => {
  const load = vi.fn(() => Promise.resolve({ default: () => h('p', null, 'chart') }))
  const Chart = lazy(load)
  expect(load).toHaveBeenCalledTimes(1)
  await Chart.load()
  function Page() { return h('div', null, [h(Chart)]) }
  Page.initialState = {}
  expect(renderToString(Page)).toContain('<p>chart</p>')
})
