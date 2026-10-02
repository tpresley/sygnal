This project board has three lists ("To do", "Doing", "Done"), each with cards that can be checked off and deleted. Add a way to move cards between lists:

- Give every card two buttons: "Previous list" and "Next list".
- "Next list" moves the card to the bottom of the list to its right; "Previous list" moves it to the bottom of the list to its left. "Previous list" on a card in the first list and "Next list" on a card in the last list do nothing.
- A moved card keeps its checked state, and it can be checked, deleted and moved again from its new list.
- Each list heading shows how many cards are in that list, for example "To do (3)". A list with no cards still shows its "No cards" message.
- Under the "Project board" heading, show the total number of cards on the board, as "Cards: 5". It must stay correct when cards are deleted.

Keep the existing markup: each list is a `section.list` with an `h2` heading, and each card is a `.card` element with its title in `.title`. Checking off and deleting cards must keep working.

The project is TypeScript; `npm run typecheck` must pass.
