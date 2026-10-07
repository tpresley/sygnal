We no longer want the "All" / "Low stock" tabs in this pantry list. Please remove that feature: the list always shows every item, in the chosen sort order.

Remove it completely: the two tab buttons, the data and logic behind them, and their tests, leaving no code behind that only served the tabs.

Everything else must keep working as it does now: low items are still highlighted (`low`) and counted in the summary line ("6 items · 2 low"), the sort select, adding items (including the "Already in the pantry." message), the + / − buttons and Remove all work as before, and "Nothing here." still shows when the pantry is empty. `npm test` must pass.
