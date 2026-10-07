Add a search box to this pantry list.

- Above the list, add a text field labelled "Search" (`input[name="search"]`). As the user types, the list shows only the items whose name contains the typed text, ignoring upper/lower case and any spaces before or after the text. An empty search shows everything.
- The search works together with the "All" / "Low stock" tabs and with the sort order: for example, on "Low stock" with the search "o", only the low items whose name contains "o" are listed, in the chosen order.
- The two tab buttons show how many items each would list for the current search: "All (6)" and "Low stock (2)" when the search is empty, "All (3)" and "Low stock (1)" for "o". The counts stay up to date as the user searches, changes quantities, adds and removes items.
- When the search is not empty and nothing in the current tab matches it, show "No items match “<search>”." (with the search text, trimmed, in curly quotes) where the list would be, instead of "Nothing here.".
- While the search field has text in it, show a "Clear search" button (`button.clear-search`) next to it. Clicking it empties the field and shows the unfiltered list again. There is no "Clear search" button while the field is empty.
- The summary line ("6 items · 2 low") keeps counting the whole pantry, not just the items shown.

Everything that works today must keep working, and the project's tests (`npm test`) must still pass.
