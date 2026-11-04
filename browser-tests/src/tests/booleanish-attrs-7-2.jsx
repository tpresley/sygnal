// React DOM's booleanish string attributes in a real engine (Sift console port): spellcheck="false"
// was set as the spellcheck property, which a non-empty string makes true. Now spellcheck,
// draggable and contenteditable are attributes, true / false written as "true" / "false".
import { run } from 'sygnal'
import { mount, assert, runTest, waitFor } from '../harness.js'

const CAT = 'Booleanish attributes (7.2)'

export async function booleanishAttrTests7_2() {
  await runTest(CAT, 'spellcheck / draggable / contenteditable "false" and false are off; true is on; a change patches them', async () => {
    const { id, el } = mount()
    function App({ state }) {
      return <div>
        <textarea className="a" spellcheck="false" draggable={state.on} />
        <input className="b" spellCheck={state.on} />
        <div className="c" contenteditable={state.on ? 'true' : false} draggable="false">x</div>
        <button className="go">go</button>
      </div>
    }
    App.initialState = { on: false }
    App.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    App.model = { GO: (s) => ({ ...s, on: true }) }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.a'))
    const a = el.querySelector('.a'), b = el.querySelector('.b'), c = el.querySelector('.c')
    assert(a.spellcheck === false && a.getAttribute('spellcheck') === 'false', `spellcheck="false": ${a.spellcheck} / ${a.getAttribute('spellcheck')}`)
    assert(a.draggable === false && a.getAttribute('draggable') === 'false', `draggable={false}: ${a.draggable}`)
    assert(b.spellcheck === false && b.getAttribute('spellcheck') === 'false', `spellCheck={false}: ${b.spellcheck}`)
    assert(c.isContentEditable === false && c.getAttribute('contenteditable') === 'false', `contenteditable={false}: ${c.isContentEditable}`)
    assert(c.draggable === false, 'draggable="false" on a div')
    el.querySelector('.go').click()
    await waitFor(() => a.draggable === true)
    assert(a.spellcheck === false, 'spellcheck="false" stays off')
    assert(b.spellcheck === true && b.getAttribute('spellcheck') === 'true', `spellCheck={true}: ${b.spellcheck}`)
    assert(c.isContentEditable === true, 'contenteditable="true"')
  })
}
