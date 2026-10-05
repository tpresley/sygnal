// Carousel.js
import { defineWidget } from 'sygnal'
import EmblaCarousel from 'embla-carousel'

// Embla moves a track inside the viewport (the host): the widget builds the track from the props
function fill(el, photos) {
  const track = document.createElement('div')
  track.className = 'slides'
  photos.forEach((photo, i) => {
    const slide = document.createElement('div')
    slide.className = 'slide'
    slide.setAttribute('role', 'group')
    slide.setAttribute('aria-roledescription', 'slide')
    slide.setAttribute('aria-label', `${i + 1} of ${photos.length}`)
    slide.append(Object.assign(document.createElement('img'), { src: photo.src, alt: photo.alt }))
    track.append(slide)
  })
  el.replaceChildren(track)
}

export const Carousel = defineWidget({
  name: 'Carousel',
  mount: (el, props, dispatch) => {
    fill(el, props.photos)
    const embla = EmblaCarousel(el, { loop: false })
    // reInit (new photos) can move the selection without a select event: report both
    const report = () => dispatch('slide', embla.selectedScrollSnap())
    embla.on('select', report).on('reInit', report)
    return embla
  },
  update: (embla, props, el) => {
    fill(el, props.photos)
    embla.reInit()
  },
  unmount: (embla) => embla.destroy(),
  events: ['slide'],
  commands: {
    prev: (embla) => embla.scrollPrev(),
    next: (embla) => embla.scrollNext(),
    goTo: (embla, { index }) => embla.scrollTo(index),
  },
})
