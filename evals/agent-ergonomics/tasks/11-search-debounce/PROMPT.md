Make the search box find books as the user types.

- Search with `GET /api/search?q=<query>` (URL-encode the query). The server responds with JSON like:

  ```json
  { "results": [{ "id": 7, "title": "Dune" }, { "id": 8, "title": "Dune Messiah" }] }
  ```

- Don't send a request on every keystroke: wait until the user has stopped typing for 300 ms. Typing "dune" quickly sends a single request, for "dune".
- While a request is in flight, show "Searching…". When it completes, list the result titles in `ul.results`, one `li` per result, or show "No results" if the list is empty. If the request fails (a network error or a non-2xx response), show "Search failed."
- Only the response to the most recent request may be shown. If an older request finishes after a newer one was sent, ignore it, whether it succeeded or failed.
- Clearing the box (making it empty) immediately removes the results and any message, and sends no request. A request that was still in flight when the box was cleared is ignored when it completes.
