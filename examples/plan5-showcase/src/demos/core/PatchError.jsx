import { run } from 'sygnal'
import './patch-error.css'

// a vnode hook of your own that throws while the DOM is patched
const explode = () => { throw new Error('a hook threw during the patch') }

export function Counter({ state }) {
  return (
    <div>
      <div className="row">
        <button className="inc">Count: {state.n}</button>
        <button className="arm">Break the next patch</button>
      </div>
      <i hook={state.armed ? { update: explode } : {}}>render #{state.n}</i>
    </div>
  )
}

Counter.initialState = { n: 0, armed: false }
Counter.intent = ({ DOM }) => ({ INC: DOM.click('.inc'), ARM: DOM.click('.arm') })
Counter.model = {
  INC: (state) => ({ ...state, n: state.n + 1 }),
  ARM: (state) => ({ ...state, armed: true, n: state.n + 1 }),
}

// After a patch error the app's DOM stops updating (state and events go on), the mount point
// gets data-sygnal-error="patch" (a CSS overlay keys off it), and onError gets phase 'patch'.
export function start(mountPoint, uid) {
  const mount = document.querySelector(mountPoint)
  mount.parentElement.querySelector('.reload-banner')?.remove()
  return run(Counter, {}, {
    mountPoint,
    uid,
    onError: (error, { phase }) => {
      if (phase !== 'patch') return
      const banner = document.createElement('p')
      banner.setAttribute('role', 'alert')
      banner.className = 'reload-banner'
      banner.textContent = `onError({ phase: 'patch' }): ${error.message}. Use Restart to start over.`
      mount.after(banner)
    },
  })
}
