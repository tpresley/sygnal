import { run, renderToString, Collection } from 'sygnal'

function Topic({ state }) {
  return <li className="topic">{state.label}</li>
}

export function Signup({ state, uid }) {
  return (
    <div className="ssr-form">
      <label for={uid('nick')}>Nickname</label> <input id={uid('nick')} className="nick" />
      <label><input type="checkbox" className="news" /> Newsletter</label>
      <ul className="topics"><Collection of={Topic} from="topics" /></ul>
      <div className="row">
        <button type="button" className="count">Clicked {state.clicks} times</button>
        <span className="muted">{state.nick ? `Typed since start: "${state.nick}"` : 'The model sees typing once the app runs'}</span>
      </div>
    </div>
  )
}

Signup.initialState = { clicks: 0, nick: '', topics: [{ id: 1, label: 'Releases' }, { id: 2, label: 'Events' }] }
Signup.intent = ({ DOM }) => ({ CLICK: DOM.click('.count'), NICK: DOM.input('.nick').value() })
Signup.model = {
  CLICK: (state) => ({ ...state, clicks: state.clicks + 1 }),
  NICK: (state, nick) => ({ ...state, nick }),
}

// The "server" part, run in the page for the demo: renderToString's HTML goes into the mount
// point first. Type into it, then start the app: the first client render adopts those elements.
export function start(mountPoint, uid) {
  const card = document.querySelector(mountPoint)
  card.innerHTML = `<div class="row"><button type="button" class="hydrate-now">Start the app (hydrate)</button>
    <span class="muted hydrate-status">Server HTML only: type a nickname and tick the box first.</span></div>
    <div id="${uid}-app" class="ssr-root"></div>`
  const root = card.querySelector('.ssr-root')
  root.innerHTML = renderToString(Signup, { uid })
  let app = null
  card.querySelector('.hydrate-now').addEventListener('click', (e) => {
    e.target.disabled = true
    const before = [...root.querySelectorAll('*')]
    const typed = root.querySelector('.nick').value
    app = run(Signup, {}, { mountPoint: `#${uid}-app`, uid })
    setTimeout(() => {
      const kept = before.filter((el) => el.isConnected).length
      card.querySelector('.hydrate-status').textContent =
        `Hydrated: ${kept} of ${before.length} server elements adopted; the nickname still reads "${root.querySelector('.nick').value}" (typed: "${typed}").`
    }, 100)
  })
  return { dispose: () => app?.dispose() }
}
