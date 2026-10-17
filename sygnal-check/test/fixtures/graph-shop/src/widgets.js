// PLAN-10 A-2: a widget defined in the app (its definition is visible)
import { defineWidget } from 'sygnal'

export const Stars = defineWidget({ tag: 'span', mount(el) { el.textContent = '★★★' } })
