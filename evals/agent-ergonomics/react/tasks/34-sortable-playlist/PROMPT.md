Let the user reorder this playlist by dragging, with the mouse and with the keyboard. The list and the Favorite checkboxes already work.

- Each song (`li` in `ul.playlist`) gets a drag handle: a `<button>` whose accessible name is "Reorder " followed by the title ("Reorder Yesterday"). Every handle's `aria-describedby` points at instructions that say how to use the keyboard (mentioning Space), at least while the handle has focus.
- Keyboard: Space or Enter on a handle picks its song up. ArrowUp and ArrowDown then move it one place up or down (it stays put at either end of the list). Space or Enter drops it at its new place. Escape cancels: the song goes back to where it was picked up. Keyboard focus stays on the moved song's handle, also after it is dropped or put back.
- Announce the moves in a live region (an element with `aria-live`): when a song is dropped, "Dropped Yesterday at position 3 of 5."; when a move is cancelled, "Cancelled. Yesterday is back at position 1 of 5." (with the song's title and position, and the number of songs). Announce picking up and each step too, in your own words.
- A song keeps its Favorite checkbox state when it moves, and the order stays after a drop (the tests check the list order and the checkboxes).
- Mouse dragging should also work, but jsdom, which the tests run in, can't test it.

jsdom has no layout: the acceptance tests give each song's `li` a 300 × 40 px box at its place in the list (everything inside a song shares its box; the list's box holds them all), add a no-op `scrollIntoView` and a `ResizeObserver` that never reports. They press keys on the focused handle with both `key` and `code` set, like a browser (`key: ' '`, `code: 'Space'`).
