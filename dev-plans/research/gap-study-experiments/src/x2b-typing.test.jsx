// @vitest-environment jsdom
import { it, expect, afterEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { renderComponent } from 'sygnal'
function F({ state }) { return <div><input className="draft" value={state.draft} /><p className="echo">{state.draft}</p></div> }
F.initialState = { draft: '' }
F.intent = ({ DOM }) => ({ DRAFT: DOM.input('.draft').value() })
F.model = { DRAFT: (s, draft) => ({ ...s, draft }) }
let t; afterEach(() => t?.dispose())
for (const delay of [0, 1, 5, 20]) {
  it(`controlled input keeps every keystroke (delay ${delay}ms)`, async () => {
    t = renderComponent(F, { dom: 'real' }); await t.ready()
    const user = userEvent.setup({ delay })
    await user.type(t.query('.draft'), 'Hello world')
    await t.settle()
    console.log(`delay=${delay}: input="${t.query('.draft').value}" state="${t.state.draft}"`)
    expect(t.query('.draft').value).toBe('Hello world')
  })
}
