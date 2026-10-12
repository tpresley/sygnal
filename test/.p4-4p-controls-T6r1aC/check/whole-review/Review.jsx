// Review.jsx
import { controls } from 'sygnal'
import { stars } from './stars.js'

const { Rating, More } = controls({ Rating: stars, More: 'button' })

export function Review({ state }) {
  return (
    <div>
      <Rating value={state.rating} />
      <More disabled={state.rating === 5}>Add a star</More>
    </div>
  )
}

Review.initialState = { rating: 3 }
Review.intent = ({ DOM }) => ({ MORE: DOM.click(More) })
Review.model = {
  MORE: {
    STATE: (state) => ({ ...state, rating: Math.min(state.rating + 1, 5) }),
    ELEMENT: { flash: Rating, ms: 300 },
  },
}
