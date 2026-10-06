This customer list renders all 10,000 rows and is slow. Make it render only the rows in view, and add a way to jump to a row.

- The list stays a scrollable `.customers` element (480 px tall, `overflow-y: auto`, styled in `index.html`) with `role="list"` and the accessible name "Customers". Each customer is a `.row` element (always 40 px tall) with `role="listitem"`, in id order, showing "#123 Customer 123 Lisbon" as now, with its Star button.
- Only the rows in or near the view are in the page: never more than 60 `.row` elements, whatever the scroll position. Scrolling the list shows the rows at that position.
- So that screen readers can still say "item 4,201 of 10,000", each row has `aria-posinset` (its number, 1 to 10,000) and `aria-setsize="10000"`.
- Star buttons keep working (`aria-pressed` and the "N starred" count in `.summary`), also for rows that were scrolled out of view and back.
- A "Go to row" number field and a "Go" button (in `form.jump`; Enter in the field works too) scroll the list so that row N is in view, and mark that row with `aria-current="true"` (only that row, until the next jump). The page doesn't reload.
- A value that isn't a whole number from 1 to 10,000 doesn't scroll; `.jump-error` shows "Enter a row from 1 to 10,000." until the next valid jump.

jsdom, which the tests run in, has no layout. The acceptance tests give `.customers` a height of 480 px and a `scrollHeight` of 10,000 rows × 40 px, and `.row` elements a height of 40 px (`getBoundingClientRect`, `clientHeight`, `offsetHeight`); they make `scrollTop` (clamped as in a browser), `scrollTo()` and `scrollBy()` work on elements (each fires a `scroll` event), and add a `ResizeObserver` that never reports. They scroll the list by setting its `scrollTop` and firing `scroll`, like a user would.
