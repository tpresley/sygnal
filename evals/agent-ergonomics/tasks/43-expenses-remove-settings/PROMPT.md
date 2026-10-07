This is our team-expenses app (dashboard, expense list and detail, new-expense form, settings). Nobody uses the Settings page, so we're dropping it. Remove the settings feature:

- The "Settings" link in the main navigation and the `/settings` page go away; `/settings` now shows "Page not found" like any other unknown address.
- No more currency choice: every amount is shown in dollars (`$12.50`), as it is by default today.
- No more default category: the new-expense form's category always starts at its placeholder "Choose…" (an empty value).
- Nothing is saved or restored any more: the app no longer reads or writes `localStorage` (an entry an earlier version saved is simply ignored).

Remove it completely: its controls, its data, its logic and its tests, leaving no code behind that only served it. Everything else (dashboard, list, filters, expense pages, approving, rejecting, deleting, the new-expense form and the messages) must keep working, and `npm test` must pass.
