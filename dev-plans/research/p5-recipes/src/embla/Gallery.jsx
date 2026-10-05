// Gallery.jsx
import { Carousel } from './Carousel.js'

export function Gallery({ state }) {
  const last = state.photos.length - 1
  return (
    <section aria-roledescription="carousel" aria-label="Photos">
      <Carousel className="photos" photos={state.photos} />
      <button className="prev" aria-label="Previous photo" aria-disabled={state.index === 0}>‹</button>
      <button className="next" aria-label="Next photo" aria-disabled={state.index === last}>›</button>
      {state.photos.map((photo, i) => (
        <button className="dot" data={{ index: i }} aria-label={`Show photo ${i + 1}`}
          aria-current={i === state.index ? 'true' : undefined} />
      ))}
      <p className="where" aria-live="polite">Photo {state.index + 1} of {state.photos.length}</p>
    </section>
  )
}

Gallery.initialState = {
  photos: [
    { src: '/photos/harbour.jpg', alt: 'Boats in the harbour at dawn' },
    { src: '/photos/market.jpg', alt: 'The fish market' },
    { src: '/photos/cliffs.jpg', alt: 'Cliffs north of the town' },
  ],
  index: 0,
}

Gallery.intent = ({ DOM }) => ({
  SLIDE: DOM.select('.photos').events('slide').detail(),
  PREV: DOM.click('.prev'),
  NEXT: DOM.click('.next'),
  GO_TO: DOM.click('.dot').data('index', Number),
})

Gallery.model = {
  SLIDE: (state, index) => ({ ...state, index }),
  PREV: { ELEMENT: { prev: '.photos' } },
  NEXT: { ELEMENT: { next: '.photos' } },
  GO_TO: { ELEMENT: (state, index) => ({ goTo: '.photos', index }) },
}
