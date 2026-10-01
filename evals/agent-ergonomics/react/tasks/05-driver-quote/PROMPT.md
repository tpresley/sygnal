Make the "Get a quote" button work. When it is clicked, fetch a quote with `GET /api/quote`. The server responds with JSON like:

```json
{ "text": "Simplicity is prerequisite for reliability.", "author": "Edsger Dijkstra" }
```

Show the quote in the box as `<text> — <author>` (for example "Simplicity is prerequisite for reliability. — Edsger Dijkstra").

While the request is in flight, the box should say "Loading…". If the request fails (a network error or a non-2xx response), the box should say "Could not load a quote." Clicking the button again should retry.
