Make this quote viewer load the selected quote from the server. Picking a quote in the list already works; the detail panel stays empty.

- Whenever a quote is picked, load it with `GET /api/quotes/<id>`, which answers JSON like `{ "id": 101, "text": "Simplicity is prerequisite for reliability.", "author": "Edsger W. Dijkstra" }`. Show the text in `.quote-text` and the author in `.quote-author`, inside `.detail`.
- While the request for the selected quote is in flight, `.status` shows "Loading…" and no quote text or author is shown, not even the previously shown quote's.
- If the request fails (a non-2xx status or a network error), `.status` shows "Could not load the quote." and no quote text or author is shown. When a quote is shown, `.status` is empty.
- "Refresh" loads the selected quote again, the same way: "Loading…", then the quote or the error.
- Only the most recent request counts. Responses can arrive in any order: the response or failure of an earlier request must never be shown, even when it is for the same quote as the latest request (after Refresh, or after picking another quote and coming back).
