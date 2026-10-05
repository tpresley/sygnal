// PLAN-5 W-3 (from spike 0-S6; S-10, S-11): real Web Awesome 3 web components in a Sygnal app.
//   canonical (D189): <wa-rating className="food" />, DOM.select('.food').events('change').value(Number)
//   CustomEvent payloads with .detail() (wa-hover, wa-select), properties vs attrs, boolean props,
//   form-associated elements in a <form> (processForm / FormData), Collection isolation,
//   controls({ Rating: 'wa-rating' }) as the alternative form, a11y names, late upgrade,
//   renderToString + client start, and a defineElement (sygnal/element) next to Web Awesome.
// Input is real Playwright pointer/keyboard input (run-headless.mjs exposes window.__pw); the
// locators pierce open shadow roots. A hand-run page (npm run dev) falls back to DOM events.
import { run, Collection, ABORT, controls, processForm, renderToString } from 'sygnal'
import { defineElement } from 'sygnal/element'
import '@awesome.me/webawesome/dist/styles/themes/default.css'
import '@awesome.me/webawesome/dist/components/rating/rating.js'
import '@awesome.me/webawesome/dist/components/input/input.js'
import '@awesome.me/webawesome/dist/components/switch/switch.js'
import '@awesome.me/webawesome/dist/components/select/select.js'
import '@awesome.me/webawesome/dist/components/option/option.js'
import '@awesome.me/webawesome/dist/components/dropdown/dropdown.js'
import '@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js'
import '@awesome.me/webawesome/dist/components/button/button.js'
import { assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'Web Awesome (PLAN-5 W-3)'
const pw = (action, selector, arg) => window.__pw(action, selector, arg)
const hasPw = () => typeof window.__pw === 'function'

// #test-containers is off-screen (left: -9999px); real pointer input needs an on-screen element,
// so these tests mount into a fixed stage on top of the page, emptied before each test
let stage
let mounted = 0
function mount() {
  if (!stage) {
    stage = document.createElement('div')
    stage.style.cssText = 'position: fixed; top: 0; left: 0; width: 800px; z-index: 10000; background: #fff;'
    document.body.appendChild(stage)
  }
  const el = document.createElement('div')
  el.id = `p5w3-${++mounted}`
  el.style.margin = '8px'
  stage.appendChild(el)
  return { id: `#${el.id}`, el }
}
const test = (name, fn) => runTest(CAT, name, async () => {
  try { await fn() } finally { if (stage) stage.replaceChildren() }
}, 12000)

async function start(App, drivers = {}) {
  const { id, el } = mount()
  const app = run(App, drivers, { mountPoint: id })
  await waitFor(() => el.firstElementChild)
  await wait(30)
  return { id, el, app }
}
// Lit renders asynchronously: wait for an element's pending update
const settled = async (el) => { await el.updateComplete; await wait(20) }
const text = (el, sel) => el.querySelector(sel)?.textContent

// Click the n-th symbol (1-based) of a wa-rating with the real pointer: the rating maps clientX to a value
async function clickStar(selector, n, el = document.querySelector(selector)) {
  const r = el.getBoundingClientRect()
  const max = el.max || 5
  const position = { x: Math.round((r.width * (n - 0.5)) / max), y: Math.round(r.height / 2) }
  if (hasPw()) return pw('click', selector, { position })
  el.value = n
  el.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
}

// ── 1. canonical: tag + class selector ─────────────────────────────────────────────────────

function Review({ state }) {
  return (
    <div className="review">
      <wa-rating className="food" label="Food" value={state.food} readonly={state.locked} attrs={{ size: 'l' }} />
      <p className="out">{`${state.food}|${state.hover}`}</p>
      <button className="lock">lock</button>
      <button className="three">three</button>
    </div>
  )
}
Review.initialState = { food: 2, hover: 0, locked: false }
Review.intent = ({ DOM }) => ({
  FOOD: DOM.select('.food').events('change').value(Number),
  HOVER: DOM.select('.food').events('wa-hover').detail((d) => (d.phase === 'end' ? 0 : d.value)),
  LOCK: DOM.select('.lock').events('click'),
  THREE: DOM.select('.three').events('click'),
})
Review.model = {
  FOOD: (s, food) => ({ ...s, food }),
  HOVER: (s, hover) => ({ ...s, hover }),
  LOCK: (s) => ({ ...s, locked: !s.locked }),
  THREE: (s) => ({ ...s, food: 3 }),
}

// ── 2. inputs: wa-input, wa-switch, wa-select, wa-dropdown ─────────────────────────────────

function Prefs({ state }) {
  return (
    <div className="prefs">
      <wa-input className="email" label="Email" value={state.email} withClear />
      <wa-input className="dashed" label="Dashed" with-clear />
      <wa-input className="attr" label="Attr" attrs={{ 'with-clear': true, placeholder: 'from attrs' }} />
      <wa-switch className="notify" checked={state.notify}>Notify me</wa-switch>
      <wa-select className="size" label="Size" value={state.size}>
        <wa-option value="s">Small</wa-option>
        <wa-option value="m">Medium</wa-option>
        <wa-option value="l">Large</wa-option>
      </wa-select>
      <wa-dropdown className="menu">
        <wa-button slot="trigger" withCaret>Actions</wa-button>
        <wa-dropdown-item value="copy">Copy</wa-dropdown-item>
        <wa-dropdown-item value="paste">Paste</wa-dropdown-item>
      </wa-dropdown>
      <p className="out">{`${state.email}|${state.notify}|${state.size}|${state.action}|${state.cleared}`}</p>
      <button className="reset">reset</button>
    </div>
  )
}
Prefs.initialState = { email: 'a@b.c', notify: false, size: 'm', action: '', cleared: 0 }
Prefs.intent = ({ DOM }) => ({
  EMAIL: DOM.select('.email').events('input').value(),
  CLEAR: DOM.select('.email').events('wa-clear'),
  NOTIFY: DOM.select('.notify').events('change').checked(),
  SIZE: DOM.select('.size').events('change').value(),
  ACTION: DOM.select('.menu').events('wa-select').detail((d) => d.item.value),
  RESET: DOM.select('.reset').events('click'),
})
Prefs.model = {
  EMAIL: (s, email) => ({ ...s, email }),
  CLEAR: (s) => ({ ...s, cleared: s.cleared + 1 }),
  NOTIFY: (s, notify) => ({ ...s, notify }),
  SIZE: (s, size) => ({ ...s, size }),
  ACTION: (s, action) => ({ ...s, action }),
  RESET: (s) => ({ ...s, email: '', notify: true, size: 'l' }),
}

// ── 3. form-associated elements in a <form> ────────────────────────────────────────────────

function Signup({ state }) {
  return (
    <form className="signup">
      <wa-input name="email" label="Email" value={state.email} />
      <wa-rating name="stars" label="Stars" value={state.stars} />
      <wa-rating attrs={{ name: 'stars2' }} label="Stars 2" value={state.stars} />
      <wa-switch name="news" checked={state.news}>News</wa-switch>
      <input name="plain" value={state.plain} />
      <button type="submit" className="go">Go</button>
      <p className="out">{JSON.stringify(state.submitted)}</p>
      <p className="live">{JSON.stringify(state.live)}</p>
    </form>
  )
}
Signup.initialState = { email: 'x@y.z', stars: 4, news: true, plain: 'p', submitted: null, live: null }
Signup.intent = ({ DOM }) => ({
  SUBMIT: processForm(DOM.select('.signup'), { events: 'submit' }),
  LIVE: processForm(DOM.select('.signup'), { events: 'input' }),
})
Signup.model = {
  SUBMIT: (s, { email, stars, stars2, news, plain }) => ({ ...s, submitted: { email, stars: stars ?? null, stars2, news: news ?? null, plain } }),
  LIVE: (s, { email, event }) => ({ ...s, live: [...(s.live || []), `${event.target.value}/${email}`] }),
}

// ── 4. Collection isolation ───────────────────────────────────────────────────────────────

function Dish({ state }) {
  return (
    <li className="dish">
      <span className="name">{state.name}</span>
      <wa-rating className="stars" label={`Rate ${state.name}`} value={state.stars} />
      <span className="val">{state.stars}</span>
    </li>
  )
}
Dish.intent = ({ DOM }) => ({ RATE: DOM.select('.stars').events('change').value(Number) })
Dish.model = { RATE: (s, stars) => ({ ...s, stars }) }

function Menu({ state }) {
  return (
    <div className="menu-app">
      <ul><Collection of={Dish} from="dishes" /></ul>
      <p className="leaks">{state.leaks}</p>
    </div>
  )
}
Menu.initialState = { dishes: [{ id: 1, name: 'soup', stars: 1 }, { id: 2, name: 'stew', stars: 1 }], leaks: 0 }
Menu.intent = ({ DOM }) => ({ LEAK: DOM.select('.stars').events('change') })
Menu.model = { LEAK: (s) => ({ ...s, leaks: s.leaks + 1 }) }

// ── 5. controls (alternative form, D141/D189) ──────────────────────────────────────────────

const { Rating, Email } = controls({ Rating: 'wa-rating', Email: 'wa-input' })

function Survey({ state }) {
  return (
    <div className="survey">
      <Rating label="Service" value={state.service} />
      <Email label="Contact" value={state.contact} />
      <p className="out">{`${state.service}|${state.hover}|${state.contact}`}</p>
    </div>
  )
}
Survey.initialState = { service: 1, hover: 0, contact: '' }
Survey.intent = ({ DOM }) => ({
  SERVICE: DOM.select(Rating).events('change').value(Number),
  HOVER: DOM.select(Rating).events('wa-hover').detail((d) => d.value),
  CONTACT: DOM.input(Email).value(),
})
Survey.model = {
  SERVICE: (s, service) => ({ ...s, service }),
  HOVER: (s, hover) => ({ ...s, hover }),
  CONTACT: (s, contact) => ({ ...s, contact }),
}

// ── 6. controlled drift: a model that refuses a value ─────────────────────────────────────

function Capped({ state }) {
  return <div><wa-rating className="capped" label="Capped" value={state.v} /><p className="out">{state.v}</p></div>
}
Capped.initialState = { v: 2 }
Capped.intent = ({ DOM }) => ({ SET: DOM.select('.capped').events('change').value(Number) })
Capped.model = { SET: (s, v) => (v > 3 ? ABORT : { ...s, v }) }

// ── 7. publish (sygnal/element) + consume (Web Awesome) on one page ───────────────────────

function ScoreCard({ state }) {
  return (
    <div className="card">
      <strong className="title">{state.title}</strong>
      <wa-rating className="score" label={state.title} value={state.score} />
    </div>
  )
}
ScoreCard.initialState = { title: 'Untitled', score: 0 }
ScoreCard.intent = ({ DOM }) => ({ SCORE: DOM.select('.score').events('change').value(Number) })
ScoreCard.model = { SCORE: { STATE: (s, score) => ({ ...s, score }), PARENT: (s, score) => ({ score }) } }
defineElement('p5w3-score-card', ScoreCard, { props: { title: String, score: Number }, events: { PARENT: 'score-change' } })
defineElement('p5w3-score-card-shadow', ScoreCard, { props: { title: String, score: Number }, events: { PARENT: 'score-change' }, shadow: true })

function Host({ state }) {
  return (
    <div className="host">
      <p5w3-score-card className="card-a" title="Pasta" score={state.pasta} />
      <p5w3-score-card-shadow className="card-b" title="Pizza" score={state.pizza} />
      <p className="out">{`${state.pasta}|${state.pizza}`}</p>
    </div>
  )
}
Host.initialState = { pasta: 1, pizza: 2 }
Host.intent = ({ DOM }) => ({
  PASTA: DOM.select('.card-a').events('score-change').detail((d) => d.score),
  PIZZA: DOM.select('.card-b').events('score-change').detail((d) => d.score),
})
Host.model = {
  PASTA: (s, pasta) => ({ ...s, pasta }),
  PIZZA: (s, pizza) => ({ ...s, pizza }),
}

// ── tests ─────────────────────────────────────────────────────────────────────────────────

export async function webAwesomeTestsP5W3() {
  await test('canonical <wa-rating className>: pointer + keyboard → change → .value(Number) → state → element', async () => {
    const { id, el, app } = await start(Review)
    const r = el.querySelector('wa-rating')
    await settled(r)
    assert(r.value === 2 && typeof r.value === 'number', `value is a number property: ${r.value}`)
    assert(r.getAttribute('value') === null, 'value is set as a property, not an attribute')
    assert(r.label === 'Food' && r.getAttribute('aria-label') === 'Food', 'label property → aria-label')
    assert(r.getAttribute('size') === 'l' && r.size === 'l', 'attrs={{ size }} → attribute → property')
    assert(r.shadowRoot && r.shadowRoot.querySelectorAll('.symbol').length === 5, 'shadow DOM rendered 5 symbols')
    await clickStar(`${id} .food`, 4)
    await waitFor(() => text(el, '.out').startsWith('4|'))
    if (hasPw()) {
      await pw('focus', `${id} .food`)
      await pw('press', `${id} .food`, 'ArrowLeft')
      await waitFor(() => text(el, '.out').startsWith('3|'))
      await pw('press', `${id} .food`, 'End')
      await waitFor(() => text(el, '.out').startsWith('5|'))
    }
    el.querySelector('.three').click()
    await waitFor(() => text(el, '.out').startsWith('3|'))
    await settled(r)
    assert(r.value === 3, `state → element: ${r.value}`)
    app.dispose()
  })

  await test('wa-hover (an Event with .detail, composed): .detail(fn) reads the payload across the shadow boundary', async () => {
    const { id, el, app } = await start(Review)
    const r = el.querySelector('wa-rating')
    await settled(r)
    if (hasPw()) {
      const b = r.getBoundingClientRect()
      await pw('hover', `${id} .food`, { position: { x: Math.round(b.width * 0.3), y: Math.round(b.height / 2) } })
      await waitFor(() => text(el, '.out') === '2|2')
      await pw('mouse-away')
      await waitFor(() => text(el, '.out') === '2|0')
    } else {
      r.dispatchEvent(Object.assign(new Event('wa-hover', { bubbles: true, composed: true }), { detail: { phase: 'move', value: 2 } }))
      await waitFor(() => text(el, '.out') === '2|2')
    }
    app.dispose()
  })

  await test('boolean props: readonly={bool} is a property; toggling it off clears it (props module)', async () => {
    const { el, app } = await start(Review)
    const r = el.querySelector('wa-rating')
    await settled(r)
    assert(r.readonly === false, 'readonly starts false')
    el.querySelector('.lock').click()
    await waitFor(() => r.readonly === true)
    await settled(r)
    assert(r.hasAttribute('readonly'), 'Lit reflects readonly to the attribute')
    el.querySelector('.lock').click()
    await waitFor(() => r.readonly === false)
    app.dispose()
  })

  await test('properties vs attributes: withClear (property) and attrs={{ "with-clear" }} work; with-clear as a JSX prop does not', async () => {
    const { el, app } = await start(Prefs)
    const [email, dashed, attr] = el.querySelectorAll('wa-input')
    await settled(email)
    assert(email.withClear === true, 'withClear={true} → property')
    assert(attr.withClear === true && attr.getAttribute('with-clear') === '', 'attrs={{ "with-clear": true }} → attribute → property')
    assert(attr.placeholder === 'from attrs', 'attrs placeholder')
    assert(dashed.withClear === false && dashed['with-clear'] === true && !dashed.hasAttribute('with-clear'),
      'with-clear as a JSX prop sets a useless "with-clear" property (pragma: a non-module dash prefix is a prop)')
    app.dispose()
  })

  await test('wa-input: keyboard typing → input → .value() → state; state → value property; wa-clear', async () => {
    const { id, el, app } = await start(Prefs)
    const email = el.querySelector('.email')
    await settled(email)
    assert(email.value === 'a@b.c', `initial value property: ${email.value}`)
    if (hasPw()) {
      await pw('fill', `${id} .email input`, '')
      await pw('type', `${id} .email input`, 'me@x.io')
    } else {
      email.value = 'me@x.io'
      email.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }))
    }
    await waitFor(() => text(el, '.out').startsWith('me@x.io|'))
    el.querySelector('.reset').click()
    await waitFor(() => email.value === '')
    await settled(email)
    assert(email.shadowRoot.querySelector('input').value === '', 'inner input cleared from state')
    // wa-clear: type then press the clear button with the pointer
    if (hasPw()) {
      await pw('type', `${id} .email input`, 'zz')
      await waitFor(() => text(el, '.out').startsWith('zz|'))
      await pw('click', `${id} .email [part~="clear-button"]`)
      await waitFor(() => text(el, '.out').endsWith('|1') && text(el, '.out').startsWith('|'))
    }
    app.dispose()
  })

  await test('wa-switch: pointer click → change → .checked() → state; checked property from state', async () => {
    const { id, el, app } = await start(Prefs)
    const sw = el.querySelector('.notify')
    await settled(sw)
    if (hasPw()) await pw('click', `${id} .notify`)
    else sw.click()
    await waitFor(() => text(el, '.out').split('|')[1] === 'true')
    if (hasPw()) await pw('press', `${id} .notify input`, 'Space')
    else sw.click()
    await waitFor(() => text(el, '.out').split('|')[1] === 'false')
    el.querySelector('.reset').click()
    await waitFor(() => sw.checked === true)
    app.dispose()
  })

  await test('wa-select: open with the pointer, pick an option → change → .value(); value property from state', async () => {
    const { id, el, app } = await start(Prefs)
    const sel = el.querySelector('.size')
    await settled(sel)
    assert(sel.value === 'm', `initial value: ${sel.value}`)
    if (hasPw()) {
      await pw('click', `${id} .size [part~="combobox"]`)
      await waitFor(() => sel.open === true)
      await pw('click', `${id} .size wa-option[value="s"]`)
    } else {
      sel.value = 's'
      sel.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
    }
    await waitFor(() => text(el, '.out').split('|')[2] === 's')
    el.querySelector('.reset').click()
    await waitFor(() => sel.value === 'l')
    app.dispose()
  })

  await test('wa-dropdown: pick an item → wa-select → .detail(d => d.item.value)', async () => {
    const { id, el, app } = await start(Prefs)
    const dd = el.querySelector('.menu')
    await settled(dd)
    if (hasPw()) {
      await pw('click', `${id} .menu wa-button`)
      await waitFor(() => dd.open === true)
      // value is set as a property and wa-dropdown-item doesn't reflect it: no [value] attribute to select by
      assert(!el.querySelector('.menu wa-dropdown-item').hasAttribute('value'), 'value not reflected')
      await pw('click', `${id} .menu wa-dropdown-item:nth-of-type(2)`)
    } else {
      dd.dispatchEvent(Object.assign(new Event('wa-select', { bubbles: true, composed: true }), { detail: { item: { value: 'paste' } } }))
    }
    await waitFor(() => text(el, '.out').split('|')[3] === 'paste')
    app.dispose()
  })

  await test('form-associated: processForm on submit sees wa-input/wa-rating/wa-switch by name (FormData via ElementInternals)', async () => {
    const { id, el, app } = await start(Signup)
    await settled(el.querySelector('wa-input'))
    if (hasPw()) await pw('click', `${id} .go`)
    else el.querySelector('.go').click()
    await waitFor(() => text(el, '.out') !== 'null')
    const got = JSON.parse(text(el, '.out'))
    assert(got.email === 'x@y.z', `email: ${got.email}`)
    // FormData names a form-associated custom element by its name ATTRIBUTE; wa-rating doesn't
    // reflect the name property (wa-input / wa-switch do), so name= as a prop leaves it out
    assert(got.stars === null && !el.querySelector('[label="Stars"], wa-rating').hasAttribute('name'), `name as a prop: ${got.stars}`)
    assert(got.stars2 === '4', `attrs={{ name }} (FormData strings): ${got.stars2}`)
    assert(got.news === 'on', `news: ${got.news}`)
    assert(got.plain === 'p', `plain: ${got.plain}`)
    app.dispose()
  })

  await test('form-associated: processForm on input — FormData vs the element value per keystroke', async () => {
    const { id, el, app } = await start(Signup)
    const input = el.querySelector('wa-input')
    await settled(input)
    if (!hasPw()) return
    await pw('fill', `${id} wa-input input`, '')
    await pw('type', `${id} wa-input input`, 'ab')
    await waitFor(() => input.value === 'ab')
    await wait(50)
    const live = JSON.parse(text(el, '.live'))
    window.__p5w3Live = live
    // e.target.value / FormData's email on each input event. The element's value is always current;
    // FormData (setFormValue runs in Lit's async update) is current in Chromium and WebKit but one
    // keystroke behind in Firefox: read live values from the element, use processForm on submit
    assert(live.map((x) => x.split('/')[0]).join() === ',a,ab', `element values: ${live.join()}`)
    const fd = live.map((x) => x.split('/')[1]).join()
    assert(fd === ',a,ab' || fd === 'x@y.z,,a', `FormData values: ${fd}`)
    app.dispose()
  })

  await test('Collection isolation: a wa-rating in each item; its change reaches only that item, not the parent', async () => {
    const { id, el, app } = await start(Menu)
    const ratings = el.querySelectorAll('.stars')
    assert(ratings.length === 2, 'two items')
    await settled(ratings[1])
    const sel = `${id} li:nth-child(2) .stars`
    await clickStar(sel, 5)
    await waitFor(() => [...el.querySelectorAll('.val')].map((v) => v.textContent).join(',') === '1,5')
    await wait(30)
    assert(text(el, '.leaks') === '0', `parent saw the item's event: ${text(el, '.leaks')}`)
    assert(ratings[0].value === 1, 'first item untouched')
    app.dispose()
  })

  await test('controls({ Rating: "wa-rating" }): <Rating value>, DOM.select(Rating).events("change"/"wa-hover"), DOM.input(Email)', async () => {
    const { id, el, app } = await start(Survey)
    const r = el.querySelector('wa-rating')
    await settled(r)
    assert(r.getAttribute('data-control') === 'Rating' && r.value === 1, 'control renders the tag with data-control')
    await clickStar(`${id} [data-control="Rating"]`, 3)
    await waitFor(() => text(el, '.out').startsWith('3|'))
    if (hasPw()) {
      await pw('type', `${id} [data-control="Email"] input`, 'hi')
      await waitFor(() => text(el, '.out').endsWith('|hi'))
    }
    app.dispose()
  })

  await test('a11y names: role slider "Food", textbox "Email", switch "Notify me", combobox "Size"', async () => {
    const a = await start(Review)
    const b = await start(Prefs)
    await settled(a.el.querySelector('wa-rating'))
    await settled(b.el.querySelector('wa-select'))
    if (hasPw()) {
      const n = async (scope, role, name) => pw('role', scope, { role, name })
      assert(await n(a.id, 'slider', 'Food') === 1, 'slider "Food"')
      assert(await n(b.id, 'textbox', 'Email') === 1, 'textbox "Email"')
      assert(await n(b.id, 'switch', 'Notify me') === 1, 'switch "Notify me"')
      assert(await n(b.id, 'combobox', 'Size') === 1, 'combobox "Size"')
    } else {
      assert(a.el.querySelector('wa-rating').getAttribute('aria-label') === 'Food', 'aria-label')
    }
    a.app.dispose(); b.app.dispose()
  })

  await test('late upgrade: a tag rendered before customElements.define keeps the props Sygnal set', async () => {
    function Late({ state }) { return <div><wa-progress-bar className="bar" value={state.v} label="Upload" /><button className="up">up</button></div> }
    Late.initialState = { v: 40 }
    Late.intent = ({ DOM }) => ({ UP: DOM.select('.up').events('click') })
    Late.model = { UP: (s) => ({ ...s, v: s.v + 10 }) }
    const { el, app } = await start(Late)
    const bar = el.querySelector('.bar')
    assert(!customElements.get('wa-progress-bar'), 'not defined yet')
    assert(bar.value === 40, 'own property before upgrade')
    await import('@awesome.me/webawesome/dist/components/progress-bar/progress-bar.js')
    await customElements.whenDefined('wa-progress-bar')
    await settled(bar)
    assert(bar.value === 40 && !Object.prototype.hasOwnProperty.call(bar, 'value'), 'Lit took over the pre-upgrade property')
    assert(bar.shadowRoot?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') === '40', 'upgraded and rendered 40')
    el.querySelector('.up').click()
    await waitFor(() => bar.value === 50)
    app.dispose()
  })

  await test('SSR: renderToString writes props as attributes; the client run() re-renders and stays interactive', async () => {
    const html = renderToString(Review, { state: { food: 4, hover: 0, locked: true } })
    assert(/<wa-rating[^>]*class="food"/.test(html), `class: ${html}`)
    assert(/<wa-rating[^>]*value="4"/.test(html), 'value as attribute')
    assert(/<wa-rating[^>]*label="Food"/.test(html), 'label as attribute')
    assert(/<wa-rating[^>]*readonly[ >]/.test(html), 'boolean true → bare attribute')
    assert(!/<template shadowroot/.test(html), 'no declarative shadow DOM from Sygnal')
    const camel = renderToString(Prefs, {})
    // D199: a camelCase property of a custom element is written as its kebab-case attribute (Lit reads with-clear)
    assert(/<wa-input[^>]*class="email"[^>]*with-clear[ >]/.test(camel) && !/withClear/.test(camel), `withClear → with-clear: ${camel}`)
    const { el: ssrEl } = mount()
    ssrEl.innerHTML = camel
    const upgraded = ssrEl.querySelector('.email')
    await settled(upgraded)
    assert(upgraded.withClear === true, 'the server markup upgrades with withClear set')
    const { id, el } = mount()
    el.innerHTML = html
    const serverEl = el.querySelector('wa-rating')
    await settled(serverEl)
    assert(serverEl.value === 4 && serverEl.readonly === true, 'Web Awesome upgrades the server markup from attributes')
    const Hydrated = (p) => Review(p)
    Object.assign(Hydrated, { initialState: { food: 4, hover: 0, locked: false }, intent: Review.intent, model: Review.model })
    const app = run(Hydrated, {}, { mountPoint: id })
    await waitFor(() => !el.querySelector('[data-sygnal-ssr]') && el.querySelector('.out'))
    const clientEl = el.querySelector('wa-rating')
    await settled(clientEl)
    // the client render replaces the server element (no reuse today; toVNode sel "wa-rating.food" vs "wa-rating")
    window.__p5w3Reused = clientEl === serverEl
    assert(clientEl.value === 4 && clientEl.readonly === false, 'client state wins')
    await clickStar(`${id} .food`, 2)
    await waitFor(() => text(el, '.out').startsWith('2|'))
    app.dispose()
  })

  await test('controlled: a model that ABORTs a wa-rating value keeps the state', async () => {
    const { id, el, app } = await start(Capped)
    const r = el.querySelector('.capped')
    await settled(r)
    await clickStar(`${id} .capped`, 5)
    await wait(80)
    assert(text(el, '.out') === '2', 'state refused 5')
    // the element's own value after the ABORT is recorded, not asserted: re-syncing form-associated
    // custom elements on a rejected change is D196 (PLAN-5 1-F, controlledInputModule)
    window.__p5w3Drift = r.value
    app.dispose()
  })

  await test('publish + consume: a defineElement Sygnal component wrapping wa-rating, used by a Sygnal app (light and shadow root)', async () => {
    const { id, el, app } = await start(Host)
    const a = el.querySelector('.card-a')
    const b = el.querySelector('.card-b')
    await waitFor(() => a.querySelector('wa-rating') && b.shadowRoot?.querySelector('wa-rating'))
    const ra = a.querySelector('wa-rating')
    const rb = b.shadowRoot.querySelector('wa-rating')
    await settled(ra); await settled(rb)
    assert(ra.value === 1 && rb.value === 2, `props flowed in: ${ra.value} ${rb.value}`)
    assert(a.querySelector('.title').textContent === 'Pasta', 'title prop')
    await clickStar(`${id} .card-a wa-rating`, 4)
    await waitFor(() => text(el, '.out') === '4|2')
    await clickStar(`${id} .card-b wa-rating`, 5, rb) // Playwright's CSS pierces the element's open shadow root
    await waitFor(() => text(el, '.out') === '4|5')
    await settled(ra)
    assert(ra.value === 4 && a.score === 4, 'host state → element prop → inner rating')
    app.dispose()
  })

  await test('publish standalone: the element works in plain HTML next to a bare wa-rating', async () => {
    const { el } = mount()
    el.innerHTML = '<p5w3-score-card title="Tea" score="3"></p5w3-score-card><wa-rating class="bare" value="1"></wa-rating>'
    const card = el.firstElementChild
    const seen = []
    card.addEventListener('score-change', (e) => seen.push(e.detail.score))
    await waitFor(() => card.querySelector('wa-rating'))
    const inner = card.querySelector('wa-rating')
    await settled(inner)
    assert(inner.value === 3, `attribute → state → inner rating: ${inner.value}`)
    const bare = el.querySelector('.bare')
    await settled(bare)
    assert(bare.value === 1, 'bare rating unaffected')
    if (hasPw()) await clickStar(`#${el.id} p5w3-score-card wa-rating`, 2)
    else { inner.value = 2; inner.dispatchEvent(new Event('change', { bubbles: true, composed: true })) }
    await waitFor(() => seen.join() === '2')
    assert(bare.value === 1, 'bare rating still unaffected')
    card.remove()
  })
}
