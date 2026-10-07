This is our team-expenses app (dashboard, expense list and detail, new-expense form, settings). We want new expenses to be saved as drafts first and submitted for approval later. Change it like this:

- **New expense**: the form's button reads "Save draft" (still "Saving…" while it saves) instead of "Add expense". It sends `POST /api/expenses` with `"status": "draft"` (the other fields as today). When it's saved, the app opens the new expense's page, `/expenses/<id>` with the id the server gave it, and the message reads "Draft saved".
- An expense's status can now be `draft`, shown as "Draft" wherever statuses are shown (the badge in the list and on the expense's page). The list's status filter gets the option "Draft" (value `draft`).
- **A draft's page** has a "Submit for approval" button: it sends `PUT /api/expenses/<id>` with `{ "status": "pending" }`, then the page shows the expense as Pending and the message reads "Submitted for approval".
- **Delete** is only offered on drafts and rejected expenses. Pending and approved expenses can't be deleted any more. Approve and Reject stay as they are (pending expenses only). So a draft's page offers "Submit for approval" and "Delete"; a pending one "Approve" and "Reject"; a rejected one "Delete"; an approved one no button.
- **Dashboard**: drafts aren't pending, so "Pending approval: N" doesn't count them. Add a line "Drafts: N" (the number of drafts). The category table counts only pending and approved expenses: drafts don't count there (rejected ones still don't).

Update the project's tests where this changes the behavior they check; `npm test` must pass.
