// The forms the types and class= allow, in a real engine: style="a: b" (the first patch threw),
// a class key with spaces (classList.add threw), a boolean style value (the old value stayed) and
// a className array.
import { run, Transition } from 'sygnal'
import { mount, assert, runTest, waitFor, wait } from '../harness.js'

const CAT = 'Style and class forms'

export async function styleClassFormTests() {
  await runTest(CAT, 'string style, class key with spaces, boolean style value, className array', async () => {
    const { id, el } = mount()
    function App({ state }) {
      return <div>
        <p className="a" style={state.on ? 'color: rgb(255, 0, 0); margin-top: 3px !important' : { color: 'rgb(0, 0, 255)' }}>a</p>
        <p className="b" class={{ 'p-4 m-2': state.on }}>b</p>
        <p className="c" style={{ color: state.on && 'rgb(255, 0, 0)' }}>c</p>
        <p className={['d', 'e']}>d</p>
        <button className="go">go</button>
      </div>
    }
    App.initialState = { on: true }
    App.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    App.model = { GO: (s) => ({ ...s, on: false }) }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.a'))
    const a = el.querySelector('.a'), b = el.querySelector('.b'), c = el.querySelector('.c'), d = el.querySelector('.d')
    assert(a.style.color === 'rgb(255, 0, 0)' && a.style.getPropertyPriority('margin-top') === 'important', `string style: ${a.style.cssText}`)
    assert(b.classList.contains('p-4') && b.classList.contains('m-2'), `class with spaces: ${b.className}`)
    assert(c.style.color === 'rgb(255, 0, 0)', 'c on')
    assert(d.className === 'd e', `className array: ${d.className}`)
    el.querySelector('.go').click()
    await waitFor(() => !b.classList.contains('p-4'))
    assert(a.style.color === 'rgb(0, 0, 255)' && a.style.marginTop === '', `string to object: ${a.style.cssText}`)
    assert(c.style.color === '', `false clears: ${c.style.cssText}`)
  })

  // a leaving element under a Transition goes however its CSS ends (or doesn't)
  const leaves = (title, name, css, check) => runTest(CAT, title, async () => {
    const style = document.createElement('style')
    style.textContent = css
    document.head.appendChild(style)
    const { id, el } = mount()
    function App({ state }) {
      return <div><button className="go">go</button><Transition name={name}>{state.on && <p className="t"><span className="kid">x</span></p>}</Transition></div>
    }
    App.initialState = { on: true }
    App.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    App.model = { GO: (s) => ({ ...s, on: !s.on }) }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.t'))
    await wait(60)
    el.querySelector('.go').click()
    if (check) await check(el)
    await waitFor(() => !el.querySelector('.t'), 2000)
    el.querySelector('.go').click()
    await waitFor(() => el.querySelector('.t'))
    assert(el.querySelectorAll('.t').length === 1, 'one element after showing it again')
    style.remove()
  })

  await leaves('Transition: a name with no CSS leaves at once', 'nocss', '')
  await leaves('Transition: a transition whose value never changes ends by the timer', 'same', '.same-leave-active { transition: opacity 80ms } .t { opacity: 1 }')
  await leaves('Transition: a CSS animation ends it', 'anim', '@keyframes tout { to { opacity: 0 } } .anim-leave-active { animation: tout 80ms }')
  await leaves('Transition: a child\'s transitionend does not end the element\'s', 'kidt', `
    .kidt-leave-active { transition: opacity 400ms } .kidt-leave-to { opacity: 0 }
    .kidt-leave-active .kid { transition: color 30ms } .kidt-leave-to .kid { color: rgb(255, 0, 0) }`, async (el) => {
    await wait(200)
    assert(el.querySelector('.t'), 'still leaving after the child ended')
  })

  // CSS-10: Firefox emptied the <style> when its innerHTML was re-set on adoption
  await runTest(CAT, 'adopting server markup keeps a <style innerHTML>', async () => {
    const { id, el } = mount()
    const css = '.adopted > p { color: rgb(1, 2, 3) }'
    el.innerHTML = `<div class="adopted"><style>${css}</style><p>x</p></div>`
    function App() { return <div className="adopted"><style innerHTML={css} /><p>x</p></div> }
    run(App, {}, { mountPoint: id })
    await wait(60)
    assert(el.querySelector('style')?.textContent === css, `style text: ${el.querySelector('style')?.textContent}`)
    assert(getComputedStyle(el.querySelector('p')).color === 'rgb(1, 2, 3)', 'the rule applies')
  })
}
