The team dashboard in `src/` lets the user describe the page they want ("Revenue and the pending orders"), and a model builds the page from the parts listed in `src/catalog.js`. Add a goals part, so a user can ask for things like "this month's goals".

- Add it to the catalog as `goals`. It has a `period` setting that the model picks from the request: `week` (this week's goals; the default) or `month` (this month's goals).
- It shows the team goals of that period from the app's goals (`state.goals`, which the header's "N of M goals done" already counts): one checkbox per goal, labelled with the goal's text and checked when the goal is done. Ticking or unticking a box marks that goal done or not done in the app's goals, so the header's count follows at once.
- A goal's tick must not be lost when the user changes the page ("Put revenue above the goals"), composes a new page, or removes the goals and asks for them again later.
- Everything the dashboard could do before still works.
