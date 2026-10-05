---
title: Carousel (Embla)
description: An Embla carousel as a Sygnal widget tag, with previous, next and dot buttons as element commands and the current slide in state
---

[Embla Carousel](https://www.embla-carousel.com/) handles the hard parts of a carousel: dragging and swiping, snapping, momentum. It renders no buttons and no styles of its own. [`defineWidget`](/guide/widgets/) turns it into a JSX tag; the buttons are ordinary Sygnal markup that send the carousel [element commands](/guide/element-commands/), and the slide Embla settles on comes back as state.

## Install

```sh
npm install embla-carousel
```

## The widget

```js
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
```

Embla expects a viewport element with one child, the track, whose children are the slides. The host `<div>` is the viewport, and the widget builds the track itself, because Sygnal never renders inside a widget's host. `update` rebuilds it when the photos change and `reInit()` makes Embla measure the new slides; the instance stays the same.

## Using it

```jsx
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
```

```css
.photos { overflow: hidden; }
.photos .slides { display: flex; }
.photos .slide { flex: 0 0 100%; min-width: 0; }
```

The buttons don't change `index` themselves. They ask Embla to scroll, and `index` follows from the `slide` event, the same way it does after a swipe: Embla decides where the carousel stops, and the state always says where it is. The widget also reports the slide after `reInit()`: when the photos shrink below the current one, Embla moves to the last slide without a `select` event.

At the ends, Previous and Next are marked `aria-disabled` rather than `disabled`: a `disabled` button loses focus as it is pressed (keyboard users land on the page body), while an `aria-disabled` one keeps it, is announced as unavailable, and a press does nothing (Embla doesn't scroll past the ends). Style it with `[aria-disabled="true"]`.

## Testing

```jsx
// Gallery.test.jsx
import { test, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { Gallery } from './Gallery.jsx'

test('the buttons send commands, and the shown slide comes back as state', async () => {
  const t = renderComponent(Gallery)
  await t.ready()
  t.simulateEvent('.next', 'click')
  t.simulateEvent('.dot[data-index="2"]', 'click')
  await t.settle()
  expect(t.commands()).toEqual([{ next: '.photos' }, { goTo: '.photos', index: 2 }])

  t.widget('.photos').dispatch('slide', 2)
  await t.next((state) => state.index === 2)
  expect(t.query('.where').textContent).toBe('Photo 3 of 3')
  expect(t.query('.next').getAttribute('aria-disabled')).toBe('true')
  expect(t.query('.prev').getAttribute('aria-disabled')).toBe('false')
  t.dispose()
})
```

Dragging needs layout, so test it in a real browser: with `renderComponent(Gallery, { dom: 'real' })` under Playwright, drag across `.photos` and `t.waitForState((state) => state.index === 1)`; `t.widget('.photos').instance` is the Embla API (`selectedScrollSnap()`, `slideNodes()`).

## Size

Measured with Vite, minified and gzipped, Sygnal not included: **9 KB** for Embla and this recipe. `defineWidget` adds 1.1 KB for the first widget in an app.

## Pitfalls

- **Build the slides in the widget.** Children passed to a widget tag are ignored, and markup rendered next to the host isn't inside the viewport. Pass the slides' data as a prop and build them in `mount`/`update`, as `fill` does.
- **`reInit()` after the slides change.** Embla measures the slides when it starts; without `reInit()` it keeps scrolling over the old ones. `reInit()` emits `reInit`, not `select`, so listen to both to keep `index` right.
- **Initial state belongs to the page.** `Gallery` keeps its photos in `initialState`, which is fine for the root component or a page. A child component rendered by a parent can't have an `initialState` ([SYG405](/reference/errors/#syg405)): there, drop it, and pass `photos` and `index` down in the parent's state.
- **Name commands after what they do.** A command called `scrollTo` would replace the host `<div>`'s own `scrollTo()` method for element commands; `goTo` avoids the confusion.
- **Accessibility.** Give the carousel a name and each slide its position (`role="group"`, `aria-roledescription="slide"`, `aria-label="2 of 3"`), give the icon buttons labels, and announce the current slide (`aria-live="polite"`). Don't auto-play; if you add it, add a pause button and stop on focus or hover.
