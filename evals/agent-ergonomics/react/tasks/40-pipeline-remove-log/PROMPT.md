This is a hiring pipeline board: candidates move from Applied through Interview and Offer to Hired (or get rejected), with stage tabs, a summary line, an add form and an activity log. We no longer want the activity log.

Remove it completely: the "Activity" panel with its entries, its "No activity yet." message and its "Clear" button, the data it keeps, the entries that advancing, rejecting, adding and removing candidates record, and its tests, leaving no code behind that only served it (delete its component file).

Everything else must keep working exactly as it does today: advancing, rejecting and removing candidates, the stage tabs with their counts and the empty-stage message, the summary line, and the add form with its "Enter a name." check. `npm test` must pass.
