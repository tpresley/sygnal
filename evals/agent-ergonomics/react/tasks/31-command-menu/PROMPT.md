Add a command palette to this editor page, in `section.palette`: a search field over the list of commands in `src/commands.js`, used mostly from the keyboard. It is part of the page (not a dialog or a popup), and the page already shows the last command run in `.last-command`.

- The search field has the accessible name "Search commands" and `role="combobox"`. Its `aria-controls` is the id of the list element, which has `role="listbox"`; each command in it is an element with `role="option"` whose text is the command's label.
- The list is always shown under the field. With an empty field (or only spaces) it shows every command; otherwise it shows the commands whose label contains the typed text, ignoring upper/lower case and spaces around the text. Matches keep the order of `src/commands.js`.
- One shown command is active: its option has `aria-selected="true"`, and the other options don't. Keyboard focus stays in the field the whole time. When the page opens, and every time the field's text changes, the first shown command is active. ArrowDown and ArrowUp move the active command to the next or previous shown command, wrapping around from the last to the first and from the first to the last.
- Enter runs the active command; clicking a command runs that command. Running a command sets `.last-command` to "Ran: " followed by its label (for example "Ran: Open settings"), clears the field (so every command is shown again, the first one active) and keeps focus in the field. The commands do nothing else yet.
- Escape clears the field, as after running a command, without running anything.
- When no command matches, the list has no options, "No commands found." is shown, and Enter does nothing.

jsdom, which the tests run in, has no layout: the acceptance tests add a no-op `Element.prototype.scrollIntoView` and a `ResizeObserver` that never reports.
