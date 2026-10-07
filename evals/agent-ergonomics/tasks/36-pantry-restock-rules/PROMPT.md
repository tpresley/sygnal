Please change three rules in this pantry list.

1. An item now counts as low when its quantity is **at or below** its minimum (today it is only when the quantity is below the minimum). This applies everywhere low items show up: the row's `low` highlight, the "N low" count in the summary line, and the "Low stock" tab.
2. Adding a name that is already in the pantry (ignoring upper/lower case and any spaces before or after it) no longer shows "Already in the pantry.". Instead it adds one to that item's quantity and empties the field; the item keeps its name, minimum and place, and no new item is added. A new name still adds an item with quantity 1 and minimum 1.
3. The "Quantity" sort is replaced by "Most urgent" (`<option value="urgency">Most urgent</option>` in the sort select): items in order of how far their quantity is above their minimum (quantity minus minimum, smallest first), and items with the same difference by name. "Name" stays the default sort.

Update the project's tests where these changes affect the behavior they check; `npm test` must pass. Everything else must keep working as it does now.
