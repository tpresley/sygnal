// A plain React component (no JSX here: this project's JSX is Sygnal's), with its own hook state.
import { createElement as h, useState } from 'react'

export function ReactRating({ value, max = 5, onChange, 'aria-label': label }) {
  const [hover, setHover] = useState(0)
  const shown = hover || value
  return h('div', { role: 'radiogroup', 'aria-label': label, className: 'react-rating', onMouseLeave: () => setHover(0) },
    Array.from({ length: max }, (_, i) => h('button', {
      key: i,
      type: 'button',
      role: 'radio',
      'aria-checked': String(i + 1 === value),
      'aria-label': `${i + 1} of ${max}`,
      onMouseEnter: () => setHover(i + 1),
      onClick: () => onChange?.(i + 1),
      style: { fontSize: '1.4rem', border: 0, background: 'none', cursor: 'pointer', color: i < shown ? '#e0457b' : '#b8bcc6' },
    }, '♥')),
    h('small', { style: { marginLeft: 8 } }, `React says: ${hover ? `hovering ${hover}` : `${value} of ${max}`}`))
}
