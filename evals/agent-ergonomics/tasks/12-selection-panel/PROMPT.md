In this team task tracker, add the idea of a selected task:

- Clicking a task's title selects that task. Its row (the `.task-row` element) gets the class `selected`. Only one task is selected at a time, across all projects, so clicking another title moves the selection.
- The details panel (`DetailsPanel`, the `aside.details` on the right) shows the selected task: its title, then "Project: <project name>", "Assignee: <name>" and "Status: Open" or "Status: Done". When nothing is selected it keeps showing "Select a task to see its details."
- The panel stays in sync with the task: checking the selected task off (or unchecking it) updates its status in the panel straight away.
- Pressing Escape anywhere on the page clears the selection. Other keys do nothing.
- Deleting the selected task clears the selection. Deleting any other task leaves the selection as it is.

Everything that works today (checking tasks off, deleting, the open counts, and "Hide done") must keep working.
