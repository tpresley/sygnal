// Pages.jsx
import { controls, pager } from 'sygnal'

const { Older, Newer } = controls({ Older: 'button', Newer: 'button' })

export function Pages({ state }) {
  const { page, pages, hasPrev, hasNext } = state.pager
  return (
    <nav>
      <Older disabled={!hasPrev}>Older</Older>
      <span className="page">Page {page + 1} of {pages}</span>
      <Newer disabled={!hasNext}>Newer</Newer>
    </nav>
  )
}

Pages.initialState = {}
Pages.uses = { pager: pager({ pageSize: 10, total: 35, next: Newer, prev: Older }) }
