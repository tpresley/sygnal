/*
 * PLAN-4 GS-1: the first-party `pager` behavior.
 *
 *   const { Older, Newer } = controls({ Older: 'button', Newer: 'button' })
 *   List.uses = { pager: pager({ pageSize: 10, next: Newer, prev: Older }) }
 *
 * Slice: { page, pageSize, total } plus the calculated offset, pages, hasPrev, hasNext.
 * Actions: pager.NEXT, pager.PREV (ABORT at the bounds), pager.GOTO (page number, clamped),
 * pager.SET_TOTAL (item count; keeps the page in range). `total` is optional: without it NEXT
 * has no upper bound and `pages` is null. A host reducer may also write `state.pager.total`;
 * the calculated fields follow.
 */
import { defineBehavior } from './behaviors'

const ABORT = Symbol.for('sygnal.ABORT')
const pagesOf = (p: any) => p.total == null ? null : Math.max(1, Math.ceil(p.total / p.pageSize))
const to = (p: any, page: number) => {
  const n = pagesOf(p)
  page = Math.max(0, Math.min(page | 0, n == null ? page : n - 1))
  return page === p.page ? ABORT : {...p, page}
}

/**
 * A page cursor over a list (GS-1 behavior). Options: `pageSize` (20), `page` (0), `total`
 * (null: unknown), and the controls `next` / `prev` whose clicks move the page. Use it as
 * `uses = { pager: pager({ pageSize: 10, next: Newer, prev: Older }) }`, then render
 * `items.slice(state.pager.offset, state.pager.offset + state.pager.pageSize)`.
 */
export const pager = /*#__PURE__*/ defineBehavior({
  initialState: {page: 0, pageSize: 20, total: null},
  intent: ({DOM}: any, {next, prev}: any) => ({
    ...(next && {NEXT: DOM.click(next)}),
    ...(prev && {PREV: DOM.click(prev)}),
  }),
  model: {
    NEXT: (p: any) => to(p, p.page + 1),
    PREV: (p: any) => to(p, p.page - 1),
    GOTO: (p: any, page: number) => to(p, page),
    SET_TOTAL: (p: any, total: number) => {
      const q = {...p, total}, r = to(q, p.page)
      return r === ABORT ? q : r
    },
  },
  calculated: {
    offset: (p: any) => p.page * p.pageSize,
    pages: pagesOf,
    hasPrev: (p: any) => p.page > 0,
    hasNext: (p: any) => p.total == null || p.page + 1 < pagesOf(p)!,
  },
})
