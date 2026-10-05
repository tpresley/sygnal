import { renderComponent } from 'sygnal'
import { Gallery } from './Gallery.jsx'
import { Carousel } from './Carousel.js'
import { assert, equal, waitFor, pw, centre } from '../browser-util.js'

const pixel = (colour) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="${colour}"/></svg>`)}`
const photos = [
  { src: pixel('red'), alt: 'Red' },
  { src: pixel('green'), alt: 'Green' },
  { src: pixel('blue'), alt: 'Blue' },
]

// the widget with photos that change, to exercise update()
function Album({ state }) {
  return (
    <main>
      <Carousel className="album" photos={state.photos} />
      <button className="add-photo">Add</button>
    </main>
  )
}
Album.initialState = { photos }
Album.intent = ({ DOM }) => ({ ADD: DOM.click('.add-photo') })
Album.model = { ADD: (state) => ({ ...state, photos: [...state.photos, { src: pixel('black'), alt: 'Black' }] }) }

// the photos shrink under the selected slide (G-442: reInit moves the selection, no select event)
function Shrinking({ state }) {
  return (
    <main>
      <Carousel className="photos shrinking" photos={state.photos} />
      <button className="drop">Drop</button>
      <p className="at">{state.index}</p>
    </main>
  )
}
Shrinking.initialState = { photos, index: 0 }
Shrinking.intent = ({ DOM }) => ({
  SLIDE: DOM.select('.shrinking').events('slide').detail(),
  DROP: DOM.click('.drop'),
})
Shrinking.model = {
  SLIDE: (state, index) => ({ ...state, index }),
  DROP: (state) => ({ ...state, photos: state.photos.slice(0, 1) }),
}

export const tests = {
  async 'Embla: next/dot commands scroll, a real drag comes back as state, unmount destroys'() {
    const t = renderComponent(Gallery, { dom: 'real', initialState: { photos, index: 0 } })
    await t.ready()
    await waitFor(() => t.query('.photos .slides .slide'), 'carousel mounted')
    const embla = t.widget('.photos').instance
    let destroyed = false
    embla.on('destroy', () => { destroyed = true })
    equal(embla.slideNodes().length, 3, 'three slides')
    equal(t.query('.photos .slide').getAttribute('aria-label'), '1 of 3')

    await pw('click', '.next')
    await t.waitForState((state) => state.index === 1)
    equal(embla.selectedScrollSnap(), 1, 'Embla moved')
    equal(t.query('.where').textContent, 'Photo 2 of 3')

    await pw('click', '.dot[data-index="2"]')
    await t.waitForState((state) => state.index === 2)
    equal(t.query('.next').getAttribute('aria-disabled'), 'true', 'next is aria-disabled on the last photo')

    // a real drag to the right goes back one slide (Embla's own pointer handling)
    const [x, y] = centre(t.query('.photos'))
    await pw('drag', null, [x - 100, y, x + 150, y])
    await t.waitForState((state) => state.index === 1)

    t.dispose()
    assert(destroyed, 'destroyed on unmount')
  },

  async 'Embla: new photos from state re-init the same instance'() {
    const t = renderComponent(Album, { dom: 'real' })
    await t.ready()
    await waitFor(() => t.widget('.album').instance, 'carousel mounted')
    const embla = t.widget('.album').instance
    await pw('click', '.add-photo')
    await waitFor(() => embla.slideNodes().length === 4, 'four slides after update')
    assert(t.widget('.album').instance === embla, 'same instance')
    equal(t.query('.album .slide').getAttribute('aria-label'), '1 of 4')
    t.dispose()
  },

  async 'Embla: when the photos shrink below the shown one, the index follows (reInit)'() {
    const t = renderComponent(Shrinking, { dom: 'real' })
    await t.ready()
    await waitFor(() => t.widget('.shrinking').instance, 'carousel mounted')
    const embla = t.widget('.shrinking').instance
    embla.scrollTo(2, true)
    await t.waitForState((state) => state.index === 2)
    await pw('click', '.drop')
    await waitFor(() => embla.slideNodes().length === 1, 'one slide after update')
    // (waitForState would match the history: index 0 at the start)
    await waitFor(() => t.state.index === 0, 'index follows the shrink')
    equal(embla.selectedScrollSnap(), 0)
    t.dispose()
  },

  async 'Embla: Prev / Next at the ends are aria-disabled and keep focus'() {
    const t = renderComponent(Gallery, { dom: 'real', initialState: { photos, index: 0 } })
    await t.ready()
    await waitFor(() => t.widget('.photos').instance, 'carousel mounted')
    equal(t.query('.prev').getAttribute('aria-disabled'), 'true')
    await pw('press', '.next', 'Enter')
    await t.waitForState((state) => state.index === 1)
    await pw('press', '.next', 'Enter')
    await t.waitForState((state) => state.index === 2)
    equal(t.query('.next').getAttribute('aria-disabled'), 'true')
    assert(document.activeElement === t.query('.next'), 'focus stays on Next at the end')
    t.dispose()
  },
}
