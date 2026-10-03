Add autosave and a local draft to this note editor.

- Save the note to the server with `PUT /api/draft`, sending the fields' current values as JSON, `{ "title": "…", "body": "…" }`, with `Content-Type: application/json`. Save 1 second after the user stops editing: every edit of either field restarts the 1-second wait, so a burst of typing is one save. Opening the app saves nothing.
- `.save-status` is empty until the first edit. Then it shows "Unsaved changes" from an edit until its save is sent, "Saving…" while the save is in flight, "Saved" once it succeeded (any 2xx status), and "Save failed." if it failed (any other status, or a network error). A failed save is not retried; the next edit saves again.
- Only the newest save counts. When the user edits while a save is in flight, the status shows "Unsaved changes", and the reply to the older save, whenever it arrives and whatever it is, must not change the status. Cancelling the older request is fine.
- Also keep the draft in this browser: within 300 ms of every edit, write `{ "title": "…", "body": "…" }` as JSON to `localStorage` under the key `"note-draft"`. When the app opens and `"note-draft"` holds a draft, the fields start with it; when it is missing or not valid JSON, they start empty. Restoring a draft doesn't save it to the server and leaves `.save-status` empty.
- The word count keeps working.
