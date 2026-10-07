import { defineWidget } from 'sygnal'

// A dependency-free widget that draws on its own timer, after mount returned.
// - ownProps: 'aria-label' stays off the host <div>; the widget puts it on its own role="timer"
// - error(e): a failure in its own timer is reported like an update that throws (SYG661),
//   and the owner's onError fallback takes the widget's place
export const Ticker = defineWidget({
  name: 'Ticker',
  ownProps: ['aria-label'],
  mount: (el, props, dispatch, error) => {
    const ticker = { n: 0, props, out: document.createElement('span') }
    ticker.out.setAttribute('role', 'timer')
    ticker.out.setAttribute('aria-label', props['aria-label'])
    ticker.out.className = 'ticker-face'
    ticker.out.textContent = '0'
    el.append(ticker.out)
    ticker.timer = setInterval(() => {
      try {
        if (ticker.props.broken) throw new Error('the ticker could not draw')
        ticker.n += ticker.props.step
        ticker.out.textContent = String(ticker.n)
        dispatch('tick', ticker.n)
      } catch (e) {
        error(e)
      }
    }, 500)
    return ticker
  },
  update: (ticker, props) => {
    ticker.props = props
    ticker.out.setAttribute('aria-label', props['aria-label'])
  },
  unmount: (ticker) => clearInterval(ticker.timer),
  events: ['tick'],
  commands: {
    reset: (ticker) => {
      ticker.n = 0
      ticker.out.textContent = '0'
    },
  },
})
