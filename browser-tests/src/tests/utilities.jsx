import { run, classes, processForm, driverFromAsync } from 'sygnal'
import xs from 'xstream'
import { mount, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'Utilities'

export async function utilityTests() {
  // classes() utility
  await runTest(CAT, 'classes() joins class names', async () => {
    const result = classes('foo', 'bar')
    assert(result === 'foo bar', `Expected "foo bar" but got "${result}"`)
  })

  await runTest(CAT, 'classes() handles conditional objects', async () => {
    const result = classes('base', { active: true, hidden: false })
    assert(result.includes('base'), 'Should include base')
    assert(result.includes('active'), 'Should include active')
    assert(!result.includes('hidden'), 'Should not include hidden')
  })

  await runTest(CAT, 'classes() handles arrays', async () => {
    const result = classes(['a', 'b'], 'c')
    assert(result.includes('a') && result.includes('b') && result.includes('c'))
  })

  await runTest(CAT, 'classes() deduplicates', async () => {
    const result = classes('foo', 'foo', 'bar')
    assert(result === 'foo bar', `Expected "foo bar" but got "${result}"`)
  })

  // processForm
  await runTest(CAT, 'processForm extracts form field values', async () => {
    const { id, el } = mount()
    function App({ state } = {}) {
      return <div>
        <form className="my-form">
          <input name="email" className="email-field" value={state.email} />
          <button type="submit">Submit</button>
        </form>
        <span className="result">{state.submitted}</span>
      </div>
    }
    App.initialState = { email: 'test@test.com', submitted: 'no' }
    App.intent = ({ DOM }) => ({
      SUBMIT: processForm(DOM.select('.my-form')),
    })
    App.model = {
      SUBMIT: (state, formData) => ({ ...state, submitted: formData.email || 'empty' }),
    }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.my-form'))
    // Submit the form programmatically
    el.querySelector('.my-form').dispatchEvent(new Event('submit', { bubbles: true }))
    await waitFor(() => el.querySelector('.result')?.textContent !== 'no', 2000)
  })

  // driverFromAsync
  await runTest(CAT, 'driverFromAsync creates working async driver', async () => {
    const { id, el } = mount()
    // driverFromAsync expects sink objects with { value: arg, category?: string }
    // and calls the function with the 'value' property
    const mockFetcher = (query) => Promise.resolve(`Found: ${query}`)
    const searchDriver = driverFromAsync(mockFetcher)

    function App({ state } = {}) {
      return <div>
        <span className="search-result">{state.result}</span>
        <button className="search-btn">Search</button>
      </div>
    }
    App.initialState = { result: 'none' }
    App.intent = ({ DOM, SEARCH }) => ({
      DO_SEARCH: DOM.click('.search-btn'),
      GOT_RESULT: SEARCH.select(),
    })
    App.model = {
      // Sink must be an object with 'value' (default args property)
      DO_SEARCH: { SEARCH: () => ({ value: 'test-query', category: 'search' }) },
      // Response comes as { value: result, category: 'search' }
      GOT_RESULT: (state, data) => ({ result: data.value }),
    }
    run(App, { SEARCH: searchDriver }, { mountPoint: id })
    await waitFor(() => el.querySelector('.search-btn'))
    el.querySelector('.search-btn').click()
    await waitFor(() => el.querySelector('.search-result')?.textContent === 'Found: test-query', 3000)
  })
}
