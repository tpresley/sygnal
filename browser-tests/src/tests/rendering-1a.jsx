// Regression tests for PLAN-2 workstream 1-A (rendering and props), real DOM.
import { run } from 'sygnal'
import { mount, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'Rendering and props (PLAN-2 1-A)'

async function mountToggle(view) {
  const { id, el } = mount()
  function App({ state }) {
    return <div><button className="flip">flip</button>{view(state)}</div>
  }
  App.initialState = { on: false }
  App.intent = ({ DOM }) => ({ FLIP: DOM.click('.flip') })
  App.model = { FLIP: s => ({ ...s, on: !s.on }) }
  run(App, {}, { mountPoint: id })
  await waitFor(() => el.querySelector('.flip'))
  const flip = async () => { el.querySelector('.flip').click(); await wait(50) }
  return { el, flip }
}

const classes = (elm) => [...elm.classList].sort().join(' ')

export async function renderingTests1A() {
  // ─── B-014: string / array `class` ─────────────────────────────────────────
  await runTest(CAT, 'B-014: class="a b" sets the classes a and b and updates', async () => {
    const { el, flip } = await mountToggle(s => <p id="b014a" class={s.on ? 'b c' : 'a b'}>x</p>)
    const p = el.querySelector('#b014a')
    assert(classes(p) === 'a b', `initial: "${p.getAttribute('class')}"`)
    await flip()
    assert(classes(p) === 'b c', `updated: "${p.getAttribute('class')}"`)
  })

  await runTest(CAT, 'B-014: class={["a", cond && "b"]} sets the truthy entries', async () => {
    const { el, flip } = await mountToggle(s => <p id="b014b" class={['a', s.on && 'b', null]}>x</p>)
    const p = el.querySelector('#b014b')
    assert(classes(p) === 'a', `initial: "${p.getAttribute('class')}"`)
    await flip()
    assert(classes(p) === 'a b', `flipped: "${p.getAttribute('class')}"`)
  })

  // ─── B-015: removed props are cleared ──────────────────────────────────────
  await runTest(CAT, 'B-015: a removed title / disabled / href is cleared', async () => {
    const { el, flip } = await mountToggle(s => s.on
      ? <div><p id="b015t">t</p><button id="b015d">d</button><a id="b015h">h</a></div>
      : <div><p id="b015t" title="tip">t</p><button id="b015d" disabled>d</button><a id="b015h" href="#x">h</a></div>)
    assert(el.querySelector('#b015t').title === 'tip', 'initial title')
    assert(el.querySelector('#b015d').disabled === true, 'initial disabled')
    await flip()
    const t = el.querySelector('#b015t'); const d = el.querySelector('#b015d'); const h = el.querySelector('#b015h')
    assert(!t.hasAttribute('title'), `title left: "${t.getAttribute('title')}"`)
    assert(d.disabled === false, 'button still disabled')
    assert(!h.hasAttribute('href'), `href left: "${h.getAttribute('href')}"`)
    await flip()
    assert(el.querySelector('#b015t').title === 'tip' && el.querySelector('#b015d').disabled, 're-added')
  })

  await runTest(CAT, 'B-015: title={cond ? "x" : undefined} never renders "undefined"', async () => {
    const { el, flip } = await mountToggle(s => <p id="b015u" title={s.on ? 'x' : undefined}>u</p>)
    const p = el.querySelector('#b015u')
    assert(!p.hasAttribute('title'), `initial: "${p.getAttribute('title')}"`)
    await flip()
    assert(p.title === 'x', 'set')
    await flip()
    assert(!p.hasAttribute('title'), `cleared: "${p.getAttribute('title')}"`)
  })

  // ─── G-095: clearing a URL prop doesn't write '' first ─────────────────────
  const GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='
  const errorsIn = (el) => {
    const seen = []
    el.addEventListener('error', e => seen.push(e.target.tagName), true)
    return seen
  }

  await runTest(CAT, 'G-095: <img src={undefined}> fires no error event, on create or on removal', async () => {
    const { el, flip } = await mountToggle(s => <div>
      <img id="g095a" src={undefined} alt="" />
      <img id="g095b" src={s.on ? undefined : GIF} alt="" />
    </div>)
    const seen = errorsIn(el)
    await wait(100)
    assert(!el.querySelector('#g095a').hasAttribute('src'), 'src attribute on create')
    assert(seen.length === 0, `error events after create: ${seen}`)
    await flip()
    await wait(100)
    assert(!el.querySelector('#g095b').hasAttribute('src'), 'src attribute left after removal')
    assert(seen.length === 0, `error events after removal: ${seen}`)
  })

  // Removing an iframe's src attribute navigates it to about:blank (HTML spec, "process the
  // iframe attributes"), so that part of G-095 can't be avoided while B-015 removes the
  // attribute. Guard: the attribute is removed and no stray "undefined"/"null" URL is fetched.
  await runTest(CAT, 'G-095: removing an iframe src removes the attribute and fetches no "undefined" URL', async () => {
    const { el, flip } = await mountToggle(s => <iframe id="g095f" src={s.on ? undefined : '/g095-frame.html'} />)
    const frame = el.querySelector('#g095f')
    await waitFor(() => frame.contentWindow.location.pathname === '/g095-frame.html')
    await flip()
    await wait(150)
    assert(!frame.hasAttribute('src'), 'src attribute left after removal')
    const stray = performance.getEntriesByType('resource').filter(e => /\/(undefined|null)$/.test(e.name))
    assert(stray.length === 0, `fetched ${stray.map(e => e.name)}`)
  }, 5000)

  // ─── B-017: controlled <select> whose options change in the same patch ─────
  await runTest(CAT, 'B-017: a <select> takes a new value whose <option> is added in the same render', async () => {
    const { id, el } = mount()
    function App({ state }) {
      return <div>
        <select className="pick" value={state.value}>{state.options.map(o => <option value={o}>{o}</option>)}</select>
        <button className="add">add</button>
      </div>
    }
    App.initialState = { value: 'b', options: ['a', 'b'] }
    App.intent = ({ DOM }) => ({ ADD: DOM.click('.add'), PICK: DOM.change('.pick').map(e => e.target.value) })
    App.model = {
      ADD: s => ({ ...s, options: [...s.options, 'c'], value: 'c' }),
      PICK: (s, value) => ({ ...s, value }),
    }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.pick'))
    const select = el.querySelector('.pick')
    assert(select.value === 'b', `initial: ${select.value}`)
    el.querySelector('.add').click()
    await wait(60)
    assert(select.options.length === 3, 'option added')
    assert(select.value === 'c', `after add: ${select.value}`)
  })
}
