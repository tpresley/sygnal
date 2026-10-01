// Regression tests for PLAN-1 workstream 3D (API fixes found while writing llms.txt), real DOM.
import { run } from 'sygnal'
import { mount, assert, runTest, waitFor } from '../harness.js'

const CAT = 'API fixes (3D)'

export async function apiFixTests3D() {
  // B-028: data={{ taskId }} renders data-task-id; .data('taskId') must find it on the
  // ancestor when the click lands on a nested child
  await runTest(CAT, "B-028: .data('taskId') reads data-task-id from an ancestor of a nested click target", async () => {
    const { id, el } = mount()
    function App({ state } = {}) {
      return <div>
        <span className="val">{state.picked}</span>
        <div className="card" data={{ taskId: 'T-42' }}>
          <h3 className="title"><b className="inner">Task</b></h3>
        </div>
      </div>
    }
    App.initialState = { picked: 'none' }
    App.intent = ({ DOM }) => ({ PICK: DOM.click('.card').data('taskId') })
    App.model = { PICK: (_, picked) => ({ picked: String(picked) }) }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.inner'))
    assert(el.querySelector('.card').getAttribute('data-task-id') === 'T-42', 'card renders data-task-id')
    el.querySelector('.inner').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await waitFor(() => el.querySelector('.val')?.textContent !== 'none')
    const got = el.querySelector('.val').textContent
    assert(got === 'T-42', `expected T-42, got ${got}`)
  })
}
